#!/bin/bash
# Builds a daily market Short from a day config. See docs/marketing/SHORTS_RUNBOOK.md for the whole day.
#
#   ./make-short.sh <day.json> <work-dir> <out-dir>
#
# day.json (checked in under docs/marketing/shorts/<date>/day.json):
#   {"date": "2026-09-30", "demo": 1, "hook": "[Micron] beats.|[Gemini 4] launches.|[Meta] slips.",
#    "hook_kicker": "AI STOCKS · SEP 30", "hook_foot": "Demo Portfolio 001 · Assetly",   (the cover: frame 0)
#    "script": "<the whole DISPLAY text, figures as figures: what the subtitles show; the QA scans it>",
#    two ways to voice it:
#    "lines": [{"voice": "marin"|"cedar"|"minjae", "say": "<spoken text>",
#               "cues": [{"eyebrow": "MICRON", "show": ["Micron", "beat", "$54.2", "billion."]}]}, ...]
#        a hand-off between speakers (OpenRouter gpt-audio marin/cedar, ElevenLabs for minjae), with the
#        speaking-indicator pills; each "say" goes through narrate/ear.ts speakable() first
#    or "cues": [{"eyebrow": ..., "show": [["$54.2", 3], ...]}]   one ElevenLabs take of the whole script
#        (each token names how many spoken words it covers)
#    "beats": [{"take": "take1.mp4", "start": 42.4, "freeze": true, "zoom": {...,"out": "auto"},
#               "highlight": {"src_box": [x0,y0,x1,y1]}, "to_cue": 2}, ..., {"take": ..., "tail": 0.45}]}
#   A beat with "to_cue": k ends 0.13 s before cue k's first word (cues counted across all lines, skip
#   cues included), so each cut lands just ahead of its sentence; the hook runs until cue 1.
#
# Needs in <work-dir>: the takes named in beats (record-hero.sh HERO_TEST=testEdaily, normalised to 30 fps
# CFR), and <work-dir>/elk (ElevenLabs key, chmod 600) for minjae lines. OpenRouter reads
# ~/.private_keys/openrouter.txt. No key is ever printed. REUSE_VO=1 re-cuts the picture on the same voice.
set -euo pipefail
DAY="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; W="${2:?}"; OUT="${3:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; M="$HERE/.."
APP="$(cd "$HERE/../../../../.." && pwd)"               # repo root
export THEME=dark
mkdir -p "$W" "$OUT/proof"; W="$(cd "$W" && pwd)"; cd "$W"
DATE=$(python3 -c "import json;print(json.load(open('$DAY'))['date'])")
NNN=$(python3 -c "import json;print(f\"{json.load(open('$DAY'))['demo']:03d}\")")
LINES=$(python3 -c "import json;print(1 if json.load(open('$DAY')).get('lines') else 0)")
python3 -c "import json;print(json.load(open('$DAY'))['script'])" > script_display.txt
cat > speak.ts <<EOF
import { speakable, earAudit } from "$APP/supabase/functions/narrate/ear.ts";
const s = speakable(await new Response(Deno.stdin.readable).text());
console.log(s); const a = earAudit(s); if (a.length) { console.error("EAR", JSON.stringify(a)); Deno.exit(3); }
EOF

# 1. voice and word timing -> subs.json + starts.json ([first-word time per cue..., end of last word])
if [ "$LINES" = 1 ]; then
  if [ "${REUSE_VO:-0}" != 1 ] || [ ! -s voice.json ]; then
    # every line is made ear-ready by the product's own speakable(): numbers, dates and symbols as words
    python3 - "$DAY" <<'PY'
import json, subprocess, sys
d = json.load(open(sys.argv[1]))
import os
for ln in d["lines"]:
    if ln.get("reuse"):                    # an already-approved take, path relative to day.json
        ln["reuse"]["file"] = os.path.join(os.path.dirname(sys.argv[1]), ln["reuse"]["file"]); continue
    r = subprocess.run(["npx", "-y", "deno@2", "run", "-A", "speak.ts"], input=ln["say"], capture_output=True, text=True)
    if r.returncode: sys.exit(f"ear check failed: {ln['say']!r} {r.stderr[-300:]}")
    ln["say"] = r.stdout.strip()
json.dump(d, open("day_spoken.json", "w"), ensure_ascii=False, indent=1)
PY
    python3 "$HERE/voice-lines.py" day_spoken.json "$W"
  fi
  python3 -c "import json;v=json.load(open('voice.json'));json.dump([[s,0,0] for s in v['starts']]+[[v['last'],0,0]],open('starts.json','w'))"
  python3 -c "import json;print(' '.join(json.load(open('voice.json'))['cues']))" > mixcues.txt
else
  npx -y deno@2 run -A speak.ts < script_display.txt > script_spoken.txt
  # The same text reads 21.4-23.0 s from take to take; keep the first render whose voice fits the 25 s
  # ceiling (voice + 0.3 s lead + 0.45 s tail + the card's 2.2 s), up to four renders.
  if [ "${REUSE_VO:-0}" != 1 ] || [ ! -s vo.wav ]; then
    for try in 1 2 3 4; do
      python3 "$HERE/tts.py" script_spoken.txt vo_raw
      ffmpeg -v error -y -i vo_raw.mp3 -ar 48000 -ac 1 vo_raw.wav
      "$HERE/shrink-pauses.py" vo_raw.wav vo_raw.words.json 0.26 vo.wav vo.words.json
      python3 -c "import json,sys; sys.exit(0 if json.load(open('vo.words.json'))[-1][2] <= 21.9 else 1)" && break
      [ $try = 4 ] && { echo "voice never fit 21.9 s: tighten the script"; exit 1; }
    done
  fi
  python3 - "$DAY" "$W" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); json.dump({"voice": sys.argv[2] + "/vo.wav", "size": 50, "cues": d["cues"]}, open("show.json", "w"), ensure_ascii=False)
