#!/bin/bash
# Crossfades the captioned clip into the closing card and writes the file that gets posted.
#   ./finish-clip.sh <clip.mp4> <endcard.png> <out.mp4> [card_seconds]
set -euo pipefail
CLIP="${1:?}"; CARD="${2:?}"; OUT="${3:?}"; CARD_S="${4:-1.8}"
XF=0.45
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CLIP")
# Scale the card to whatever the clip is: xfade refuses inputs of different sizes, and the clip is
# built at more than one aspect.
DIM=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$CLIP")
CW=${DIM%,*}; CH=${DIM#*,}
OFFSET=$(python3 -c "print(round(${DUR}-${XF},3))")
# xfade refuses inputs whose timebases differ, and the still and the clip arrive with different ones,
# so both are pinned with settb before the transition.
ffmpeg -v error -y -i "$CLIP" -loop 1 -t "$CARD_S" -i "$CARD" -filter_complex "
  [1:v] scale=${CW}:${CH}, fps=30, format=yuv420p, settb=AVTB [end];
  [0:v] fps=30, format=yuv420p, settb=AVTB [main];
  [main][end] xfade=transition=fade:duration=${XF}:offset=${OFFSET} [v]
" -map "[v]" -an -c:v libx264 -crf 19 -preset slow -profile:v high -pix_fmt yuv420p \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -movflags +faststart -r 30 "$OUT"
echo "final: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s  $(du -h "$OUT" | cut -f1)"
