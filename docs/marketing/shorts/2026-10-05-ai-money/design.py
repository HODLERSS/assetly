"""Scenes and thumbnails for the 'Follow the AI money' trio (research 04 OCT 2026).

Dark, stationary, typography-led (owner's approved explainer palette), but faster than the Oct 3 lab: a scene
change every 2-4 s on the narration's word timings, a giant hook figure on frame 0, and one visual per claim.
    python3 design.py            # all scenes + thumbnails
Figures are copied from sources.md; nothing here is computed from live prices.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

R = Path(__file__).resolve().parent
FONT = Path.home() / 'Library/Fonts/assetly-brand/SchibstedGrotesk[wght].ttf'
ICON = Image.open(R.parents[3] / 'web/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png').convert('RGBA')
BG, INK, ACC, BAR, PANEL, LINE, MUT = '#101216', '#F4F5FA', '#A4B3FF', '#5267C4', '#22314B', '#34415A', '#A7B2C9'
LOSS = '#FF8F7E'          # used only for a negative figure
DATE = '04 OCT 2026'
GROW = 1.0              # bar height fraction; <1 writes reveal frames <scene>_g<pct>.png


def font(n, w=650):
    f = ImageFont.truetype(str(FONT), n); f.set_variation_by_axes([w]); return f


class Scene:
    def __init__(self, series, seq):
        self.im = Image.new('RGB', (1080, 1920), BG); self.d = ImageDraw.Draw(self.im)
        self.im.paste(ICON.resize((50, 50)), (80, 110), ICON.resize((50, 50)))
        self.t(146, 112, 'Assetly', 38, 750); self.t(80, 182, series.upper(), 28, 650, MUT)
        self.t(1000 - self.d.textlength(seq, font=font(28)), 119, seq, 28, 650, MUT)
        self.d.line((80, 245, 1000, 245), fill=LINE, width=2)
        self.t(80, 1700, f'RESEARCH · {DATE} · Not financial advice', 25, 500, MUT)

    def t(self, x, y, s, n=64, w=650, col=None):
        self.d.text((x, y), s, font=font(n, w), fill=col or INK)

    def c(self, y, s, n=64, w=750, col=None):                     # centred on x=540
        self.t(540 - self.d.textlength(s, font=font(n, w)) / 2, y, s, n, w, col)

    def label(self, y, s, col=ACC, n=32):
        self.t(80, y, s, n, 700, col)

    def src(self, s):
        self.t(80, 1310, s, 27, 500, MUT)

    def bars(self, items, top=470, base=1150, maxv=None, width=230, unit='$'):
        """Zero-baseline vertical bars; value and label centred on each bar's centreline."""
        self.has_bars = True
        maxv = maxv or max(v for _, v, *_ in items); n = len(items); gap = (920 - n * width) / (n + 1)
        self.d.line((80, base, 1000, base), fill=LINE, width=3)
        for i, (lab, v, *opt) in enumerate(items):
            col = opt[0] if opt else BAR; x = 80 + gap + i * (width + gap); h = max(4, (base - top - 110) * v / maxv * GROW)
            self.d.rounded_rectangle((x, base - h, x + width, base), 14, fill=col)
            val = opt[1] if len(opt) > 1 else f'{unit}{v:g}B'
            fv = font(64, 800); self.t(x + width / 2 - self.d.textlength(val, font=fv) / 2, base - h - 92, val, 64, 800)
            for k, part in enumerate(lab.split('\n')):
                fl = font(34, 600); self.t(x + width / 2 - self.d.textlength(part, font=fl) / 2, base + 22 + k * 42, part, 34, 600, MUT)

    def arrow(self, x, y1, y2):
        self.d.line((x, y1, x, y2 - 18), fill=ACC, width=7)
        self.d.polygon([(x - 18, y2 - 24), (x + 18, y2 - 24), (x, y2)], fill=ACC)

    def node(self, y, s, sub=None, h=150):
        self.d.rounded_rectangle((140, y, 940, y + h), 26, fill=PANEL)
        f = font(54, 750); ty = y + (h - (100 if sub else 64)) / 2
        self.t(540 - self.d.textlength(s, font=f) / 2, ty, s, 54, 750)
        if sub: self.c(ty + 64, sub, 32, 550, ACC)

    def save(self, p):
        if GROW >= 1: self.im.save(p)
        elif getattr(self, 'has_bars', False): self.im.save(p.with_name(f'{p.stem}_g{int(GROW * 100):02}.png'))


