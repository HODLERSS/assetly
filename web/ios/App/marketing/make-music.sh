#!/bin/bash
# Builds the bed for the clip from Apple Loops, which ship with macOS and are licensed for use in your
# own productions royalty-free — no download, no attribution, and nothing for LinkedIn to flag.
#
#   ./make-music.sh <out.wav> [seconds]
#
# 100 BPM, so a bar is exactly 2.4s and the video can cut on bar lines. Everything here comes from one
# Apple Loops family ("Forward Progress"), which guarantees a shared key; the beat is unpitched, so it
# layers with anything at the same tempo. Mixing families would risk two keys fighting each other.
#
# DECODE WITH afconvert, NOT ffmpeg. These loops are AAC inside CAF. ffmpeg decodes the encoder's
# priming frames as audio and hands back 4.852979s for a loop that is exactly 4.800000s — 2,543
# samples of lead-in that do not exist. -stream_loop then repeats the error, so every bar lands ~53ms
# later than the last and the stems drift apart from each other as well as from the video's bar grid.
# It reads as the drums stumbling. Core Audio honours the CAF packet table and returns the loop
# sample-exact, which is the whole reason this script shells out to afconvert.
set -euo pipefail
OUT="${1:?usage: make-music.sh <out.wav> [seconds]}"
LEN="${2:-18.6}"                 # the finished clip's length: 7 bars of product + the end card
L="/Library/Audio/Apple Loops/Apple/07 Chillwave"
BAR=2.4
SR=48000
BAR_SAMPLES=$(python3 -c "print(int($BAR*$SR))")     # 115200

need() { [ -f "$L/$1.caf" ] || { echo "missing loop: $1" >&2; exit 1; }; }
for n in "Forward Progress Bass" "Forward Progress Synth" "Forward Progress Guitar" "Analog Clap Beat 01"; do need "$n"; done

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT

# Decode, then assert the result is a whole number of bars. A loop that is off by even a few hundred
# samples cannot be tiled onto the grid, and the failure is audible but hard to name, so it fails here
# instead of shipping.
dec() {
  afconvert -f WAVE -d LEI24@${SR} "$L/$1.caf" "$W/$2.wav" >/dev/null
  local n; n=$(ffprobe -v error -select_streams a -show_entries stream=duration_ts -of csv=p=0 "$W/$2.wav")
  python3 -c "
import sys
n, bar = $n, $BAR_SAMPLES
if n % bar:
    sys.exit(f'$1 decodes to {n} samples = {n/bar:.4f} bars, not a whole number of bars')
print(f'  {\"$1\":<24} {n} samples = {n//bar} bars')"
}
dec "Forward Progress Bass"   bass
dec "Forward Progress Synth"  synth
dec "Forward Progress Guitar" guitar
dec "Analog Clap Beat 01"     beat

# Arrangement, in bars: bass from the top, beat from 2, synth from 3, guitar from 5. It opens sparse
# and fills in, so the clip gains energy rather than starting at full tilt and staying there.
# Delays are in SAMPLES, not milliseconds: adelay's ms argument is integer, and a bar that is not a
# whole number of milliseconds would round the entry off the grid.
loop_to() {   # <in> <out> <delay-bars> <gain-dB>
  local d; d=$(python3 -c "print(int($3*$BAR_SAMPLES))")
  ffmpeg -v error -y -stream_loop -1 -i "$W/$1.wav" -t "$LEN" \
    -af "adelay=${d}S|${d}S:all=1,volume=${4}dB" -ar ${SR} -ac 2 -c:a pcm_s24le "$W/$2.wav"
}
loop_to bass   l_bass   0 -4
loop_to beat   l_beat   1 -6
loop_to synth  l_synth  2 -9
loop_to guitar l_guitar 4 -11

# The bed resolves under the end card rather than stopping with the product footage: the last product
# beat ends at bar 7 (16.8s) and the card holds to LEN, so the fade starts half a bar into the card.
FADE_OUT=$(python3 -c "print(round($LEN-1.2,3))")
ffmpeg -v error -y -i "$W/l_bass.wav" -i "$W/l_beat.wav" -i "$W/l_synth.wav" -i "$W/l_guitar.wav" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0:duration=longest[m];
   [m]afade=t=in:st=0:d=0.35,afade=t=out:st=${FADE_OUT}:d=1.2,
      alimiter=limit=0.92,loudnorm=I=-15:TP=-1.5:LRA=11[a]" \
  -map "[a]" -t "$LEN" -ar ${SR} -ac 2 -c:a pcm_s24le "$OUT"

echo "music: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s at 100 BPM (bar ${BAR}s)"
ffmpeg -v error -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | tail -6 | sed 's/^/  /'
