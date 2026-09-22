#!/bin/bash
# Mixes the music bed with the spoken line and ducks the bed under it.
#
#   ./mix-voiceover.sh <music.wav> <voice-raw.wav> <out.wav> [total-seconds] [voice-start-seconds]
#
# The duck is a real sidechain compressor keyed off the voice, not a scripted volume envelope. An
# envelope has to be re-timed by hand every time the line or the edit changes, and it ramps whether or
# not anyone is speaking; the sidechain follows the actual waveform, so it opens on the first syllable
# and recovers on the last, and it stays correct when the line is re-rendered at a different length.
set -euo pipefail
MUSIC="${1:?}"; VOICE="${2:?}"; OUT="${3:?}"
LEN="${4:-18.6}"
AT="${5:-5.3}"                  # the brief is on screen from 4.8s; the line starts half a second in
DUCK_SC="${DUCK_SC:-0.6}"       # sidechain drive -> about -9 dB; see the sweep note below

SR=48000
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT

# Voice prep, in three passes because the rate conversion wants a different tool than the rest.
# The model returns 24 kHz mono — its native rate. Resampling cannot add what is not there, but doing
# it once, well, beats leaving it to the AAC encoder or a player. This ffmpeg advertises soxr and then
# refuses it ("Requested resampling engine is unavailable"), so the conversion goes through afconvert,
# which is Core Audio's converter at its highest setting.
# 1: trim at the source rate. The model pads both ends with most of a second of room tone.
ffmpeg -v error -y -i "$VOICE" -af "
  silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,
  areverse,
  silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,
  areverse
" -c:a pcm_s16le "$W/trimmed.wav"
# 2: 24 kHz -> 48 kHz. `bats` is afconvert's best sample-rate converter, -q 127 its top quality.
afconvert -f WAVE -d LEI24@${SR} -q 127 --src-complexity bats "$W/trimmed.wav" "$W/up.wav" >/dev/null
# 3: shape it.
#   highpass 90  rumble that only eats headroom under the bass
#   deesser      the s in "hinges" and "earnings" spikes on phone speakers
#   compand      evens the line out so the duck depth is predictable rather than syllable-dependent
ffmpeg -v error -y -i "$W/up.wav" -af "
  highpass=f=90,
  deesser=i=0.4,
  compand=attacks=0.005:decays=0.15:points=-70/-70|-30/-14|-12/-8|0/-5,
  loudnorm=I=-16:TP=-2:LRA=7,
  afade=t=in:st=0:d=0.05,areverse,afade=t=in:st=0:d=0.08,areverse,
  pan=stereo|c0=c0|c1=c0
" -ar ${SR} -ac 2 -c:a pcm_s24le "$W/voice.wav"
VDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/voice.wav")
echo "  voice: ${VDUR}s at ${AT}s -> ends $(python3 -c "print(round($AT+$VDUR,2))")s of ${LEN}s"
python3 -c "
import sys
if $AT + $VDUR > $LEN - 0.4: sys.exit('the line runs past the end of the clip')"

# Lay the voice on a silent bed of the full length so both sides of the sidechain are the same shape.
DELAY=$(python3 -c "print(int($AT*$SR))")
ffmpeg -v error -y -i "$W/voice.wav" -af "adelay=${DELAY}S|${DELAY}S:all=1,apad" -t "$LEN" \
  -ar ${SR} -ac 2 -c:a pcm_s24le "$W/vo_timed.wav"

