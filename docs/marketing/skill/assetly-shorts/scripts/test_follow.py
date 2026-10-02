#!/usr/bin/env python3
"""Unit test (v1.4.1): the Ask answer's spoken paraphrase follows the app's window-labelled line, in storyline's check and
with the same lib.say_windows table Q32 uses. Cases from the 10/2 close (work dir /tmp/assetly-shorts/2026-10-02-close-150206).
    python3 test_follow.py [<close work dir>]"""
import copy, importlib.util, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from lib import say_windows
W = sys.argv[1] if len(sys.argv) > 1 else "/tmp/assetly-shorts/2026-10-02-close-150206"
fails = []
def check(cond, what): print(("PASS " if cond else "FAIL ") + what); cond or fails.append(what)
check(say_windows("1W: +$5,096 (+2.0%); 1M: +$23,544") .count("week") == 1 and "month" in say_windows("1M"), "say_windows maps 1W / 1M")
check("this year" in say_windows("YTD +18%") and "week" in say_windows("+12.7% wk"), "say_windows maps YTD / wk")
sys.argv = ["storyline.py", "close", W]
spec = importlib.util.spec_from_file_location("sl", os.path.join(HERE, "storyline.py")); sl = importlib.util.module_from_spec(spec); spec.loader.exec_module(sl)
res, facts, askc, story = (json.load(open(os.path.join(W, f))) for f in ("research.json", "facts.json", "ask-check.json", "story.json"))
lines = [r["text"] for r in sl.ctx()["lines"]]
kw = next(i for i, t in enumerate(lines) if re.search(r"\b1W\b", t))
km = next((i for i, t in enumerate(lines) if re.search(r"\b1M\b", t)), None)
cases = [("Up $5,096 this week, 2.0%.", kw, True), ("Nvidia hit a record high today.", kw, False)]
if km is not None: cases += [("Over one month, your portfolio gained 10.2%.", km, True), ("One month: up 10.2%.", km, True)]
for said, k1, want in cases:
    st = copy.deepcopy(story); st["ask"] = {"line": k1, "answer_text": said}
    errs, _ = sl.check(st, res, facts, askc)
    follows = not any("does not follow" in e for e in errs)
    check(follows == want, f"storyline: {said!r} {'follows' if want else 'does not follow'} {lines[k1]!r}")
print("ALL PASS" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
