#!/usr/bin/env python3
"""ElevenLabs TTS with character timestamps -> <out>.mp3 + <out>.words.json ([word, start, end] in seconds).

    tts.py <script.txt> <out-prefix> [speed]

Voice = the Assetly narration voice (Minjae PVC wcVi1Dm6pTXH8UsICsKk), model eleven_v4, the same settings as
narrate (stability 0.5, style 0). The key is read from ./elk and never printed."""
import json, sys, base64, urllib.request, urllib.error
text = open(sys.argv[1]).read().strip(); out = sys.argv[2]; speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
key = open("elk").read().strip()
body = {"text": text, "model_id": "eleven_v4", "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0, "speed": speed}}
req = urllib.request.Request("https://api.elevenlabs.io/v1/text-to-speech/wcVi1Dm6pTXH8UsICsKk/with-timestamps?output_format=mp3_44100_192",
    data=json.dumps(body).encode(), headers={"xi-api-key": key, "Content-Type": "application/json"})
try: r = json.load(urllib.request.urlopen(req, timeout=120))
except urllib.error.HTTPError as e: print("HTTP", e.code, e.read()[:300]); sys.exit(1)
open(out + ".mp3", "wb").write(base64.b64decode(r["audio_base64"]))
al = r["alignment"]; chars, st, en = al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]
words, cur = [], None
for c, s, e in zip(chars, st, en):
    if c.isspace():
        if cur: words.append(cur); cur = None
        continue
    if cur is None: cur = [c, s, e]
    else: cur[0] += c; cur[2] = e
if cur: words.append(cur)
json.dump(words, open(out + ".words.json", "w"))
print(len(words), "words, last ends", words[-1][2])