w = json.load(open("vo.words.json")); AT = 0.30; starts, i = [], 0
for c in d["cues"]: starts.append(AT + w[i][1]); i += sum(n for _, n in c["show"])
json.dump([[s, 0, 0] for s in starts] + [[AT + w[-1][2], 0, 0]], open("starts.json", "w"))
PY
  "$HERE/subs-spec.py" show.json vo.words.json 0.30 subs.json
  echo "0.30:$W/vo.wav" > mixcues.txt
fi

# 2. beat timing follows the voice
python3 - "$DAY" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); st = json.load(open("starts.json"))
starts, last = [x[0] for x in st[:-1]], st[-1][0]
# "grid": cuts snap to the music's grid (0.3 s = an eighth at 100 BPM), so picture and bed move together.
# "motion": ONE camera language for every beat: the same push (to, in, out seconds, smootherstep) toward
# each beat's focus_src; the last beat holds its push into the card.
G = d.get("grid", 0); snap = (lambda t: round(round(t / G) * G, 3)) if G else (lambda t: round(t, 3))
mo = d.get("motion")
hook = snap(d.get("hook_dur", starts[1] - 0.13)); cur = hook; beats = []
for i, b in enumerate(d["beats"]):
    b = {k: v for k, v in b.items() if k != "note"}; last_beat = i == len(d["beats"]) - 1
    if "to_cue" in b: b["dur"] = round(snap(starts[b.pop("to_cue")] - 0.13) - cur, 3)
    elif "tail" in b: b["dur"] = round(snap(last + b.pop("tail")) - cur, 3)
    if mo and "zoom" not in b:
        b["zoom"] = {"to": mo["to"], "focus_src": b.pop("focus_src", 1100), "in": [0.05, round(0.05 + mo["in"], 3)]}
        if not last_beat: b["zoom"]["out"] = [round(b["dur"] - mo["out"] - 0.05, 3), round(b["dur"] - 0.05, 3)]
    z = b.get("zoom")
    if z and z.get("out") == "auto": b["zoom"] = dict(z, out=[round(b["dur"] - 0.8, 2), round(b["dur"] - 0.1, 2)])   # settle before the cut
    cur += b["dur"]; beats.append(b)
