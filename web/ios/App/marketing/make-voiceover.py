#!/usr/bin/env python3
"""Renders the clip's one spoken line with OpenRouter's gpt-audio, ready to mix.

    make-voiceover.py <out.wav> [voice]

The line is a real sentence from the narration script Assetly generated for the demo account on the
day of the take, not copy written for the video: the clip claims the app reads you a brief, so the
voice says what the app actually wrote.

Two things about this endpoint that cost time to find:
  - OpenRouter rejects audio output unless `stream: true`. Without it: 400 "Audio output requires
    stream: true", with no hint that the request is otherwise fine.
  - Streamed audio arrives as base64 PCM in `delta.audio.data`, raw and headerless, at 24 kHz mono.
    That is the model's native rate; nothing here can make it 48 kHz, so mix-voiceover.sh resamples
    once with soxr rather than letting a later stage do it badly.

The system prompt matters. Without it the model ANSWERS the line instead of reading it.
"""
import base64, json, os, sys, urllib.request, wave

OUT   = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
VOICE = sys.argv[2] if len(sys.argv) > 2 else "marin"
LINE  = os.environ.get("VO_LINE", "Good morning. Your upside hinges on NVIDIA's earnings.")

def api_key() -> str:
    k = os.environ.get("OPENROUTER_API_KEY")
    if k: return k
    p = os.path.expanduser("~/.private_keys/openrouter.txt")
    for line in open(p):
        if line.startswith("key="): return line.split("=", 1)[1].strip()
    raise SystemExit(f"no key in {p} and no OPENROUTER_API_KEY")

body = {
    "model": "openai/gpt-audio",
    "modalities": ["text", "audio"],
    "audio": {"voice": VOICE, "format": "pcm16"},
    "stream": True,
    "messages": [
        {"role": "system", "content":
         "You are a text-to-speech engine. Read the user's text aloud EXACTLY as written, once. "
         "Do not answer it, comment on it, greet, or add a single word. "
         "Delivery: a calm, warm, professional market-brief narrator. Measured, unhurried, "
         "confident. Not breathless, not salesy, no upward inflection at the end."},
        {"role": "user", "content": LINE},
    ],
}
req = urllib.request.Request(
    "https://openrouter.ai/api/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Authorization": "Bearer " + api_key(), "Content-Type": "application/json"})
try:
    resp = urllib.request.urlopen(req, timeout=300)
except urllib.error.HTTPError as e:
    raise SystemExit(f"HTTP {e.code}: {e.read().decode()[:400]}")

pcm, said = [], []
for raw in resp:
    line = raw.decode("utf-8", "replace").strip()
    if not line.startswith("data:"):
        continue
    payload = line[5:].strip()
    if payload == "[DONE]":
        break
    try:
        ev = json.loads(payload)
    except json.JSONDecodeError:
        continue
    for ch in ev.get("choices", []):
        a = (ch.get("delta") or {}).get("audio") or {}
        if a.get("data"):       pcm.append(base64.b64decode(a["data"]))
        if a.get("transcript"): said.append(a["transcript"])

data = b"".join(pcm)
if not data:
    raise SystemExit("no audio in the stream")
w = wave.open(OUT, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
w.writeframes(data); w.close()

# The model occasionally embellishes despite the system prompt. Catch it here rather than in the mix.
heard, want = "".join(said).strip(), LINE.strip()
if heard and heard.rstrip(".") != want.rstrip("."):
    print(f"WARNING transcript differs\n  wanted: {want!r}\n  said:   {heard!r}", file=sys.stderr)
print(f"{VOICE}: {len(data)/2/24000:.2f}s raw -> {OUT}   said {heard!r}")
