#!/usr/bin/env python3
"""Stage 3, the account: seeds the designed book into the edition's +daily account, runs the app's real pipeline
(prices, news, filings, insights, the edition's brief), then checks the brief a viewer will see and regenerates it
(up to twice) when it carries desk jargon, edition-wrong timing words, or "demo".

    account.py <edition> <work-dir> [--account N]

Accounts: minjae.m.lee+daily0NN@gmail.com (the +daily prefix is excluded from the owner's funnel stats), display
name "My portfolio". Default N: close 11, preopen 12, midday 13. Password in ~/.private_keys/assetly-daily0NN.txt.
Writes <work>/account.json ({uid, email, cred, book rows, brief}).
"""
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import APP, EDITIONS, ET, Stage, jdump, jload, log, now_et, rest, srk

ED, W = sys.argv[1], sys.argv[2]
N = int(sys.argv[sys.argv.index("--account") + 1]) if "--account" in sys.argv else {"close": 11, "preopen": 12, "midday": 13, "korea-open": 15, "korea-close": 16}[ED]
BRIEF = EDITIONS[ED]
JARGON = re.compile(r"\b(thesis|theses|tape|tapes|catalysts?|tripwire|setup|book(?! value)|bps|basis points|capex|EPS|beta|alpha)\b|\bprints?\b(?=\s|[.,])|\bdemo\b|—", re.I)
WRONG = {"close": re.compile(r"\bthis morning\b|\bso far today\b|\bbefore the bell\b|\bfutures point\b", re.I),
         "morning": re.compile(r"\bclosed (?:up|down|at) .{0,20}\btoday\b|\btoday's close\b", re.I),
         "midday": re.compile(r"\btoday's close\b|\bclosed (?:up|down) .{0,12}today\b", re.I),
         # the Korea briefs (kr_open 9:20 AM KST, kr_close after 3:30 PM KST): Seoul's session words
         "kr_open": re.compile(r"\btoday's close\b|\bKRX closed\b|\bafter the (?:Seoul |KRX )?close\b", re.I),
         "kr_close": re.compile(r"\bso far today\b|\bthis morning in Seoul\b|\bat the open\b(?! in New York)", re.I)}


def in_window():
    if BRIEF in ("kr_open", "kr_close"):                 # the KST clock (calendar.ts briefWindow): 8:00-15:30 / after 15:30
        from kr import kst_now
        k = kst_now(); km = k.hour * 60 + k.minute
        return 480 <= km < 930 if BRIEF == "kr_open" else km >= 930
    z = now_et(); m = z.hour * 60 + z.minute
    return {"morning": 8 * 60 <= m < 570, "midday": 570 <= m < 960, "close": m >= 960}[BRIEF]


def brief_text(b):
    s = b.get("sections") or {}
    parts = [s.get("lede", ""), s.get("overnight", ""), s.get("desk_view", ""), s.get("horizon", "") or ""]
    parts += [f"{p.get('name', '')}: {p.get('note', '')} {p.get('watch', '')}" for p in s.get("positions", [])]
    parts += list(s.get("ideas") or []) + list(s.get("calendar") or [])
    return "\n".join(x for x in parts if x)


def seed(extra):
    env = dict(os.environ, SRK_FILE=os.path.join(W, "srk"), SEED_OUT=os.path.join(W, "seed.json"))
    args = ["node", "e2e/seed-daily-demo.mjs", str(N), "--book", os.path.join(W, "book.json"), "--name", "My portfolio",
            "--brief", BRIEF, "--no-audio"] + extra + ([] if in_window() else ["--out-of-window"])
    r = subprocess.run(args, cwd=os.path.join(APP, "web"), env=env, capture_output=True, text=True, timeout=900)
    open(os.path.join(W, "seed.log"), "a").write(r.stdout + r.stderr)
    if r.returncode:
        sys.exit(f"REFUSE: seeding failed: {r.stderr[-400:]}")
    log(r.stdout.strip().splitlines()[-1])


def main():
    srk(W)
    with Stage(W, "account.seed"):
        seed(["--reset"])
    acct = jload(os.path.join(W, "seed.json"))
    uid = acct["uid"]
    with Stage(W, "account.brief_check"):
        for attempt in range(3):
            rows = rest(W, f"daily_briefs?select=id,edition,brief_date,generated_at,sections&user_id=eq.{uid}&edition=eq.{BRIEF}&order=generated_at.desc&limit=1")
            b = rows[0] if rows else None
            if not b:
                issues = ["no brief row"]
            else:
                t = brief_text(b)
                issues = sorted({m.group(0).lower() for m in JARGON.finditer(t)}) + [f"edition: {m.group(0)}" for m in WRONG[BRIEF].finditer(t)]
                if b["sections"].get("compact") or len(t) < 300: issues.append("compact/fallback brief")
            log(f"brief check {attempt + 1}: {issues or 'clean'}")
            if not issues:
                break
            if attempt < 2:
                seed(["--brief-only"])
        acct["brief"] = {"id": b and b["id"], "generated_at": b and b["generated_at"], "issues": issues, "text": brief_text(b) if b else ""}
        jdump(acct, os.path.join(W, "account.json"))
        if issues and any(not i.startswith("edition") for i in issues if i != "compact/fallback brief"):
            log("WARN: the brief still carries", issues, "(recorded anyway; the edit keeps it out of zoomed frames)")


main()