# over the ceiling by a little: take it out of the held last beat (never below 0.4 s after the last word) and the card
mx = d.get("len_range", [20, 25])[1] - 0.05; card = d.get("card", 2.2)
over = cur + card - mx
if over > 0 and beats:
    cut = min(over, max(0.0, beats[-1]["dur"] - (last + 0.4 - (cur - beats[-1]["dur"]))))
    beats[-1]["dur"] = round(beats[-1]["dur"] - cut, 3); cur -= cut; over -= cut
    if over > 0 and card - over >= 1.5: d["card"] = card = round(card - over, 2); over = 0
    json.dump(d, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
    print(f"over the {mx + 0.05:.0f} s ceiling: last beat trimmed by {cut:.2f}s, card {card:.2f}s")
json.dump({"hook": hook, "beats": beats, "product": round(cur, 3)}, open("timing.json", "w"), indent=1)
print("timing: hook %.2fs, beats %s, product %.2fs" % (hook, [b["dur"] for b in beats], cur))
PY
LEN_PRODUCT=$(python3 -c "import json;print(json.load(open('timing.json'))['product'])")
LEN=$(python3 -c "import json;print(round($LEN_PRODUCT+json.load(open('$DAY')).get('card',2.2),2))")
# "len_range" (default [20, 25]); the v1.0 skill's editions run 20-30 s with a hard 30.0 s ceiling
LMIN=$(python3 -c "import json;print(json.load(open('$DAY')).get('len_range',[20,25])[0])"); LMAX=$(python3 -c "import json;print(json.load(open('$DAY')).get('len_range',[20,25])[1])")
python3 -c "import sys; sys.exit('Short is %.2fs, outside $LMIN-${LMAX}s: tighten the script' % $LEN) if not $LMIN <= $LEN <= $LMAX else None"

# 3. sound first (the speaking pills are drawn from the mixed voice track): Apple Loops bed at the
# Short's length, the voice cues, sidechain duck, -14 LUFS
python3 -c "import json;p=json.load(open('$HERE/music-short.json'));p['len']=$LEN;json.dump(p,open('music.json','w'))"
"$M/make-spot-music.py" music.json music.wav
DUCK_SC="${DUCK_SC:-0.7}" VO_OUT="$W/vo-track.wav" "$M/mix-spot-audio.sh" music.wav mix.wav "$LEN" $(cat mixcues.txt)

# 4. picture: subtitles, pills, disclaimer, beats, card
# owner, 10/1: subtitles end on a fixed row (SUB_BOTTOM) 40 px above the phone whatever their line count, the eyebrow 16 px
# above the first line; 60 px type (Shorts caption guidance: 60-75 px at 1080x1920), centred, kept left of the action rail
rm -rf fill spk; SUB_TOP=98 SUB_BOTTOM=318 SUB_EYE_GAP=16 SUB_MAXW=840 SUB_MAX_LINES=3 python3 "$M/make-fill-subtitles.py" subs.json fill 1080 330 60 "$LEN_PRODUCT" >/dev/null
if [ "$LINES" = 1 ]; then
  ffmpeg -v error -y -i vo-track.wav -ac 1 -c:a pcm_s16le vo16.wav; python3 "$M/make-speaking.py" vo16.wav spk 60 dark
fi
"$M/make-cards.py" line 1080 1920 112 30 disclaimer.png "Not financial advice" >/dev/null
python3 - "$DAY" "$W" "$LEN" "$M" "$LINES" <<'PY'
import json, sys
d, w, L, m, lines = json.load(open(sys.argv[1])), sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5] == "1"
tm = json.load(open("timing.json")); beats = []; chips = []; t = tm["hook"]
for b in tm["beats"]:
    b = dict(b); b["src"] = f"{w}/{b.pop('take')}"; ch = b.pop("chip", None); b.pop("quote", None); beats.append(b)
    # a beat's "chip" {"png": full-canvas RGBA}: the Short's own labelled overlay (an extended-hours quote the app does not
    # show), laid on for exactly that beat, fading in with its line
    if ch and ch.get("png"): chips.append({"png": ch["png"], "x": 0, "y": 0, "start": round(t + 0.12, 3), "end": round(t + b["dur"] - 0.05, 3)})
    t += b["dur"]
plan = {"w": 1080, "h": 1920, "len": L, "theme": "dark", "fps": 60, "xfade": 0.6, "crf": 15,
        "captions": "top", "cap_top": 150, "cap_h": 330, "bottom": 40, "slide": 0.4,
        "phone_w": 860, "zoom_anchor": "top",      # owner, 10/1: a bigger phone whose top edge never moves (constant gap)
        "hook": {"lines": d.get("hook", "AI stocks today|" + d["date"]), "dur": tm["hook"], "static": True,
                 "kicker": d.get("hook_kicker", ""), "foot": d.get("hook_foot", "")},
        "beats": beats, "card": {"icon": f"{m}/../App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"},
        "overlays": [{"frames": f"{w}/fill", "x": 0, "y": 150}, {"png": f"{w}/disclaimer.png", "x": 0, "y": 0}] + chips}