GOOD = '#7BE0A6'


def watch(S, seq, title, rows, lit, path, sub=None):
    """A what-to-watch list; rows light as they are spoken."""
    s = Scene(S, seq); s.label(330, 'WHAT TO WATCH' + (f' · {sub}' if sub else ''))
    y = 410
    for ln in title: s.t(80, y, ln, 84, 800); y += 100
    y += 40
    for k, (head, note) in enumerate(rows):
        on = k < lit; s.d.rounded_rectangle((80, y, 1000, y + 190), 26, fill=BAR if on else PANEL)
        s.t(120, y + 30, f'{k + 1}', 64, 850, INK if on else MUT); s.t(200, y + 32, head, 56, 800, INK if on else MUT)
        s.t(200, y + 112, note, 36, 600, INK if on else MUT); y += 215
    s.save(path)


def verdict(S, seq, good, bad, show_bad, path, src=None):
    """The conclusion: what makes the case work, and the warning sign."""
    s = Scene(S, seq); s.label(330, 'THE BOTTOM LINE')
    for k, (head, lines, col, on) in enumerate((('WORKING IF', good, GOOD, True), ('WARNING SIGN', bad, LOSS, show_bad))):
        y = 420 + k * 430; s.d.rounded_rectangle((80, y, 1000, y + 390), 30, fill=PANEL if on else BG, outline=col if on else LINE, width=5)
        if not on: continue
        s.d.ellipse((120, y + 48, 156, y + 84), fill=col); s.t(180, y + 36, head, 46, 800, col)
        for j, ln in enumerate(lines): s.t(120, y + 130 + j * 82, ln, 62, 800)
    if src: s.src(src)
    s.save(path)


def thumb(path, top, big, big_col, sub1, sub2, eyebrow):
    """Dark, typography-led 1080x1920 thumbnail: question + one figure, readable at 180x320."""
    im = Image.new('RGB', (1080, 1920), BG); d = ImageDraw.Draw(im); T = lambda x, y, s, n, w=750, col=INK: d.text((x, y), s, font=font(n, w), fill=col)
    im.paste(ICON.resize((60, 60)), (90, 150), ICON.resize((60, 60))); T(166, 152, 'Assetly', 44, 750)
    T(90, 470, eyebrow, 40, 700, ACC)
    y = 560
    for ln in top: T(90, y, ln, 118, 800); y += 136
    n = 250                                                    # shrink the hero figure until it fits x90..990 (Oct 4: "3 numbers" was cut off)
    while d.textlength(big, font=font(n, 850)) > 900 and n > 120: n -= 10
    T(90, y + 10 + (250 - n) * 0.6, big, n, 850, big_col); y += 320
    d.line((90, y + 20, 990, y + 20), fill=ACC, width=6)
    T(90, y + 70, sub1, 60, 650); T(90, y + 145, sub2, 60, 650, MUT)
    T(90, 1700, DATE, 40, 650, MUT)
    im.save(path); im.convert('RGB').save(str(path).replace('.png', '.jpg'), quality=92)
    im.resize((180, 320), Image.LANCZOS).save(str(path).replace('thumbnail.png', 'thumbnail-mobile.png'))


