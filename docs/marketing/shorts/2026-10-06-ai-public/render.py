"""Render one 'Follow the AI money' Short: stationary scenes cut on the narration's line starts, a 0.15 s bar reveal
where a scene has _g25/_g50/_g75 frames, the full US music bed ducked under the founder voice, timed caption strips
on the lower band, and the approved Oct 3 outro ("Assetly. Invest smarter." + silent App Store line).
    python3 render.py 01-google-cash        (voice in /tmp/ai-money/<slug> from voice-lines.py)
"""
from pathlib import Path
import json, subprocess, sys, shutil, math, concurrent.futures
from PIL import Image, ImageDraw, ImageFont

R = Path(__file__).resolve().parent; M = R.parents[3] / 'web/ios/App/marketing'
LAB = R.parent / '2026-10-03-ai-investment-lab'
slug = sys.argv[1]; o = R / slug; w = Path('/tmp/ai-money') / slug
day = json.load(open(o / 'day.json')); v = json.load(open(w / 'voice.json')); sub = json.load(open(w / 'subs.json'))
starts = [c['times'][0][0] for c in sub['cues']]
FPS = 60; OUTRO_WAV = LAB / '03-nvidia/audio/outro.wav'; OUTRO_PNG = LAB / 'outro.png'
dur = lambda f: float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], text=True))
outro_at = math.ceil((v['last'] + 0.55) * 4) / 4
L = math.ceil((outro_at + 0.2 + dur(OUTRO_WAV) + 0.65) * 4) / 4
lo, hi = day['len_range']; assert lo <= L <= hi, f'{slug}: {L}s outside {lo}-{hi}s'

import re as _re
def with_reveal(img, a, b, stem):
    reveal = [o / 'scenes' / f'{stem}_g{g}.png' for g in (25, 50, 75)]
    out = []
    if all(p.exists() for p in reveal) and b - a > 0.6:
        for k, p in enumerate(reveal): out.append((p, a + k * 0.05, a + (k + 1) * 0.05))
        a += 0.15
    return out + [(img, a, b)]
segs = []
for i in range(len(starts)):
    a = 0.0 if i == 0 else starts[i] - 0.085; b = (starts[i + 1] - 0.085) if i + 1 < len(starts) else outro_at
    # word-synced states: <line>_at<k>.png shows from word k of that line (k=0: the line's start)
    var = sorted(((int(_re.match(rf'{i:02}_at(\d+)\.png$', p.name).group(1)), p) for p in (o / 'scenes').glob(f'{i:02}_at*.png')
                  if _re.match(rf'{i:02}_at(\d+)\.png$', p.name)))
    if var:
        times = [a if (k == 0 or j == 0) else max(a, sub['cues'][i]['times'][k][0] - 0.06) for j, (k, _) in enumerate(var)]   # the first state covers the line's start
        for j, (k, p) in enumerate(var):
            segs += with_reveal(p, times[j], times[j + 1] if j + 1 < len(var) else b, f'{i:02}_at{k}')
    else:
        segs += with_reveal(o / 'scenes' / f'{i:02}.png', a, b, f'{i:02}') if i > 0 else [(o / 'scenes' / f'{i:02}.png', a, b)]
segs.append((OUTRO_PNG, outro_at, L))
plan = []
for j, (img, a, b) in enumerate(segs):
    n = round(b * FPS) - round(a * FPS); assert n > 0, (img, a, b)
    plan.append({'image': str(img), 'start': a, 'end': b, 'frames': n, 'path': str(w / f'seg-{j:02}.mp4')})

def enc(s):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-i', s['image'], '-vf', 'format=yuv420p',
                    '-frames:v', str(s['frames']), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2', s['path']], check=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: list(pool.map(enc, plan))
(w / 'concat.txt').write_text(''.join(f"file '{s['path']}'\n" for s in plan))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(w / 'concat.txt'), '-c', 'copy', str(w / 'picture.mp4')], check=True)

# music bed to the last frame, lift on the outro; voice + outro ducked over it, -14 LUFS
mus = json.load(open(M / 'shorts/music-short.json'))['us']; mus.update(len=L, card_at=outro_at)
(w / 'music.json').write_text(json.dumps(mus)); subprocess.run([sys.executable, str(M / 'make-spot-music.py'), str(w / 'music.json'), str(w / 'music.wav')], check=True)
cues = v['cues'] + [f'{outro_at + 0.2}:{OUTRO_WAV}:0:0:0:0:1.0']
for sc in ('1.0', '1.2', '1.4'):     # a short, soft hook line can duck the bed a hair under -6 dB; key it a little harder
    env = dict(__import__('os').environ, VO_OUT=str(w / 'vo-track.wav'), DUCK_SC=sc)
    if subprocess.run([str(M / 'mix-spot-audio.sh'), str(w / 'music.wav'), str(w / 'mix.wav'), str(L)] + cues, env=env).returncode == 0: break
