#!/usr/bin/env python3
"""Voices a Short as a hand-off between speakers, one line each, and times the subtitles to it.

    voice-lines.py <day.json> <work-dir>

day.json "lines": [{"voice": "marin", "say": "<spoken text, numbers as words>",
                    "cues": [{"eyebrow": "MICRON", "show": ["Micron", "beat", ..., "$54.2", "billion."]}]}, ...]
  voice: marin | cedar (OpenRouter openai/gpt-audio, make-voiceover.py) | minjae (ElevenLabs, tts.py)
  "reuse": {"file": "x.wav", "from": 17.40, "to": 21.98} takes an already verified take instead of rendering
  "tempo": pitch-preserving speed-up (default 1.06 for gpt-audio, as the launch clip; 1.0 for minjae)
  a cue with "skip": true is spoken but not subtitled (the hook line the title card already shows)

gpt-audio returns no timestamps, so every line (whatever the voice) is timed the same way: faster-whisper
word timestamps on the exact trimmed file the mixer will place. Display tokens are matched to the
recognised words by their letters and digits ("$54.2" <- "$54" ".2"); a line the matcher cannot follow
falls back to spreading its tokens over the line by length, and says so.

Writes: line<i>.wav (trimmed, what the mixer places), subs.json (make-fill-subtitles spec with absolute
times), voice.json ({"cues": ["<at>:<file>:0:0:0:0:<onset>", ...], "starts": [first-word time per cue],
"last": end of the last word}).
"""
import difflib, json, os, re, subprocess, sys
day, W = json.load(open(sys.argv[1])), sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__)); M = os.path.dirname(HERE)
os.chdir(W)
PACE = ("Delivery: a crisp, confident market-news anchor reading a short evening headline for a phone video. "
        "Brisk and clear, natural emphasis on the company name and the figure, no hype, no upward inflection at the end.")
LEAD, GAP = 0.30, float(day.get("gap", 0.17))      # the voice enters at 0.30 s; lines hand over with a touch, not a pause
TRIM = ("silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,areverse,"
        "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,areverse")
def run(*a, **k): return subprocess.run(a, check=True, **k)
def dur(f): return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout)
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
NUMW = set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen "
           "nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion point percent dollars dollar".split())

from faster_whisper import WhisperModel
os.environ.setdefault("HF_HUB_OFFLINE", "1")
asr = WhisperModel("small.en", device="cpu", compute_type="int8")