def google(o):
    S = 'Follow the AI money · 1/4 · Google'; n = 9
    s = Scene(S, f'01/{n:02}'); s.label(330, 'FREE CASH FLOW · Q2 2026'); s.t(80, 400, 'Google', 120, 850)
    s.t(80, 540, '−$5.9B', 250, 850, LOSS); s.t(80, 860, 'Spent more cash', 84, 750); s.t(80, 960, 'than it made.', 84, 750, ACC)
    s.src('Alphabet Q2 2026 earnings release (8-K), Jul 22, 2026'); s.save(o / '00.png')
    s = Scene(S, f'02/{n:02}'); s.label(330, 'OPERATING CASH FLOW · Q2 2026'); s.t(80, 390, 'Cash the business', 78, 750); s.t(80, 480, 'brought in', 78, 750)
    s.bars([('Cash in', 39.1)], maxv=44.9, top=640); s.src('Alphabet Q2 2026 earnings release'); s.save(o / '01.png')
    s = Scene(S, f'03/{n:02}'); s.label(330, 'Q2 2026 · BILLIONS OF DOLLARS'); s.t(80, 390, 'Spending ran', 78, 750); s.t(80, 480, 'ahead of cash', 78, 750, ACC)
    s.bars([('Cash in', 39.1), ('Capital\nspending', 44.9, '#7C8FE8')], top=640); s.src('Capital expenditures: servers, data centers, network'); s.save(o / '02.png')
    s = Scene(S, f'04/{n:02}'); s.label(330, 'CAPITAL SPENDING · Q2 2025 vs Q2 2026'); s.t(80, 390, 'Doubled in', 78, 750); s.t(80, 480, 'one year', 78, 750, ACC)
    s.bars([('Q2 2025', 22.4), ('Q2 2026', 44.9, '#7C8FE8')], top=640); s.src('Alphabet Q2 2026 earnings release'); s.save(o / '03.png')
    s = Scene(S, f'05/{n:02}'); s.label(330, 'GOOGLE CLOUD'); s.t(80, 560, "But here's", 130, 850); s.t(80, 720, 'the other', 130, 850); s.t(80, 880, 'side.', 130, 850, ACC)
    s.save(o / '04_at0.png')
    s = Scene(S, f'05/{n:02}'); s.label(330, 'GOOGLE CLOUD OPERATING INCOME'); s.t(80, 390, 'The other side:', 78, 750); s.t(80, 480, 'profit 3.1×', 78, 750, ACC)
    s.bars([('Q2 2025', 2.8), ('Q2 2026', 8.8, '#7C8FE8')], top=640); s.src('Alphabet Q2 2026 earnings release · GAAP'); s.save(o / '04.png')
    if GROW >= 1: s.im.save(o / '04_at5.png')
    else: s.im.save(o / f'04_at5_g{int(GROW * 100):02}.png')
    s = Scene(S, f'06/{n:02}'); s.label(330, '2026 CAPITAL SPENDING PLAN'); s.t(80, 470, 'Up to', 84, 750, MUT)
    s.t(80, 570, '$205B', 250, 850, ACC); s.t(80, 880, 'this year', 84, 750); s.t(80, 990, 'Guidance: $195–205B', 54, 600, MUT)
    s.src('Alphabet Q2 2026 earnings call, Jul 22, 2026'); s.save(o / '05.png')
    S2 = S; n = 9
    rows = [('Cloud operating income', 'growing faster than spending?'), ('Free cash flow', 'back above zero?')]
    for lit, at in ((0, 0), (1, 9), (2, 12)): watch(S2, '07/09', ['On the next', 'earnings report'], rows, lit, o / f'06_at{at}.png', 'GOOGLE')
    watch(S2, '07/09', ['On the next', 'earnings report'], rows, 2, o / '06.png', 'GOOGLE')
    g = ['Cloud profit grows', 'faster than spending']; b = ['Cash stays negative', 'while Cloud slows']
    verdict(S2, '08/09', g, b, False, o / '07.png'); verdict(S2, '09/09', g, b, True, o / '08.png', 'Investment test, not a forecast · valuation still matters')
    thumb(o / 'thumbnail.png', ['Is Google', 'burning cash?'], '−$5.9B', LOSS, 'Free cash flow, Q2 2026', 'AI spending > cash in', 'GOOGLE · AI SPENDING')