else: sys.exit('mix failed at every duck level')

# caption strips (local ffmpeg has no libass): <= 2 lines, measured wrap, padded through the end
F = Path.home() / 'Library/Fonts/assetly-brand/SchibstedGrotesk[wght].ttf'; ft = ImageFont.truetype(str(F), 58); ft.set_variation_by_axes([700])
dr = ImageDraw.Draw(Image.new('RGB', (1080, 1920)))
def wrap(words):
    out, ln = [], ''
    for x in words:
        c = (ln + ' ' + x).strip()
        if dr.textlength(c, font=ft) > 860: out.append(ln); ln = x
        else: ln = c
    return out + [ln]
cd = w / 'cap'; cd.mkdir(exist_ok=True); blank = Image.new('RGBA', (1080, 230), (0, 0, 0, 0)); blank.save(cd / 'blank.png')
# chunk each line into <= 2 caption lines by measured width, timed on the words
chunks = []
for j, c in enumerate(sub['cues']):
    ws = [x[0] for x in c['words']]; ts_ = c['times']; k = 0
    while k < len(ws):
        e = k + 1
        while e < len(ws) and len(wrap(ws[k:e + 1])) <= 2 and not (ws[e - 1].endswith(('.', '?')) and e - k >= 3): e += 1
        while e < len(ws) and e - k > 1 and _re.match(r'^[$\d]', ws[e - 1]): e -= 1     # keep '$700' with 'billion'
        chunks.append((ws[k:e], ts_[k][0], ts_[e - 1][1], j)); k = e
entries, cursor, srt = [], 0.0, []
for j, (ws, a, b0, li) in enumerate(chunks):
    ls = wrap(ws); assert len(ls) <= 2, ls
    nxt = chunks[j + 1][1] if j + 1 < len(chunks) else L
    b = min(b0 + 0.04, nxt)
    if a > cursor: entries.append((cd / 'blank.png', a - cursor))
    im = blank.copy(); d = ImageDraw.Draw(im); y = 186 - len(ls) * 74
    for ln in ls:
        tw = d.textlength(ln, font=ft); x = 540 - tw / 2
        d.rounded_rectangle((x - 16, y - 4, x + tw + 16, y + 70), 12, fill=(17, 25, 37, 245)); d.text((x, y), ln, font=ft, fill='white'); y += 74
    p = cd / f'{j:03}.png'; im.save(p); entries.append((p, b - a)); cursor = b
    ts = lambda t: f'{int(t // 3600):02}:{int(t % 3600 // 60):02}:{int(t % 60):02},{int(round(t % 1 * 1000)):03}'
    srt.append(f'{j + 1}\n{ts(a)} --> {ts(b)}\n' + '\n'.join(ls) + '\n')
srt.append(f'{len(chunks) + 1}\n{ts(outro_at + 0.2)} --> {ts(L - 0.3)}\nAssetly. Invest smarter.\n')
entries.append((cd / 'blank.png', L - cursor))
(w / 'cap.txt').write_text(''.join(f"file '{p}'\nduration {d:.4f}\n" for p, d in entries) + f"file '{cd / 'blank.png'}'\n")
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(w / 'cap.txt'), '-vf', 'fps=60,tpad=stop_mode=clone:stop_duration=10',
                '-t', str(L), '-c:v', 'qtrle', '-pix_fmt', 'argb', str(w / 'cap.mov')], check=True)
final = o / f'{slug}.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(w / 'picture.mp4'), '-i', str(w / 'mix.wav'), '-i', str(w / 'cap.mov'),
                '-filter_complex', '[0:v][2:v]overlay=0:1370:shortest=1[v]', '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow',
                '-crf', '15', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-af', f'alimiter=limit=0.78:level=0:attack=1:release=50,afade=t=out:st={L - 0.3}:d=0.3', '-c:a', 'aac_at', '-b:a', '192k', '-movflags', '+faststart',
                str(final)], check=True)
shutil.copy2(final, o / f'{slug}-upload.mp4'); (o / 'captions.srt').write_text('\n'.join(srt))
for f in list(w.glob('line*.wav')): shutil.copy2(f, o / 'audio' / f.name)
shutil.copy2(w / 'subs.json', o / 'subs.json'); shutil.copy2(w / 'voice.json', o / 'audio' / 'voice.json')
(o / 'timeline.json').write_text(json.dumps({'duration': L, 'outro_at': outro_at, 'segments': plan, 'line_starts': starts}, indent=1))
for f in (o / 'proof').glob('*.png'): f.unlink()
for k, s in enumerate(plan):
    if s['end'] - s['start'] > 0.3:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f"{(s['start'] + s['end']) / 2:.3f}", '-i', str(final), '-frames:v', '1', str(o / 'proof' / f'{k:02}.png')], check=True)
print(slug, 'RENDERED', L, 's')