# These numbers were swept, not guessed, and the target is ABOUT 9 dB. The first attempt
# (ratio=8, level_sc=4) ducked 20 dB, which does not "make room for the voice" — it mutes the bed and
# throws away the thing people liked about the clip. level_sc is the sensitive knob: 4 -> 0.6 moves
# the duck from -20 dB to -8.7 dB. Attack 20ms catches the first syllable; release 500ms brings the
# bed back over half a second so the return reads as musical rather than switched.
#
# Sweep against THIS script's own printed figure, never against a raw render of the loop. The key is
# the COMPANDED, loudness-matched voice, not the file the model returned, and it drives the detector
# several dB harder: the same settings measured -9.5 dB with a raw key and -12.9 dB with the real one.
mix_pass() {   # <gain-dB> <out>
  ffmpeg -v error -y -i "$MUSIC" -i "$W/vo_timed.wav" -filter_complex "
    [0:a]aresample=${SR}[bed];
    [1:a]asplit=2[vo][key];
    [bed][key]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=500:makeup=1:level_sc=${DUCK_SC}[ducked];
    [ducked][vo]amix=inputs=2:normalize=0:duration=first[mix];
    [mix]volume=${1}dB,alimiter=limit=0.84:level=disabled,apad[a]
  " -map "[a]" -t "$LEN" -ar ${SR} -ac 2 -c:a pcm_s24le "$2"
}

# Hit -14 LUFS with a MEASURED STATIC GAIN, not loudnorm. Two reasons, both learned here: loudnorm is
# dynamic, and on a bed that ducks under a voice it rides the duck back up and the gap closes; and it
# consumes a ~0.75s lookahead, returning a stream that much shorter than asked, which silently left
# the bed ending before the video. A measured gain is sample-exact and leaves the duck intact.
# limit=0.84 is -1.5 dBFS. Dropping loudnorm took its TP=-1.5 ceiling with it and the first mix came
# back at -0.9 dBFS: legal as a sample peak, but AAC reconstructs intersample peaks above it, so some
# decoders would clip. The limiter is the only ceiling here now, so it carries that number.
mix_pass 0 "$W/flat.wav"
GAIN=$(ffmpeg -hide_banner -nostats -i "$W/flat.wav" -af ebur128=peak=true -f null - 2>&1 |
  sed -n '/Summary/,$p' | awk '/^ *I: /{print -14 - $2}')
echo "  measured $(python3 -c "print(round(-14-$GAIN,1))") LUFS, applying ${GAIN} dB"
mix_pass "$GAIN" "$OUT"

GOT=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
python3 -c "
import sys
if abs($GOT - $LEN) > 0.005: sys.exit(f'mix is {$GOT}s, wanted {$LEN}s')"

# Verify the duck rather than trusting it: render the bed keyed by the voice but WITHOUT the voice
# mixed in, and compare it to the bed alone inside and outside the spoken window. A duck that has
# drifted deep mutes the music; one that has drifted shallow buries the line. Either fails here.
ffmpeg -v error -y -i "$MUSIC" -i "$W/vo_timed.wav" -filter_complex \
  "[0:a]aresample=${SR}[b];[b][1:a]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=500:makeup=1:level_sc=${DUCK_SC},apad[d]" \
  -map "[d]" -t "$LEN" -ar ${SR} -ac 2 -c:a pcm_s24le "$W/ducked.wav"
python3 - "$MUSIC" "$W/ducked.wav" "$AT" "$VDUR" <<'PYV'
import re, subprocess, sys
bed, ducked, at, vdur = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
def lvl(f, ss, t):
    out = subprocess.run(["ffmpeg","-hide_banner","-nostats","-ss",str(ss),"-t",str(t),"-i",f,
                          "-filter:a","volumedetect","-f","null","/dev/null"],
                         capture_output=True, text=True).stderr
    m = re.search(r"mean_volume: (-?[\d.]+) dB", out)
    return float(m.group(1)) if m else None
mid_at = at + vdur / 2 - 0.75
deep = lvl(ducked, mid_at, 1.5) - lvl(bed, mid_at, 1.5)
back = lvl(ducked, at + vdur + 1.2, 1.2) - lvl(bed, at + vdur + 1.2, 1.2)
print(f"  duck: {deep:+.1f} dB under the line, {back:+.1f} dB once it is over")
if not -12.0 <= deep <= -6.0: sys.exit(f"duck is {deep:+.1f} dB; wanted about -9")
if back < -1.0:               sys.exit(f"bed only recovered to {back:+.1f} dB after the line")
PYV
echo "mix: ${GOT}s"