def nvidia(o):
    S = 'Follow the AI money · 2/4 · Nvidia'; n = 9
    s = Scene(S, f'01/{n:02}'); s.label(330, 'NVIDIA · SEP 28, 2026'); s.t(80, 440, '$150B', 250, 850, ACC)
    s.t(80, 760, 'The biggest buyback', 84, 750); s.t(80, 860, 'increase ever.', 84, 750, MUT); s.src('Nvidia board authorization, Sep 28, 2026'); s.save(o / '00.png')
    s = Scene(S, f'02/{n:02}'); s.label(330, 'BUYBACK INCREASE · BILLIONS'); s.t(80, 390, 'Beats Apple\'s', 78, 750); s.t(80, 480, 'old record', 78, 750, ACC)
    s.bars([('Apple\n2024', 110), ('Nvidia\n2026', 150, '#7C8FE8')], top=640); s.src('Apple May 2024 authorization; Nvidia Sep 28, 2026'); s.save(o / '01.png')
    s = Scene(S, f'03/{n:02}'); s.label(330, 'THE QUESTION'); s.t(80, 600, 'Where does', 120, 800); s.t(80, 740, 'that cash', 120, 800); s.t(80, 880, 'come from?', 120, 800, ACC)
    s.save(o / '02.png')
    names = ['Amazon', 'Microsoft', 'Google', 'Meta']
    def capex(lit, total, path):
        s = Scene(S, f'04/{n:02}'); s.label(330, '2026 CAPITAL SPENDING PLANS · 4 COMPANIES')
        for k, nm in enumerate(names):
            y = 420 + k * 120; on = k < lit; s.d.rounded_rectangle((80, y, 1000, y + 100), 20, fill=BAR if on else PANEL)
            s.t(120, y + 22, nm, 52, 800, INK if on else MUT)
        if total: s.t(80, 930, 'Over $700B', 150, 850, ACC); s.t(80, 1110, 'Mostly data centers, chips, servers', 44, 600, MUT)
        s.src('Company guidance compiled by the FT (≈$725B)'); s.save(path)
    for k, at in enumerate((0, 1, 2, 4)): capex(k + 1, False, o / f'03_at{at}.png')
    capex(4, True, o / '03_at7.png'); capex(4, True, o / '03.png')
    s = Scene(S, f'05/{n:02}'); s.label(330, 'NVIDIA DATA CENTER REVENUE · QUARTER'); s.t(80, 390, 'More than', 78, 750); s.t(80, 480, 'double', 78, 750, ACC)
    s.bars([('Year ago', 41.0), ('Jul 2026\nquarter', 89.0, '#7C8FE8')], top=640); s.src('Nvidia Q2 FY2027 results, Aug 26, 2026 (+117%)'); s.save(o / '04.png')
    s = Scene(S, f'06/{n:02}'); s.label(330, 'HOW THE MONEY FLOWS · INFERENCE')
    s.node(420, "Big Tech's AI budgets"); s.arrow(540, 575, 690); s.node(695, "Nvidia's chip sales"); s.arrow(540, 850, 965); s.node(970, '$150B buyback')
    s.src('Editorial inference from the figures above'); s.save(o / '05.png')
    s = Scene(S, '07/09'); s.label(330, 'THE SIGNAL'); s.t(80, 520, 'Watch the', 130, 850); s.t(80, 680, 'budgets,', 130, 850, ACC); s.t(80, 840, 'not the buyback.', 96, 800, MUT); s.save(o / '06.png')
    for at, plans in ((0, False), (4, True)):
        s = Scene(S, '08/09'); s.label(330, 'WHAT TO WATCH · BIG TECH EARNINGS'); s.t(80, 410, 'When they report', 84, 800)
        for k, nm in enumerate(['Amazon', 'Microsoft', 'Google', 'Meta']):
            x = 80 + (k % 2) * 470; y = 560 + (k // 2) * 150; s.d.rounded_rectangle((x, y, x + 450, y + 125), 22, fill=BAR); s.t(x + 225 - s.d.textlength(nm, font=font(52, 800)) / 2, y + 30, nm, 52, 800)
        if plans: s.t(80, 900, 'Listen for next', 72, 800); s.t(80, 990, "year's spending plans", 72, 800, ACC)
        s.save(o / f'07_at{at}.png')
    s.save(o / '07.png')
    for at, miss in ((0, False), (9, True)):
        s = Scene(S, '09/09'); s.label(330, "NVIDIA'S OWN FORECAST · NEXT QUARTER"); s.t(80, 420, 'Guided sales', 84, 800, MUT); s.t(80, 520, '$108B', 250, 850, ACC)
        if miss:
            s.d.rounded_rectangle((80, 870, 1000, 1180), 30, fill=PANEL, outline=LOSS, width=5); s.d.ellipse((120, 918, 156, 954), fill=LOSS); s.t(180, 906, 'IF NVIDIA MISSES IT', 46, 800, LOSS)
            s.t(120, 1000, 'First sign the budgets', 60, 800); s.t(120, 1080, 'are cooling', 60, 800)
        s.src('Nvidia outlook for Q3 FY2027, Aug 26, 2026: $108.0B ±2%'); s.save(o / f'08_at{at}.png')
    s.save(o / '08.png')
    thumb(o / 'thumbnail.png', ['Who pays for', 'this buyback?'], '$150B', ACC, "Nvidia's record buyback", 'Follow the AI money.', 'NVIDIA · RECORD BUYBACK')


TICK = [('NVDA', 'chips'), ('AMD', 'chips'), ('ARM', 'chips'), ('AVGO', 'chips'), ('TSM', 'chips'), ('DELL', 'servers'), ('HPE', 'servers'), ('NBIS', 'cloud'), ('AMZN', 'cloud')]


def grid(s, lit, y=430, show_layer=False):
    for i, (tk, layer) in enumerate(TICK):
        x = 80 + (i % 3) * 312; yy = y + (i // 3) * 190; on = tk in lit
        s.d.rounded_rectangle((x, yy, x + 290, yy + 165), 22, fill=BAR if on else PANEL)
        f = font(60, 800); s.t(x + 145 - s.d.textlength(tk, font=f) / 2, yy + (30 if show_layer else 48), tk, 60, 800, INK if on else MUT)
        if show_layer: fl = font(32, 600); s.t(x + 145 - s.d.textlength(layer, font=fl) / 2, yy + 104, layer, 32, 600, ACC if not on else INK)


def onebet(o, ask):
    S = 'Follow the AI money · 3/4 · Your portfolio'; n = 10
    s = Scene(S, f'01/{n:02}'); s.label(330, 'AN ILLUSTRATIVE PORTFOLIO'); s.t(80, 440, '9 stocks.', 170, 850); s.t(80, 640, '1 bet?', 170, 850, ACC)
    grid(s, [], y=900); s.save(o / '00.png')
    chips = ['NVDA', 'AMD', 'ARM', 'AVGO', 'TSM']
    for k in range(5):
        s = Scene(S, f'02/{n:02}'); s.label(330, 'CHIPS'); s.t(80, 390, 'Chip makers', 84, 750); grid(s, chips[:k + 1], y=560, show_layer=True)
        s.save(o / f'01_at{k}.png')
        if k == 4: s.save(o / '01.png')
    rest = [('DELL', 0), ('HPE', 2), ('NBIS', 3), ('AMZN', 5)]
    for j, (tk, at) in enumerate(rest):
        s = Scene(S, f'03/{n:02}'); s.label(330, 'SERVERS AND CLOUD'); s.t(80, 390, 'Plus servers, cloud', 84, 750)
        grid(s, chips + [t for t, _ in rest[:j + 1]], y=560, show_layer=True); s.save(o / f'02_at{at}.png')
        if j == 3: s.save(o / '02.png')
    q = ask['question']
    s = Scene(S, f'04/{n:02}'); s.label(330, 'ASKED IN ASSETLY'); s.t(80, 420, 'Looks', 96, 800, MUT); s.t(80, 530, 'diversified.', 96, 800)
    s.d.rounded_rectangle((80, 760, 1000, 1150), 28, fill=PANEL)
    y = 800
    for ln in wrap(s, q, 58, 840): s.t(120, y, ln, 58, 700); y += 76
    s.t(120, 1080, 'Your question to Assetly', 32, 600, ACC); s.src('Illustrative portfolio · actual question, Oct 2, 2026'); s.save(o / '03.png')
    s = Scene(S, f'05/{n:02}'); s.label(330, "ASSETLY'S ANSWER · EXCERPT")
    s.t(80, 400, '“All nine holdings', 80, 800); s.t(80, 495, 'touch AI', 80, 800); s.t(80, 590, 'infrastructure.”', 80, 800, ACC)
    for k, (lay, names) in enumerate([('Chips', 'NVDA · AMD · ARM · AVGO · TSM'), ('Servers', 'HPE · DELL'), ('Cloud', 'NBIS · AMZN')]):
        y = 760 + k * 160; s.d.rounded_rectangle((80, y, 1000, y + 135), 22, fill=PANEL); s.t(120, y + 34, lay, 54, 800, ACC); s.t(370, y + 46, names, 40, 650)
    s.src('Actual Assetly answer, Oct 2, 2026 · verbatim first line; layers summarized'); s.save(o / '04.png')
    s = Scene(S, f'06/{n:02}'); s.label(330, 'THE SHARED RISK')
    for k, lay in enumerate(['Chips', 'Servers', 'Cloud']): s.node(420 + k * 175, lay, h=140)
    s.arrow(540, 945, 1020); s.d.rounded_rectangle((140, 1025, 940, 1175), 26, fill=BAR); s.c(1068, 'AI spending', 60, 800)
    s.src('If AI spending slows, they can fall together'); s.save(o / '05.png')
    s = Scene(S, '07/10'); s.label(330, 'THE TAKEAWAY'); s.t(80, 470, '9 tickers', 150, 850); s.t(80, 650, 'can still be', 96, 750, MUT); s.t(80, 780, '1 bet.', 150, 850, ACC)
    s.save(o / '06.png')
    s = Scene(S, '08/10'); s.label(330, 'DO THIS TODAY'); s.t(80, 560, 'A two-minute', 130, 850); s.t(80, 720, 'check', 130, 850, ACC); s.save(o / '07.png')
    def step(num, head, sub, note, bad, path):
        s = Scene(S, f'{num + 8:02}/10'); s.label(330, f'STEP {num}')
        y = 420
        for ln in head: s.t(80, y, ln, 84, 800); y += 100
        s.t(80, y + 20, sub, 44, 600, MUT)
        if note:
            s.d.rounded_rectangle((80, 900, 1000, 1190), 30, fill=PANEL, outline=LOSS if bad else ACC, width=5)
            for j, ln in enumerate(note): s.t(120, 950 + j * 82, ln, 62, 800)
        s.save(path)
    n1 = ['Most of your portfolio?', 'One slowdown hits it all']; n2 = ['Nothing?', "That's your blind spot"]
    step(1, ['Add up everything', 'tied to one theme'], 'AI, chips, cloud: count them together', None, False, o / '08_at0.png')
    step(1, ['Add up everything', 'tied to one theme'], 'AI, chips, cloud: count them together', n1, True, o / '08_at7.png'); step(1, ['Add up everything', 'tied to one theme'], 'AI, chips, cloud: count them together', n1, True, o / '08.png')
    step(2, ['What still holds up', 'if AI spending pauses?'], 'Cash, other sectors, other themes', None, False, o / '09_at0.png')
    step(2, ['What still holds up', 'if AI spending pauses?'], 'Cash, other sectors, other themes', n2, True, o / '09_at10.png'); step(2, ['What still holds up', 'if AI spending pauses?'], 'Cash, other sectors, other themes', n2, True, o / '09.png')
    thumb(o / 'thumbnail.png', ['You own', '9 stocks.'], '1 bet?', ACC, 'Chips, servers, cloud:', 'one AI build-out.', 'YOUR PORTFOLIO · AI RISK')


def spacex(o):
    S = 'Follow the AI money · 4/4 · SpaceX'; N = 9
    s = Scene(S, '01/09'); s.label(330, 'SPACEX · NOW PUBLIC'); s.t(80, 450, 'Buy SpaceX,', 130, 850); s.t(80, 610, 'you own', 130, 850, MUT); s.t(80, 770, 'Grok.', 210, 850, ACC)
    s.src('SpaceX AI segment: xAI (Grok), X and cloud services'); s.save(o / '00.png')
    def segs(lit_ai, path):
        s = Scene(S, '02/09'); s.label(330, "SPACEX'S THREE BUSINESSES")
        for k, (nm, sub) in enumerate((('Starlink', 'connectivity'), ('Rockets', 'space'), ('AI', 'Grok · X · cloud'))):
            y = 420 + k * 230; on = (k == 2 and lit_ai)
            s.d.rounded_rectangle((80, y, 1000, y + 200), 28, fill=BAR if on else PANEL); s.t(130, y + 40, nm, 72, 850, INK if (on or not lit_ai) else MUT); s.t(130, y + 128, sub, 40, 600, INK if on else MUT)
        s.src('SpaceX Form 10-Q, quarter ended Jun 30, 2026: segment reporting'); s.save(path)
    segs(False, o / '01_at0.png'); segs(True, o / '01_at7.png'); segs(True, o / '01.png')
    s = Scene(S, '03/09'); s.label(330, 'AI SEGMENT REVENUE · Q2'); s.t(80, 390, 'Up 247%', 78, 800); s.t(80, 480, 'in a year', 78, 750, ACC)
    s.bars([('Q2 2025', 0.74), ('Q2 2026', 2.56, '#7C8FE8')], top=640); s.src('SpaceX Q2 2026 results, Aug 4, 2026 · year-ago = 2.56 / 3.47'); s.save(o / '02.png')
    s = Scene(S, '04/09'); s.label(330, 'AI SEGMENT OPERATING LOSS · Q2 2026'); s.t(80, 470, '−$1.3B', 250, 850, LOSS); s.t(80, 790, 'lost in', 84, 750, MUT); s.t(80, 890, 'three months', 84, 800)
    s.src('Reported operating loss $1.26B · SpaceX Q2 2026 results'); s.save(o / '03.png')
    def capex(ai, path):
        s = Scene(S, '05/09'); s.label(330, 'EQUIPMENT SPENDING · Q2 2026'); s.t(80, 400, 'Where $18.4B went', 84, 800)
        s.d.rounded_rectangle((80, 640, 1000, 820), 24, fill=PANEL)
        if ai: w = 920 * 15.8 / 18.4; s.d.rounded_rectangle((80, 640, 80 + w, 820), 24, fill=BAR); s.t(120, 690, 'AI  $15.8B', 64, 850); s.t(80 + w + 12, 860, 'other $2.6B', 36, 600, MUT); s.t(80, 900, '86% to AI', 110, 850, ACC)
        else: s.t(120, 690, '$18.4B', 64, 850)
        s.src('Capital expenditures, Q2 2026 (company results as reported by CNN/Quartz)'); s.save(path)
    capex(False, o / '04_at0.png'); capex(True, o / '04_at8.png'); capex(True, o / '04.png')
    for at, nv in ((0, False), (15, True)):
        s = Scene(S, '06/09'); s.label(330, "MUSK'S COMPUTE TARGET · END OF 2027"); s.t(80, 420, 'Close to', 84, 750, MUT); s.t(80, 520, '10 GW', 250, 850, ACC); s.t(80, 820, 'of AI compute', 84, 800)
        if nv: s.d.rounded_rectangle((80, 960, 1000, 1110), 26, fill=BAR); s.c(1000, 'All on Nvidia chips', 64, 850)
        s.src('Musk, Q2 earnings call, Aug 4, 2026 · a target, not a result'); s.save(o / f'05_at{at}.png')
    s.save(o / '05.png')
    s = Scene(S, '07/09'); s.label(330, 'GROK'); s.t(80, 560, "So here's", 130, 850); s.t(80, 720, 'what to watch', 120, 850, ACC); s.save(o / '06.png')
    rows = [('AI sales vs AI losses', 'is the gap closing each quarter?'), ('Grok 5', 'promised by year end')]
    for lit, at in ((1, 0), (2, 9)): watch(S, '08/09', ['Every quarter'], rows, lit, o / f'07_at{at}.png', 'SPACEX')
    watch(S, '08/09', ['Every quarter'], rows, 2, o / '07.png', 'SPACEX')
    g = ['Losses shrink as', 'AI sales climb']; b = ['Starlink profits keep', 'paying for Grok']
    verdict(S, '09/09', g, b, False, o / '08_at0.png'); verdict(S, '09/09', g, b, True, o / '08_at12.png', 'Starlink is the only segment with an operating profit')
    verdict(S, '09/09', g, b, True, o / '08.png', 'Starlink is the only segment with an operating profit')
    thumb(o / 'thumbnail.png', ['Buy SpaceX,', 'you own'], 'Grok.', ACC, 'AI sales up 247%.', 'AI loss: $1.3B a quarter.', 'SPACEX · GROK')


def wrap(s, text, n, width):
    out, ln = [], ''
    for w in text.split():
        v = (ln + ' ' + w).strip()
        if s.d.textlength(v, font=font(n, 700)) > width: out.append(ln); ln = w
        else: ln = v
    return out + [ln]


if __name__ == '__main__':
    import json
    ask = json.load(open(R / '03-one-bet' / 'evidence' / 'ask.json'))
    for g in (0.25, 0.5, 0.75, 1.0):            # reveal frames first, finals last (finals also write thumbnails)
        GROW = g
        google(R / '01-google-cash' / 'scenes'); nvidia(R / '02-nvidia-buyback' / 'scenes'); onebet(R / '03-one-bet' / 'scenes', ask); spacex(R / '04-spacex' / 'scenes')
    for d in ('01-google-cash', '02-nvidia-buyback', '03-one-bet', '04-spacex'):
        for f in ('thumbnail.png', 'thumbnail.jpg', 'thumbnail-mobile.png'):
            p = R / d / 'scenes' / f
            if p.exists(): p.replace(R / d / f)
    print('scenes + thumbnails written')
