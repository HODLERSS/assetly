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

# One render for every clip in the call, or VO_FILE to reuse a render across calls: the model reads
# the line a little differently each time, and a campaign's variants should carry the same take.
if [ -n "${VO_FILE:-}" ]; then RAW="$VO_FILE"; else
  RAW=$(mktemp -d)/vo.wav
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" ./make-voiceover.py "$RAW" "${VO_VOICE:-marin}"
fi

for CLIP in "$@"; do
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CLIP")
  BED=$(mktemp -d)/bed.wav; MIX=$(mktemp -d)/mix.wav
  ./make-music.sh "$BED" "$DUR" > /dev/null
  ./mix-voiceover.sh "$BED" "$RAW" "$MIX" "$DUR" "$VOICE_AT"
  ACODEC=aac; ffmpeg -hide_banner -encoders 2>/dev/null | grep -q " aac_at " && ACODEC=aac_at
  # the music resolves over the end card: a 3s fade to silence, timed from the clip's own length
  FADE="${FADE_OUT:-3}"; FADE_AT=$(python3 -c "print(round($DUR-$FADE,3))")
  ffmpeg -v error -y -i "$CLIP" -i "$MIX" -map 0:v -map 1:a -c:v copy \
    -af "afade=t=out:st=${FADE_AT}:d=${FADE}" \
    -c:a "$ACODEC" -b:a 256k -ar 48000 -ac 2 -t "$DUR" -movflags +faststart "$CLIP.tmp.mp4"
  mv "$CLIP.tmp.mp4" "$CLIP"
  echo "  $(basename "$CLIP"): $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CLIP")s"
done