subs, mix, starts, at = [], [], [], LEAD
for i, ln in enumerate(day["lines"]):
    v = ln["voice"]; raw = f"line{i}_raw.wav"
    # Whisper word-for-word (owner rule): a take whose recognised words differ from the line in anything but a figure's
    # format is rendered again, up to three takes; the last take is kept and the miss is reported (QA Q28 then decides)
    for take in range(1 if ln.get("reuse") else 3):
        if ln.get("reuse"):
            r = ln["reuse"]; run("ffmpeg", "-v", "error", "-y", "-i", r["file"], "-af", f"atrim={r['from']}:{r['to']},asetpts=PTS-STARTPTS", raw)
        elif v == "minjae":
            open(f"line{i}.txt", "w").write(ln["say"])
            run("python3", f"{HERE}/tts.py", f"line{i}.txt", f"line{i}_el"); run("ffmpeg", "-v", "error", "-y", "-i", f"line{i}_el.mp3", raw)
        else:
            r0 = subprocess.run(["python3", f"{M}/make-voiceover.py", raw, v], env=dict(os.environ, VO_LINE=ln["say"], VO_PACE=ln.get("pace", PACE)))
            if r0.returncode:
                # gpt-audio can refuse a line that reads like a request ("What should I watch today?" was answered, not
                # read, three times on 9/30): the app's own voice reads it instead
                print(f"line {i}: gpt-audio {v} would not read it verbatim; the minjae voice reads it", file=sys.stderr)
                v = "minjae"; open(f"line{i}.txt", "w").write(ln["say"])
                run("python3", f"{HERE}/tts.py", f"line{i}.txt", f"line{i}_el"); run("ffmpeg", "-v", "error", "-y", "-i", f"line{i}_el.mp3", raw)
        tempo = ln.get("tempo", 1.0 if v == "minjae" else 1.06)
        run("ffmpeg", "-v", "error", "-y", "-i", raw, "-af", TRIM, "-ar", "48000", "-ac", "1", f"line{i}_t.wav")
        open("nowords.json", "w").write('[["x",0,0]]')
        run(f"{HERE}/shrink-pauses.py", f"line{i}_t.wav", "nowords.json", "0.3", f"line{i}_p.wav", "/dev/null", capture_output=True)
        run("ffmpeg", "-v", "error", "-y", "-i", f"line{i}_p.wav", "-af", f"atempo={tempo}," + TRIM, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", f"line{i}.wav")
        D = dur(f"line{i}.wav")
        segs, _ = asr.transcribe(f"line{i}.wav", word_timestamps=True, beam_size=5)
        words = [(w.word.strip(), w.start, w.end) for s in segs for w in s.words]
        said = [norm(x) for x in ln["say"].replace("-", " ").split() if norm(x)]
        heard = [norm(x) for x, _, _ in words for x in [x.replace("-", " ")] if norm(x)]
        import difflib
        miss = [(said[a:b], heard[c:d]) for op, a, b, c, d in difflib.SequenceMatcher(a=said, b=heard, autojunk=False).get_opcodes()
                if op != "equal" and not all(re.search(r"\d", w) or w in NUMW for w in said[a:b] + heard[c:d])]
        # a brand name heard as its sound-alike ("Vultr" -> "vulture") is not a misread: no retake for that
        caps = {re.sub(r"[^a-z0-9]", "", w.lower()) for w in re.findall(r"\b[A-Z][A-Za-z]+\b", ln["say"])}
        # nor is a homophone ("weak" / "week", "beat" / "bead"): one word for one word, a letter or so apart
        def hom(a, b):
            wa = [w for w in a if not (re.search(r"\d", w) or w in NUMW)]; wb = [w for w in b if not (re.search(r"\d", w) or w in NUMW)]
            return len(wa) == len(wb) == 1 and difflib.SequenceMatcher(a=wa[0], b=wb[0]).ratio() >= 0.75
        miss = [(a, b) for a, b in miss if not (len(b) == 1 and any(w in caps for w in a) and difflib.SequenceMatcher(a=a[-1], b=b[0]).ratio() >= 0.6) and not hom(a, b)]
        if not miss: break
        print(f"line {i} take {take + 1}: whisper heard {miss}", file=sys.stderr)
    # match display tokens to recognised words by their letters/digits
    toks = [t for c in ln["cues"] for t in c["show"]]
    times, k, ok = [], 0, True
    for t in toks:
        want, got, s0, e0 = norm(t), "", None, None
        while k < len(words) and (not want or len(got) < len(want)):
            piece = norm(words[k][0])
            if s0 is None: s0 = words[k][1]
            got += piece; e0 = words[k][2]; k += 1
            if not want: break
        if s0 is None or (want and got != want):
            ok = False; break
        times.append([s0, e0])
    if not ok or len(times) != len(toks):
        # fall back: spread the tokens across the speech by their length
        # fuzzy alignment: every display token whisper did hear keeps its own time ("Jabil" heard "JBill", "2027" folded
        # into one word); the rest are spread between their heard neighbours by length (10/1: pure length timing put a
        # sentence 450 ms late)
        print(f"line {i}: recognised {' '.join(w for w, _, _ in words)!r} does not follow the display tokens; fuzzy timing", file=sys.stderr)
        A = [norm(t) for t in toks]; Bw = [norm(w) for w, _, _ in words]
        tt = [None] * len(toks)
        for blk in difflib.SequenceMatcher(a=A, b=Bw, autojunk=False).get_matching_blocks():
            for k in range(blk.size): tt[blk.a + k] = [words[blk.b + k][1], words[blk.b + k][2]]
        k = 0
        while k < len(toks):
            if tt[k] is not None: k += 1; continue
            e = k
            while e < len(toks) and tt[e] is None: e += 1
            t0 = tt[k - 1][1] if k > 0 else 0.0; t1 = tt[e][0] if e < len(toks) else D
            tot = sum(len(t) + 1 for t in toks[k:e]); cur = t0
            for m in range(k, e):
                dd = (t1 - t0) * (len(toks[m]) + 1) / tot; tt[m] = [cur, cur + dd]; cur += dd
            k = e
        times = tt
    times[-1][1] = max(times[-1][1], D - 0.03)          # whisper folds a tail word ("dollars") into the last token
    # whisper's word starts can run ~150 ms late after a pause: snap each cue's first word to the audio's
    # own onset (first 10 ms frame above -35 dBFS after >= 150 ms below it, the QA rule) within 450 ms either side (340 ms seen 9/30 after a mid-line pause)
    import wave, numpy as np
    wv = wave.open(f"line{i}.wav"); x = np.frombuffer(wv.readframes(wv.getnframes()), dtype=np.int16).astype(float) / 32768
    hop = wv.getframerate() // 100; db = np.array([20 * np.log10(np.sqrt((x[j:j + hop] ** 2).mean()) + 1e-9) for j in range(0, len(x) - hop, hop)])
    j = 0
    for c in ln["cues"]:
        s = times[j][0]; lo = max(0, int((s - 0.7) * 100)); hi = int((s + 0.7) * 100) + 1
        ons = [f for f in range(lo, min(hi, len(db))) if db[f] > -35 and (f == 0 or (db[max(0, f - 15):f] < -35).all())]
        if ons and j > 0:
            # a sentence starts at the FIRST onset after the previous word ended (10/1: whisper put "Shares hit a record"
            # 550 ms late and the nearest onset was a later syllable)
            after = [f for f in ons if f / 100 >= times[j - 1][1] - 0.02]
            times[j][0] = (after[0] if after else min(ons, key=lambda f: abs(f / 100 - s))) / 100
        elif ons: times[j][0] = min(ons, key=lambda f: abs(f / 100 - s)) / 100     # whisper runs early or late by up to ~150 ms
        times[j][1] = max(times[j][1], times[j][0] + 0.05)
        j += len(c["show"])
    j = 0
    for c in ln["cues"]:
        n = len(c["show"]); tt = [[round(at + a, 3), round(at + b, 3)] for a, b in times[j:j + n]]; j += n
        starts.append(tt[0][0])
        if not c.get("skip"):
            subs.append({"file": f"{W}/line{i}.wav", "at": tt[0][0], "words": [[t, 1] for t in c["show"]], "times": tt,
                         **({"eyebrow": c["eyebrow"]} if c.get("eyebrow") else {})})
    mix.append(f"{at:.2f}:{W}/line{i}.wav:0:0:0:0:{ln.get('onset', 1.0 if v == 'minjae' else 1.5)}")
    print(f"line {i} {v:6} {at:6.2f}-{at + D:6.2f}  {ln['say']}")
    last = at + times[-1][1] - 0.0
    at = round(at + D + GAP, 2)
json.dump({"size": 60, "cues": subs}, open("subs.json", "w"), ensure_ascii=False, indent=1)
json.dump({"cues": mix, "starts": starts, "last": round(last, 3)}, open("voice.json", "w"), indent=1)
