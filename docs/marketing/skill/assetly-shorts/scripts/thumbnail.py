#!/usr/bin/env python3
"""The custom YouTube thumbnail from a Short's day.json (v1.4.0, owner 10/2), the same story as the video's cover.

    thumbnail.py <dir with day.json> [<background frame.png>] [--out <png>]

The hero (compose's cover hero: name, verified move, window label, direction) becomes the giant figure; the hook is that
story's cover line without the name ("[HPE] jumps on AI deal." -> "jumps on AI deal", at most 4 words); the edition chip is
the cover's kicker ("MIDDAY · OCT 2"); the accent / ground are the edition theme (Korea: amber, also on the arrow). No hero:
the first story's name + its hook. Renders with web/ios/App/marketing/make-thumbnail.py into <dir>/thumbnail.png (+ .json).
Used by compose (every Short) and for backfilling an earlier delivery."""
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import CODE, jload, log


def spec_from_day(day, bg=None):
    covers = [c for c in (day.get("hook") or "").split("|") if c]
    hero = day.get("hero") or {}
    hh = (day.get("hook_hero") or "").split("|")
    name, fig, lab, dr = (hero.get("name"), hero.get("fig"), hero.get("label"), hero.get("dir")) if hero else ((hh + ["", "", "", ""])[:4] if len(hh) >= 4 else ("", "", "", ""))
    def split(c):
        m = re.match(r"^\s*\[([^\]]+)\](?:'s)?\s*(.*)$", c)
        return (m.group(1), m.group(2)) if m else ("", c)
    pick = next((c for c in covers if name and split(c)[0].lower() == name.lower()), covers[0] if covers else "")
    cname, rest = split(pick)
    if not name: name = cname
    name = re.sub(r"['\u2019]s$", "", name.strip())         # "Nvidia's" on the cover is "Nvidia" on the thumbnail
    hook = " ".join(rest.strip().lstrip(",;:- ").rstrip(".!").split()[:4])
    # a hook that only repeats the giant figure ("[SK hynix], down 15.8%.") says nothing new: the card keeps name + figure
    if fig and re.sub(r"[^\d.]", "", fig) and re.sub(r"[^\d.]", "", fig) in re.sub(r"[^\d.]", "", hook): hook = ""
    return {"name": name, "fig": fig or "", "label": lab or "", "dir": dr or "", "hook": hook, "chip": day.get("hook_kicker", ""),
            "accent": day.get("accent"), "ground": day.get("ground"), "arrow_accent": day.get("theme") == "korea", "bg": bg}


def render(d, bg=None, out=None):
    day = jload(os.path.join(d, "day.json"))
    spec = spec_from_day(day, bg)
    out = out or os.path.join(d, "thumbnail.png")
    sp = out + ".spec.json"; json.dump(spec, open(sp, "w"), ensure_ascii=False)
    r = subprocess.run([sys.executable, os.path.join(CODE, "web/ios/App/marketing/make-thumbnail.py"), sp, out], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(f"thumbnail render failed: {r.stderr[-300:]}")
    log(r.stdout.strip())
    return out, spec


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
    if out in a: a.remove(out)
    render(a[0], a[1] if len(a) > 1 else None, out)
