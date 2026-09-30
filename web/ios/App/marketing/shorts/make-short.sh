#!/bin/bash
# Builds a daily market Short from a day config. See docs/marketing/SHORTS_RUNBOOK.md for the whole day.
#
#   ./make-short.sh <day.json> <work-dir> <out-dir>
#
# day.json (checked in under docs/marketing/shorts/<date>/day.json):
#   {"date": "2026-09-30", "demo": 1,
#    "script": "AI stocks today. Micron beat after the bell, with record revenue of $54.2 billion. ...",
#    "cues": [ {"skip": true, "show": [["AI",1],["stocks",1],["today.",1]]},
#              {"eyebrow": "MICRON · AFTER THE BELL", "show": [["Micron",1], ... , ["$54.2",3], ["billion.",2]]}, ...],
#    "hook": "AI stocks today|September 30",
#    "beats": [ {"take": "raw.mp4", "start": 42.4, "dur": 5.85, "freeze": true, "zoom": {...}}, ... ]}
#   "script" is the DISPLAY text (figures as figures); it is spoken through narrate/ear.ts speakable().
#   Each cue token names how many spoken words it covers. Beat durations must add up to the product
#   length (hook + beats); set them from the printed sentence times so each beat cuts on its sentence.
#
# Needs in <work-dir>: the takes named in beats (from record-hero.sh, HERO_TEST=testEdaily), and the
# ElevenLabs key in <work-dir>/elk (chmod 600; from get_secret('eleven_api_key'), never printed).
set -euo pipefail
DAY="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; W="${2:?}"; OUT="${3:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; M="$HERE/.."
APP="$(cd "$HERE/../../../../.." && pwd)"               # repo root
export THEME=dark
mkdir -p "$W" "$OUT/proof"; cd "$W"
DATE=$(python3 -c "import json;print(json.load(open('$DAY'))['date'])")
NNN=$(python3 -c "import json;print(f\"{json.load(open('$DAY'))['demo']:03d}\")")

# 1. voice: speakable() -> ElevenLabs (Minjae PVC, eleven_v4, with timestamps) -> pauses shortened
python3 -c "import json;print(json.load(open('$DAY'))['script'])" > script_display.txt
cat > speak.ts <<EOF
import { speakable, earAudit } from "$APP/supabase/functions/narrate/ear.ts";
const s = speakable(await new Response(Deno.stdin.readable).text());
console.log(s); const a = earAudit(s); if (a.length) { console.error("EAR", JSON.stringify(a)); Deno.exit(3); }
EOF
npx -y deno@2 run -A speak.ts < script_display.txt > script_spoken.txt
# The same text reads 21.4-23.0 s from take to take; keep the first render whose voice fits the 25 s
# ceiling (voice + 0.3 s lead + 0.45 s tail + the card's 2.2 s), up to four renders. REUSE_VO=1 keeps
# an existing vo.wav (re-cutting the picture never re-voices it).
if [ "${REUSE_VO:-0}" != 1 ] || [ ! -s vo.wav ]; then
  for try in 1 2 3 4; do
    python3 "$HERE/tts.py" script_spoken.txt vo_raw
    ffmpeg -v error -y -i vo_raw.mp3 -ar 48000 -ac 1 vo_raw.wav
    "$HERE/shrink-pauses.py" vo_raw.wav vo_raw.words.json 0.26 vo.wav vo.words.json
    python3 -c "import json,sys; sys.exit(0 if json.load(open('vo.words.json'))[-1][2] <= 21.9 else 1)" && break
    [ $try = 4 ] && { echo "voice never fit 21.9 s: tighten the script"; exit 1; }
  done
fi

# 2. word-synced subtitles
python3 - "$DAY" "$W" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); json.dump({"voice": sys.argv[2] + "/vo.wav", "size": 50, "cues": d["cues"]}, open("show.json", "w"), ensure_ascii=False)
PY
"$HERE/subs-spec.py" show.json vo.words.json 0.30 subs.json
# beat timing follows the voice: a beat with "to_cue": k ends 0.13 s before cue k's first word, so every
# cut lands just ahead of the sentence it illustrates; "tail" on the last beat is the hold after the
# last word before the card dissolves in. The hook runs until cue 1.
python3 - "$DAY" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); w = json.load(open("vo.words.json")); AT = 0.30
starts, i = [], 0
for c in d["cues"]: starts.append(AT + w[i][1]); i += sum(n for _, n in c["show"])
last = AT + w[-1][2]
hook = round(starts[1] - 0.13, 3); cur = hook; beats = []
for b in d["beats"]:
    b = dict(b)
    if "to_cue" in b: b["dur"] = round(starts[b.pop("to_cue")] - 0.13 - cur, 3)
    elif "tail" in b: b["dur"] = round(last + b.pop("tail") - cur, 3)
    z = b.get("zoom")
    if z and z.get("out") == "auto": b["zoom"] = dict(z, out=[round(b["dur"] - 0.8, 2), round(b["dur"] - 0.1, 2)])   # settle before the cut
    cur += b["dur"]; beats.append(b)
