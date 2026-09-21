#!/bin/bash
# Composes the cut take into a feed-ready clip: phone body, screen, captions.
#
#   ./make-hero-clip.sh <cut.mp4> <out.mp4> [captions.tsv] [1x1|4x5]
#
# Aspect matters more than it looks. A player whose container is square pillarboxes a 4:5 video with
# black down both sides, and nothing in the file can prevent that — the fix is to match the container.
# 1x1 is the safe default across LinkedIn surfaces; 4x5 buys more height in the feed proper.
set -euo pipefail
RAW="${1:?usage: make-hero-clip.sh <cut.mp4> <out.mp4> [captions.tsv] [1x1|4x5]}"
OUT="${2:?}"
CAPS="${3:-/tmp/sprout-captions.tsv}"
ASPECT="${4:-1x1}"

CREAM=0xF4F5F7   # Assetly ground (--as-bg), so the canvas matches the app
case "$ASPECT" in
  1x1) W=1080; H=1080; TOP=18;  CAP_H=140; CAP_SIZE=50 ;;
  4x5) W=1080; H=1350; TOP=28;  CAP_H=168; CAP_SIZE=58 ;;
  *) echo "aspect must be 1x1 or 4x5" >&2; exit 2 ;;
esac
# Bezel and screen radius are derived from the screen width so the body stays concentric with
# the screen at any size; PAD must match device-frame.py so the shadow is not clipped.
PAD=100
# Simulator footage carries a clean 9:41 status bar and the Dynamic Island, both of which belong
# in the frame. Only the physical-device recording needed its status bar cropped.
STATUS_FRAC=${STATUS_FRAC:-0}

SRC=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$RAW")
SRC_W=${SRC%,*}; SRC_H=${SRC#*,}
# Only convert range when the source really is full. Declaring limited footage as full compresses it
# a second time and everything goes grey — the cream ground turned to putty that way.
SRC_RANGE=$(ffprobe -v error -select_streams v -show_entries stream=color_range -of csv=p=0 "$RAW")
if [ "$SRC_RANGE" = "pc" ] || [ "$SRC_RANGE" = "full" ]; then
  RANGE_FILTER="scale=in_range=full:out_range=limited,"
else
  RANGE_FILTER=""
fi
CROP_TOP=$(python3 -c "print(int(round(${SRC_H}*${STATUS_FRAC}/2))*2)")
CROP_H=$(python3 -c "print(${SRC_H}-${CROP_TOP})")

read -r SCREEN_W SCREEN_H SCREEN_R BODY_X BODY_Y SCREEN_X SCREEN_Y CAP_Y <<<"$(python3 -c "
canvas_w, canvas_h, top, cap_h, pad = ${W}, ${H}, ${TOP}, ${CAP_H}, ${PAD}
# Uniform thin bezel, per device-frame.py. Solving for the screen that makes the body fit the height:
#   body_h = screen_h + 2 * 0.027 * screen_w,  screen_h = screen_w * aspect
aspect = ${CROP_H} / ${SRC_W}
body_h = canvas_h - top - cap_h
screen_w = int(round(body_h / (aspect + 0.054) / 2)) * 2
screen_h = int(round(screen_w * aspect / 2)) * 2
bez = max(6, int(round(screen_w * 0.027)))
body_w = screen_w + 2 * bez
body_r = int(round(body_w * 0.155))
body_x = (canvas_w - body_w) // 2
print(screen_w, screen_h, body_r - bez, body_x - pad, top - pad, body_x + bez, top + bez, canvas_h - cap_h)
")"
echo "$ASPECT: screen ${SCREEN_W}x${SCREEN_H} r${SCREEN_R} on ${W}x${H}"

# The display radius is the body radius minus the bezel, so the two stay concentric.
./roundrect-mask.py "$SCREEN_W" "$SCREEN_H" "$SCREEN_R" /tmp/sprout-mask.png >/dev/null
./device-frame.py "$SCREEN_W" "$SCREEN_H" /tmp/sprout-frame.png >/dev/null

inputs=(-i "$RAW" -i /tmp/sprout-mask.png -i /tmp/sprout-frame.png)
n=0
while IFS=$'\t' read -r start end text; do
  [ -z "${text:-}" ] && continue
  ./caption-strip.py "$W" "$CAP_H" "$CAP_SIZE" "/tmp/sprout-cap$n.png" "$text" >/dev/null
  inputs+=(-i "/tmp/sprout-cap$n.png")
  starts[$n]="$start"; ends[$n]="$end"
  n=$((n+1))
done < "$CAPS"

f="[0:v] crop=${SRC_W}:${CROP_H}:0:${CROP_TOP}, scale=${SCREEN_W}:${SCREEN_H}:flags=lanczos, format=rgba [scr];"
f="${f} [1:v] format=gray, scale=${SCREEN_W}:${SCREEN_H} [m];"
f="${f} [scr][m] alphamerge [rounded];"
f="${f} color=c=${CREAM}:s=${W}x${H}:d=3600 [bg];"
f="${f} [bg][2:v] overlay=${BODY_X}:${BODY_Y}:format=auto [withbody];"
f="${f} [withbody][rounded] overlay=${SCREEN_X}:${SCREEN_Y}:format=auto:shortest=1 [b0];"
for i in $(seq 0 $((n-1))); do
  f="${f} [b${i}][$((i+3)):v] overlay=0:${CAP_Y}:enable='between(t,${starts[$i]},${ends[$i]})' [b$((i+1))];"
done
f="${f} [b${n}] ${RANGE_FILTER}format=yuv420p [v]"

ffmpeg -v error -y "${inputs[@]}" -filter_complex "$f" -map "[v]" -an \
  -c:v libx264 -crf 19 -preset slow -profile:v high -pix_fmt yuv420p \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -movflags +faststart -r 30 "$OUT"
echo "out: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s  $(du -h "$OUT" | cut -f1)"
