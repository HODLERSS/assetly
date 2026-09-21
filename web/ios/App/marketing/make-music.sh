#!/bin/bash
# Builds the bed for the clip from Apple Loops, which ship with macOS and are licensed for use in your
# own productions royalty-free — no download, no attribution, and nothing for LinkedIn to flag.
#
#   ./make-music.sh <out.wav> [seconds]
#
# 100 BPM, so a bar is exactly 2.4s and the video can cut on bar lines. Everything here comes from one
# Apple Loops family ("Forward Progress"), which guarantees a shared key; the beat is unpitched, so it
# layers with anything at the same tempo. Mixing families would risk two keys fighting each other.
set -euo pipefail
OUT="${1:?usage: make-music.sh <out.wav> [seconds]}"
LEN="${2:-19.2}"
L="/Library/Audio/Apple Loops/Apple/07 Chillwave"
BAR=2.4

need() { [ -f "$L/$1.caf" ] || { echo "missing loop: $1" >&2; exit 1; }; }
for n in "Forward Progress Bass" "Forward Progress Synth" "Forward Progress Guitar" "Analog Clap Beat 01"; do need "$n"; done

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
dec() { ffmpeg -v error -y -i "$L/$1.caf" -ac 2 -ar 48000 "$W/$2.wav"; }
dec "Forward Progress Bass"   bass      # 9.6s = 4 bars
dec "Forward Progress Synth"  synth     # 9.6s = 4 bars
dec "Forward Progress Guitar" guitar    # 9.6s = 4 bars
dec "Analog Clap Beat 01"     beat      # 4.8s = 2 bars

# Arrangement, in bars: bass from the top, beat from 2, synth from 3, guitar from 5. It opens sparse
# and fills in, so the clip gains energy rather than starting at full tilt and staying there.
loop_to() {   # <in> <out> <delay-seconds> <gain-dB>
  local ms; ms=$(python3 -c "print(int($3*1000))")
  ffmpeg -v error -y -stream_loop -1 -i "$W/$1.wav" -t "$LEN" \
    -af "adelay=${ms}|${ms}:all=1,volume=${4}dB" -ar 48000 -ac 2 "$W/$2.wav"
}
loop_to bass   l_bass   0                  -4
loop_to beat   l_beat   $(python3 -c "print(1*$BAR)")  -6
loop_to synth  l_synth  $(python3 -c "print(2*$BAR)")  -9
loop_to guitar l_guitar $(python3 -c "print(4*$BAR)")  -11

FADE_OUT=$(python3 -c "print(round($LEN-1.8,3))")
ffmpeg -v error -y -i "$W/l_bass.wav" -i "$W/l_beat.wav" -i "$W/l_synth.wav" -i "$W/l_guitar.wav" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0:duration=longest[m];
   [m]afade=t=in:st=0:d=0.35,afade=t=out:st=${FADE_OUT}:d=1.8,
      alimiter=limit=0.92,loudnorm=I=-15:TP=-1.5:LRA=11[a]" \
  -map "[a]" -t "$LEN" -ar 48000 -ac 2 "$OUT"

echo "music: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s at 100 BPM (bar ${BAR}s)"
ffmpeg -v error -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | tail -6 | sed 's/^/  /'
