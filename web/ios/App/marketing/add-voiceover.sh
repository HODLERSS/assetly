#!/bin/bash
# Puts the spoken line onto finished clips without touching a single frame.
#
#   ./add-voiceover.sh <clip.mp4> [clip.mp4 ...]
#
# The video stream is COPIED, not re-encoded: these files were already graded, verified and measured,
# and a re-encode to change the audio would throw a generation of x264 away for nothing.
set -euo pipefail
cd "$(dirname "$0")"
VOICE_AT="${VOICE_AT:-5.3}"      # the brief is on screen from 4.8s; the line starts half a second in

RAW=$(mktemp -d)/vo.wav
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" ./make-voiceover.py "$RAW" "${VO_VOICE:-marin}"

for CLIP in "$@"; do
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CLIP")
  BED=$(mktemp -d)/bed.wav; MIX=$(mktemp -d)/mix.wav
  ./make-music.sh "$BED" "$DUR" > /dev/null
  ./mix-voiceover.sh "$BED" "$RAW" "$MIX" "$DUR" "$VOICE_AT"
  ACODEC=aac; ffmpeg -hide_banner -encoders 2>/dev/null | grep -q " aac_at " && ACODEC=aac_at
  ffmpeg -v error -y -i "$CLIP" -i "$MIX" -map 0:v -map 1:a -c:v copy \
    -c:a "$ACODEC" -b:a 256k -ar 48000 -ac 2 -t "$DUR" -movflags +faststart "$CLIP.tmp.mp4"
  mv "$CLIP.tmp.mp4" "$CLIP"
  echo "  $(basename "$CLIP"): $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CLIP")s"
done
