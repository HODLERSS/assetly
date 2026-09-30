#!/usr/bin/env python3
"""Word-synced subtitle spec for a Short, from the voice's own ElevenLabs alignment.

    subs-spec.py <script.json> <words.json> <voice-at-seconds> <out-spec.json>

script.json: {"cues": [{"eyebrow": "MICRON", "show": [["Micron", 1], ..., ["$54.2", 3], ["billion.", 2]]}, ...]}
Each display token names how many SPOKEN words it covers ("$54.2" is "fifty-four point two"), so the
screen can show figures while the timing comes from the spoken words. A cue with "skip": true consumes
its words but draws nothing (the hook line, which the title card already shows).
The spoken-word count across all cues must equal the alignment's word count, or this fails.
"""
import json, sys
script, words, at, out = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), float(sys.argv[3]), sys.argv[4]
need = sum(n for c in script["cues"] for _, n in c["show"])
assert need == len(words), f"script covers {need} spoken words, the voice has {len(words)}"
i = 0; cues = []
for c in script["cues"]:
    toks, times = [], []
    for tok, n in c["show"]:
        span = words[i:i + n]; i += n
        toks.append([tok, n]); times.append([round(at + span[0][1], 3), round(at + span[-1][2], 3)])
    if c.get("skip"): continue
    cue = {"file": script["voice"], "at": times[0][0], "words": toks, "times": times}
    if c.get("eyebrow"): cue["eyebrow"] = c["eyebrow"]
    cues.append(cue)
json.dump({"size": script.get("size", 50), "cues": cues}, open(out, "w"), indent=1)
for c in cues: print(f"{c['at']:6.2f}-{c['times'][-1][1]:6.2f}  {' '.join(t for t, _ in c['words'])}")