if lines: plan.update(speaking=f"{w}/spk", speaking_x=460, speaking_y=152)     # five pills over the strip while anyone speaks
json.dump(plan, open("plan.json", "w"), indent=1)
PY
END_SUB1="Your portfolio, explained daily" END_SUB2="Not financial advice." END_CTA="Available on the App Store" \
  python3 "$M/make-spot.py" plan.json video.mp4
# "stamp": {"edition": "Close", "text": "Sep 30 · 4:05 PM ET"} -- the data time-stamp, top-left on EVERY frame (cover,
# product and end card), laid over the finished picture so nothing in the edit can move or hide it
STAMP_ED=$(python3 -c "import json;print((json.load(open('$DAY')).get('stamp') or {}).get('edition',''))")
if [ -n "$STAMP_ED" ]; then
  "$M/make-cards.py" stamp 1080 1920 60 104 stamp.png "$STAMP_ED" "$(python3 -c "import json;print(json.load(open('$DAY'))['stamp']['text'])")" >/dev/null
  ffmpeg -v error -y -i video.mp4 -loop 1 -i stamp.png -filter_complex "[1:v]format=rgba[s];[0:v][s]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -crf 15 -preset slow -aq-mode 3 -profile:v high -pix_fmt yuv420p -r 60 video_stamped.mp4 && mv video_stamped.mp4 video.mp4
fi
FINAL="$OUT/assetly-short-$(python3 -c "import json;d=json.load(open('$DAY'));print(d.get('slug',d['date']))").mp4"
ffmpeg -v error -y -i video.mp4 -i mix.wav -map 0:v -map 1:a -c:v copy -af "afade=t=out:st=$(python3 -c "print($LEN-1.2)"):d=1.2" \
  -c:a aac_at -b:a 256k -ar 48000 -movflags +faststart "$FINAL"   # no -shortest: it cut 9 video frames

# 5. proof frames and the automatic metrics
rm -f "$OUT"/proof/proof_*.png
for t in 0.0 0.5 3.0 8.0 13.0 18.0 $(python3 -c "print(round($LEN-0.03,2))"); do
  ffmpeg -v error -y -ss "$t" -i "$FINAL" -frames:v 1 "$OUT/proof/proof_${t}s.png"; done
HOOK_KICKER="$(python3 -c "import json;print(json.load(open('$DAY')).get('hook_kicker',''))")" HOOK_FOOT="$(python3 -c "import json;print(json.load(open('$DAY')).get('hook_foot',''))")" \
  "$M/make-cards.py" hook 1080 1920 cards "$(python3 -c "import json;print(json.load(open('$DAY')).get('hook',''))")" >/dev/null
END_SUB1="Your portfolio, explained daily" END_SUB2="Not financial advice." "$M/make-cards.py" end 1080 1920 \
  "$M/../App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png" cards >/dev/null
L="disclaimer.png,0,0"; [ -f stamp.png ] && [ -n "$STAMP_ED" ] && L="$L;stamp.png,0,0"; for f in cards/hook*.png cards/end_*.png; do L="$L;$f,0,0"; done
for f in $(ls fill | awk 'NR%120==60'); do L="$L;fill/$f,0,150"; done
[ -d spk ] && for f in $(ls spk | awk 'NR%240==120'); do L="$L;spk/$f,460,152"; done
STR="$(python3 -c "import json;d=json.load(open('$DAY'));s=d.get('stamp') or {};print(d.get('hook',''),d.get('hook_kicker',''),d.get('hook_foot',''),s.get('edition',''),s.get('text',''))") Not financial advice Your portfolio, explained daily Available on the App Store $(python3 -c "import json;print(' '.join(c.get('eyebrow','') for c in json.load(open('subs.json'))['cues']))")"
HOLD_FROM=$(python3 -c "import json;t=json.load(open('timing.json'));print(round(t['hook']+sum(b['dur'] for b in t['beats'][:-1])+0.5,2))")
SHORT_HOLD_FROM="$HOLD_FROM" SHORT_LEN_RANGE="$LMIN,$LMAX" SHORT_PLAN=plan.json SHORT_STRINGS="$STR" SHORT_LAYERS="$L" python3 "$HERE/qa-short.py" "$FINAL" vo-track.wav subs.json script_display.txt "$OUT/youtube-metadata.md" | tee "$OUT/qa-auto.md"
echo "-> $FINAL  (demo $NNN)"