json.dump({"hook": hook, "beats": beats, "product": round(cur, 3)}, open("timing.json", "w"), indent=1)
print("timing: hook %.2fs, beats %s, product %.2fs" % (hook, [b["dur"] for b in beats], cur))
PY
LEN_PRODUCT=$(python3 -c "import json;print(json.load(open('timing.json'))['product'])")
LEN=$(python3 -c "print(round($LEN_PRODUCT+2.2,2))")
python3 -c "import sys; sys.exit('Short is %.2fs, outside 20-25s: tighten the script' % $LEN) if not 20 <= $LEN <= 25 else None"
rm -rf fill; SUB_TOP=98 SUB_MAXW=820 SUB_MAX_LINES=3 python3 "$M/make-fill-subtitles.py" subs.json fill 1080 300 60 "$LEN_PRODUCT" >/dev/null
"$M/make-cards.py" line 1080 1920 112 30 disclaimer.png "Demo portfolio · Not financial advice" >/dev/null

# 3. picture
python3 - "$DAY" "$W" "$LEN" "$M" <<'PY'
import json, sys
d, w, L, m = json.load(open(sys.argv[1])), sys.argv[2], float(sys.argv[3]), sys.argv[4]
tm = json.load(open("timing.json")); beats = []
for b in tm["beats"]:
    b = dict(b); b["src"] = f"{w}/{b.pop('take')}"; beats.append(b)
plan = {"w": 1080, "h": 1920, "len": L, "theme": "dark", "fps": 60, "xfade": 0.6, "crf": 15,
        "captions": "top", "cap_top": 150, "cap_h": 300, "bottom": 40, "slide": 0.4,
        "hook": {"lines": d.get("hook", "AI stocks today|" + d["date"]), "dur": tm["hook"], "static": True},
        "beats": beats, "card": {"icon": f"{m}/../App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"},
        "overlays": [{"frames": f"{w}/fill", "x": 0, "y": 150}, {"png": f"{w}/disclaimer.png", "x": 0, "y": 0}]}
json.dump(plan, open("plan.json", "w"), indent=1)
PY
END_SUB1="Your portfolio, explained daily" END_SUB2="Demo portfolio. Not financial advice." END_CTA="Available on the App Store" \
  python3 "$M/make-spot.py" plan.json video.mp4

# 4. sound: Apple Loops bed at the Short's length, voice at 0.30 s, sidechain duck, -14 LUFS
python3 -c "import json;p=json.load(open('$HERE/music-short.json'));p['len']=$LEN;json.dump(p,open('music.json','w'))"
"$M/make-spot-music.py" music.json music.wav
DUCK_SC=1.2 VO_OUT="$W/vo-track.wav" "$M/mix-spot-audio.sh" music.wav mix.wav "$LEN" 0.30:vo.wav
FINAL="$OUT/assetly-short-$DATE.mp4"
ffmpeg -v error -y -i video.mp4 -i mix.wav -map 0:v -map 1:a -c:v copy -af "afade=t=out:st=$(python3 -c "print($LEN-1.2)"):d=1.2" \
  -c:a aac_at -b:a 256k -ar 48000 -movflags +faststart "$FINAL"   # no -shortest: it cut 9 video frames

# 5. proof frames and the automatic metrics
for t in 0.0 0.5 3.0 8.0 13.0 18.0 $(python3 -c "print(round($LEN-0.03,2))"); do
  ffmpeg -v error -y -ss "$t" -i "$FINAL" -frames:v 1 "$OUT/proof/proof_${t}s.png"; done
"$M/make-cards.py" hook 1080 1920 cards "$(python3 -c "import json;print(json.load(open('$DAY')).get('hook',''))")" >/dev/null
END_SUB1="Your portfolio, explained daily" END_SUB2="Demo portfolio. Not financial advice." "$M/make-cards.py" end 1080 1920 \
  "$M/../App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png" cards >/dev/null
L="disclaimer.png,0,0"; for f in cards/hook*.png cards/end_*.png; do L="$L;$f,0,0"; done
for f in $(ls fill | awk 'NR%120==60'); do L="$L;fill/$f,0,150"; done
cp script_display.txt "$OUT/script.txt"
SHORT_LAYERS="$L" python3 "$HERE/qa-short.py" "$FINAL" vo-track.wav subs.json script_display.txt "$OUT/youtube-metadata.md" | tee "$OUT/qa-auto.md"
echo "-> $FINAL  (demo $NNN)"
