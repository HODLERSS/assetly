#!/bin/bash
# Mixes a music bed with one or more spoken cues, ducking the bed under each.
#
#   ./mix-spot-audio.sh <music.wav> <out.wav> <total-seconds> <start:voice.wav> [<start:voice.wav> ...]
#
# Same chain as mix-voiceover.sh (afconvert resample, shape, sidechain duck, measured static gain,
# limiter as the only ceiling), generalised to several cues so a spot can open with the greeting and
# close with the sign-off. The cues are summed into ONE voice track before the sidechain, so the
# duck keys off whichever line is speaking.
set -euo pipefail
MUSIC="${1:?}"; OUT="${2:?}"; LEN="${3:?}"; shift 3
[ $# -ge 1 ] || { echo "need at least one start:voice.wav cue" >&2; exit 2; }
SR=48000; DUCK_SC="${DUCK_SC:-0.6}"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
LEN_S=$(python3 -c "print(int(round($LEN*$SR)))")

i=0; cues=()
# cue = start:file[:fade_out[:fade_in[:pan]]] — fades in seconds on the trimmed line, pan -1..1.
# Two lines can hand over mid-air: the first fades over its last second while the next rises, each
# nudged to its own side so both stay intelligible through the overlap.
for cue in "$@"; do
  IFS=: read -r AT VOICE FO FI PAN <<<"$cue"; FO="${FO:-0}"; FI="${FI:-0}"; PAN="${PAN:-0}"
  ffmpeg -v error -y -i "$VOICE" -af "
    silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,
    areverse,silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,areverse
  " -c:a pcm_s16le "$W/t$i.wav"
  afconvert -f WAVE -d LEI24@${SR} -q 127 --src-complexity bats "$W/t$i.wav" "$W/u$i.wav" >/dev/null
  D=$(python3 -c "print(int(round($AT*$SR)))")
  ffmpeg -v error -y -i "$W/u$i.wav" -af "
    highpass=f=90, deesser=i=0.4,
    compand=attacks=0.005:decays=0.15:points=-70/-70|-30/-14|-12/-8|0/-5,
    loudnorm=I=-16:TP=-2:LRA=7, aresample=${SR},
    afade=t=in:st=0:d=$(python3 -c "print(max(0.05,$FI))"),areverse,afade=t=in:st=0:d=$(python3 -c "print(max(0.08,$FO))"),areverse,
    pan=stereo|c0=$(python3 -c "print(round(min(1,1-$PAN),3))")*c0|c1=$(python3 -c "print(round(min(1,1+$PAN),3))")*c0,
    adelay=${D}S|${D}S:all=1, apad, atrim=end_sample=${LEN_S}
  " -ar ${SR} -ac 2 -c:a pcm_s24le "$W/v$i.wav"
  VD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/u$i.wav")
  echo "  cue $i: ${VD}s at ${AT}s -> ends $(python3 -c "print(round($AT+$VD,2))")s"
  python3 -c "import sys; sys.exit('cue $i runs past the end') if $AT+$VD > $LEN-0.15 else None"
  cues+=("$W/v$i.wav"); i=$((i+1))
done
# one voice track (VO_OUT keeps a copy: the speaking indicator is drawn from it)
if [ $i -eq 1 ]; then cp "${cues[0]}" "$W/vo.wav"; else
  ffmpeg -v error -y $(printf -- '-i %s ' "${cues[@]}") -filter_complex "$(printf '[%d:a]' $(seq 0 $((i-1))))amix=inputs=$i:normalize=0:duration=longest[a]" -map "[a]" -ar ${SR} -ac 2 -c:a pcm_s24le "$W/vo.wav"
fi

[ -n "${VO_OUT:-}" ] && cp "$W/vo.wav" "$VO_OUT"

mix_pass() {   # <gain-dB> <out>
  ffmpeg -v error -y -i "$MUSIC" -i "$W/vo.wav" -filter_complex "
    [0:a]aresample=${SR}[bed]; [1:a]asplit=2[vo][key];
    [bed][key]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=500:makeup=1:level_sc=${DUCK_SC}[ducked];
    [ducked][vo]amix=inputs=2:normalize=0:duration=first[mix];
    [mix]volume=${1}dB,alimiter=limit=0.84:level=disabled,apad,atrim=end_sample=${LEN_S}[a]
  " -map "[a]" -ar ${SR} -ac 2 -c:a pcm_s24le "$2"
}
mix_pass 0 "$W/flat.wav"
GAIN=$(ffmpeg -hide_banner -nostats -i "$W/flat.wav" -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary/,$p' | awk '/^ *I: /{print -14 - $2}')
mix_pass "$GAIN" "$OUT"

# duck check on the first cue
ffmpeg -v error -y -i "$MUSIC" -i "$W/vo.wav" -filter_complex "[0:a]aresample=${SR}[b];[b][1:a]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=500:makeup=1:level_sc=${DUCK_SC},apad,atrim=end_sample=${LEN_S}[d]" -map "[d]" -ar ${SR} -ac 2 -c:a pcm_s24le "$W/ducked.wav"
FIRST="${1%%:*}"; FD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/u0.wav")
python3 - "$MUSIC" "$W/ducked.wav" "$FIRST" "$FD" <<'PYV'
import re, subprocess, sys
bed, ducked, at, vd = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
def lvl(f, ss, t):
    o = subprocess.run(["ffmpeg","-hide_banner","-nostats","-ss",str(ss),"-t",str(t),"-i",f,"-filter:a","volumedetect","-f","null","/dev/null"],capture_output=True,text=True).stderr
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", o).group(1))
m = at + vd/2 - 0.75
deep = lvl(ducked, m, 1.5) - lvl(bed, m, 1.5)
print(f"  duck: {deep:+.1f} dB under the first cue")
if not -12 <= deep <= -6: sys.exit(f"duck {deep:+.1f} dB out of range")
PYV
G=$(ffprobe -v error -select_streams a -show_entries stream=duration_ts -of csv=p=0 "$OUT"); [ "$G" = "$LEN_S" ] || { echo "mix is $G samples, wanted $LEN_S"; exit 1; }
echo "mix: ${LEN}s, gain ${GAIN} dB"
