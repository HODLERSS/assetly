#!/bin/bash
# Crossfades the captioned clip into the closing card and writes the file that gets posted.
#   ./finish-clip.sh <clip.mp4> <endcard.png> <out.mp4> [card_seconds] [music.wav]
#
# XF is a beat at 100 BPM (0.6s), so the fade into the card lands on a bar line like every other cut.
set -euo pipefail
CLIP="${1:?}"; CARD="${2:?}"; OUT="${3:?}"; CARD_S="${4:-2.4}"; MUSIC="${5:-}"
XF=0.6
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
" -map "[v]" -an -c:v libx264 -crf 17 -preset veryslow -profile:v high -pix_fmt yuv420p \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -movflags +faststart -r 30 "$OUT.silent.mp4"

if [ -n "$MUSIC" ]; then
  # -shortest would cut whichever ends first; the bed is built to the clip's length and faded there,
  # so trim the audio to the video rather than the other way round.
  VDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT.silent.mp4")
  # make-music.sh already resolves the bed under the end card; this short fade is belt and braces so
  # the cut at the video's end is inaudible whatever bed a caller passes in.
  FADE_AT=$(python3 -c "print(round(${VDUR}-0.3,3))")
  # aac_at is Apple's AudioToolbox encoder — cleaner than ffmpeg's native aac at the same rate, and
  # 256k leaves the cymbals and the synth tail something to survive the platform's own re-encode.
  ACODEC=aac; ffmpeg -hide_banner -encoders 2>/dev/null | grep -q " aac_at " && ACODEC=aac_at
  ffmpeg -v error -y -i "$OUT.silent.mp4" -i "$MUSIC" -map 0:v -map 1:a \
    -af "afade=t=out:st=${FADE_AT}:d=0.3" \
    -t "$VDUR" -c:v copy -c:a "$ACODEC" -b:a 256k -ar 48000 -ac 2 -movflags +faststart "$OUT"
  rm -f "$OUT.silent.mp4"
else
  mv "$OUT.silent.mp4" "$OUT"
fi
echo "final: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s  $(du -h "$OUT" | cut -f1)"
