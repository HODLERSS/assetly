"""Scenes + thumbnails for 'AI investing for everyone' (5 Shorts, research 04 OCT 2026).
Reuses the Follow-the-AI-money kit (../2026-10-05-ai-money/design.py): Scene, bars, watch, verdict, thumb, palette.
    python3 design.py
Every figure comes from sources.md (filings, fund holdings files, two price feeds)."""
import importlib.util, json, math
from pathlib import Path
R = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('kit', R.parent / '2026-10-05-ai-money' / 'design.py'); K = importlib.util.module_from_spec(spec); spec.loader.exec_module(K)
Scene, font, BG, INK, ACC, BAR, PANEL, LINE, MUT, LOSS, GOOD = K.Scene, K.font, K.BG, K.INK, K.ACC, K.BAR, K.PANEL, K.LINE, K.MUT, K.LOSS, K.GOOD


def big(s, y, txt, n=250, col=ACC):
    s.t(80, y, txt, n, 850, col)


def stmt(S, seq, lines, path, label=None, cols=None):
    s = Scene(S, seq)
    if label: s.label(330, label)
    y = 560
    for k, ln in enumerate(lines): s.t(80, y, ln, 120, 850, (cols or [INK] * 9)[k]); y += 150
    s.save(path); return s


# ---------------------------------------------------------------- 1 Nvidia $1,000
def value_chart(s, rows, upto, marks):
    """$1,000 invested on Oct 1 2021, weekly closes, log scale with labelled ticks; drawn up to date `upto`."""
    x0, x1, y0, y1 = 150, 990, 1180, 560
    base = rows[0][1]; vals = [(d, 1000 * c / base) for d, c in rows]
    lo, hi = math.log(400), math.log(14000)
    Y = lambda v: y0 - (math.log(v) - lo) / (hi - lo) * (y0 - y1)
    X = lambda i: x0 + i / (len(vals) - 1) * (x1 - x0)
    for tick in (500, 1000, 2000, 5000, 10000):
        y = Y(tick); s.d.line((x0, y, x1, y), fill=LINE, width=2); lab = f'${tick:,}'
        s.t(x0 - 14 - s.d.textlength(lab, font=font(28, 600)), y - 18, lab, 28, 600, MUT)
    for yr in (2022, 2023, 2024, 2025, 2026):
        i = next(k for k, (d, _) in enumerate(vals) if d >= f'{yr}-01-01'); s.t(X(i) - 34, y0 + 16, str(yr), 28, 600, MUT)
    pts = [(X(i), Y(v)) for i, (d, v) in enumerate(vals) if d <= upto]
    if len(pts) > 1: s.d.line(pts, fill=ACC, width=8, joint='curve')
    for d, txt, col in marks:
        i = max(k for k, (dd, _) in enumerate(vals) if dd <= d); x, y = X(i), Y(vals[i][1])
        s.d.ellipse((x - 14, y - 14, x + 14, y + 14), fill=col)
        tw = s.d.textlength(txt, font=font(52, 850))
        if x + 24 + tw <= 1000: tx, ty = x + 24, (y - 70 if col != LOSS else y - 10)
        else: tx, ty = x - tw - 24, y - 80
        s.t(tx, ty, txt, 52, 850, col)
    s.t(80, 1250, '$1,000 in Nvidia on Oct 1, 2021 · price only, log scale', 30, 600, MUT)


def nvidia(o):
    S = 'AI investing for everyone · Nvidia'; rows = json.load(open(o.parent / 'evidence' / 'nvda-weekly-yahoo.json'))
    for at, full in ((0, False), (8, True)):
        s = Scene(S, '01/09'); s.label(330, 'NVIDIA · OCT 2021 → OCT 2026'); s.t(80, 420, '$1,000', 120, 850, INK if not full else MUT)
        if not full: s.t(80, 570, 'in Nvidia,', 96, 800); s.t(80, 680, 'five years ago', 96, 800, ACC)
        else: s.t(80, 560, '→', 100, 850, MUT); big(s, 680, '$11,279'); s.t(80, 990, 'in five years', 84, 800)
        s.src('Split-adjusted closes, Nasdaq + Yahoo agree: $20.742 → $233.95'); s.save(o / (f'00_at{at}.png'))
    s.save(o / '00.png')
    for at, two in ((0, False), (2, True)):
        s = Scene(S, '02/09'); s.t(80, 600, 'Sounds easy.', 130, 850)
        if two: s.t(80, 760, "It wasn't.", 130, 850, LOSS)
        s.save(o / f'01_at{at}.png')
    s.save(o / '01.png')
    def chart(seq, upto, marks, path, head):
        s = Scene(S, seq); s.label(330, 'WHAT $1,000 DID'); s.t(80, 390, head, 72, 800); value_chart(s, rows, upto, marks); s.src('Nasdaq + Yahoo weekly closes'); s.save(path)
    chart('03/09', '2021-10-01', [], o / '02_at0.png', 'Two months in')
    chart('03/09', '2021-11-29', [('2021-11-29', '$1,609', GOOD)], o / '02_at8.png', 'Two months in')
    chart('03/09', '2021-11-29', [('2021-11-29', '$1,609', GOOD)], o / '02.png', 'Two months in')
    chart('04/09', '2021-11-29', [('2021-11-29', '$1,609', GOOD)], o / '03_at0.png', 'Then 2022')
    chart('04/09', '2022-10-14', [('2021-11-29', '$1,609', GOOD), ('2022-10-14', '$541', LOSS)], o / '03_at9.png', 'Then 2022')
    chart('04/09', '2022-10-14', [('2021-11-29', '$1,609', GOOD), ('2022-10-14', '$541', LOSS)], o / '03.png', 'Then 2022')
    s = Scene(S, '05/09'); s.label(330, 'PEAK TO BOTTOM · NOV 2021 → OCT 2022'); big(s, 470, '−66%', 280, LOSS); s.t(80, 820, 'from the top', 90, 800)
    s.src('$33.376 → $11.227, split-adjusted closes (Nasdaq + Yahoo)'); s.save(o / '04.png')
    chart('06/09', '2022-10-14', [('2021-11-29', '$1,609', GOOD), ('2022-10-14', '$541', LOSS)], o / '05_at0.png', 'To get $11,279')
    chart('06/09', '2026-10-03', [('2021-11-29', '$1,609', GOOD), ('2022-10-14', '$541', LOSS), ('2026-10-02', '$11,279', ACC)], o / '05_at3.png', 'To get $11,279')
    chart('06/09', '2026-10-03', [('2021-11-29', '$1,609', GOOD), ('2022-10-14', '$541', LOSS), ('2026-10-02', '$11,279', ACC)], o / '05_at10.png', 'You had to not sell')
    chart('06/09', '2026-10-03', [('2021-11-29', '$1,609', GOOD), ('2022-10-14', '$541', LOSS), ('2026-10-02', '$11,279', ACC)], o / '05.png', 'You had to not sell')
    stmt(S, '07/09', ['Before you', 'chase the', 'next Nvidia'], o / '06.png', 'ASK YOURSELF ONE QUESTION', [INK, INK, ACC])
    s = Scene(S, '08/09'); s.label(330, 'THE QUESTION'); s.d.rounded_rectangle((80, 470, 1000, 1080), 34, fill=PANEL, outline=ACC, width=5)
    for k, ln in enumerate(['Could I watch', 'this fall by', 'two thirds,', 'and still hold?']): s.t(130, 520 + k * 130, ln, 100, 850, ACC if k == 3 else INK)
    s.save(o / '07.png')
    g = ['Yes: you can ride', 'the volatility']; b = ['No: the position', 'size is the problem']; src = 'A risk check, not advice · past returns do not predict future returns'
    K.verdict(S, '09/09', g, b, False, o / '08_at0.png'); K.verdict(S, '09/09', g, b, True, o / '08_at5.png', src); K.verdict(S, '09/09', g, b, True, o / '08.png', src)
    K.thumb(o / 'thumbnail.png', ['$1,000 in', 'Nvidia →'], '$11,279', ACC, 'But first it fell to $541.', 'Could you hold?', 'NVIDIA · 5 YEARS')


# ---------------------------------------------------------------- 2 S&P 500
def waffle(s, n_lit, col=BAR, y=470, n2=0, col2=ACC, step=62):
    """10x10 grid, one square = 1% of the fund; centred, ends at y + 10*step (keep above the caption band, y<1340)."""
    x0 = 540 - 5 * step
    for i in range(100):
        r, c = divmod(i, 10); x = x0 + c * step; yy = y + r * step; sz = step - 10
        fill = col2 if i < n2 else (col if i < n_lit else PANEL); s.d.rounded_rectangle((x, yy, x + sz, yy + sz), 9, fill=fill)


def sp500(o, ask):
    S = 'AI investing for everyone · S&P 500'
    for at, bet in ((0, False), (9, True)):
        s = Scene(S, '01/09'); s.label(330, 'YOUR INDEX FUND'); s.t(80, 420, 'S&P 500 fund', 110, 850)
        if bet: big(s, 580, '= AI bet?', 200)
        waffle(s, 0, y=880, n2=32 if bet else 0, step=44); s.save(o / f'00_at{at}.png')
    s.save(o / '00.png')
    s = Scene(S, '02/09'); s.label(330, 'WHAT IT HOLDS'); big(s, 430, '~500', 250, INK); s.t(80, 740, 'companies', 96, 800, MUT); s.src('SPY holdings file, State Street, as of Oct 1, 2026: 503 companies'); s.save(o / '01.png')
    for at, lit in ((0, 0), (7, 40)):
        s = Scene(S, '03/09'); s.label(330, 'TOP 10 COMPANIES · SHARE OF THE FUND'); s.t(80, 380, '10 companies', 72, 800); waffle(s, lit, y=490)
        if lit: s.t(80, 1130, '≈ 40% of your money', 64, 850, ACC)
        s.src('SPY 40.4% (Oct 1) · S&P 500 weights 40.6% (Slickcharts)'); s.save(o / f'02_at{at}.png')
    s.save(o / '02.png')
    for at, n2, names in ((0, 0, False), (1, 32, False), (6, 32, True)):
        s = Scene(S, '04/09'); s.label(330, '8 AI COMPANIES · ≈ 32% OF THE FUND'); waffle(s, 0, y=420, n2=n2)
        if names: s.t(80, 1065, 'Nvidia · Microsoft · Alphabet · Amazon', 40, 700); s.t(80, 1120, 'Meta · Broadcom · Micron · AMD', 40, 700)
        s.save(o / f'03_at{at}.png')
    s.save(o / '03.png')
    s = Scene(S, '05/09'); s.label(330, 'ONE COMPANY'); s.t(80, 400, 'Nvidia alone', 84, 800); big(s, 480, '≈ 8%', 220); waffle(s, 0, y=800, n2=8, step=50)
    s.save(o / '04.png')
    stmt(S, '06/09', ['A bad week', 'for AI...'], o / '05_at0.png', 'SO', [INK, INK])
    stmt(S, '06/09', ['A bad week', 'for AI hits', 'your index', 'fund too'], o / '05_at8.png', 'SO', [INK, INK, ACC, ACC])
    stmt(S, '06/09', ['A bad week', 'for AI hits', 'your index', 'fund too'], o / '05.png', 'SO', [INK, INK, ACC, ACC])
    rows = [('Look up your fund\'s top 10', 'free on the fund\'s website'), ('Add your own AI stocks', 'that total is your real AI bet')]
    K.watch(S, '07/09', ['A two-minute', 'check'], rows, 0, o / '06_at0.png', 'DO THIS TODAY'); K.watch(S, '07/09', ['A two-minute', 'check'], rows, 1, o / '06_at4.png', 'DO THIS TODAY')
    K.watch(S, '07/09', ['A two-minute', 'check'], rows, 1, o / '06.png', 'DO THIS TODAY')
    K.watch(S, '08/09', ['A two-minute', 'check'], rows, 2, o / '07.png', 'DO THIS TODAY')
    for at, quote in ((0, False), (10, True)):
        s = Scene(S, '09/09'); s.label(330, 'ASKED IN ASSETLY'); s.d.rounded_rectangle((80, 400, 1000, 560), 26, fill=BAR)
        s.t(120, 450, ask['question'], 50, 800)
        if quote:
            s.t(80, 640, '“Heavy concentration in', 66, 800); s.t(80, 726, 'AI-related chips', 66, 800, ACC); s.t(80, 812, '(NVDA, AMD, ARM, TSM)', 52, 700, MUT)
            s.t(80, 900, 'makes portfolio sensitive', 66, 800); s.t(80, 986, 'to AI spending cycles.”', 66, 800)
        else: s.t(80, 660, 'An AI-heavy portfolio', 66, 800, MUT); s.t(80, 746, 'asks one question', 66, 800, MUT)
        s.src('Actual Assetly answer, Oct 4, 2026 · illustrative portfolio · verbatim'); s.save(o / f'08_at{at}.png')
    s.save(o / '08.png')
    K.thumb(o / 'thumbnail.png', ['Your S&P 500', 'fund is'], '32% AI', ACC, '8 AI companies,', 'a third of your money.', 'INDEX FUNDS · AI')


# ---------------------------------------------------------------- 3 Micron
def micron(o):
    S = 'AI investing for everyone · Micron'
    s = Scene(S, '01/08'); s.label(330, 'MICRON · QUARTER ENDED SEP 3, 2026'); s.t(80, 410, 'Micron', 120, 850); big(s, 560, '$37.7B', 250, GOOD)
    s.t(80, 870, 'profit in 3 months', 84, 800); s.src('Micron FQ4 2026 results (8-K), Sep 30, 2026 · GAAP net income'); s.save(o / '00.png')
    s = Scene(S, '02/08'); s.label(330, 'GAAP NET INCOME · ONE QUARTER'); big(s, 470, '$37.7B', 250, GOOD); s.t(80, 790, 'of profit', 96, 800); s.t(80, 900, 'in one quarter', 96, 800, MUT)
    s.save(o / '01.png')
    s = Scene(S, '03/08'); s.label(330, 'BILLIONS OF DOLLARS'); s.t(80, 390, 'One quarter of profit', 70, 800); s.t(80, 475, '> a year of sales', 70, 800, ACC)
    s.bars([('FY2025\ntotal sales', 37.4), ('FQ4 2026\nprofit', 37.7, GOOD)], top=640); s.src('Micron 8-K: FY2025 revenue $37.38B; FQ4 2026 net income $37.70B'); s.save(o / '02.png')
    for at, both in ((4, False), (11, True)):
        s = Scene(S, '04/08'); s.label(330, 'THE REASON: AI')
        s.d.rounded_rectangle((80, 420, 1000, 720), 30, fill=PANEL); s.t(130, 460, 'Data center sales', 52, 700, MUT); s.t(130, 540, '11×', 140, 850, ACC)
        if both: s.d.rounded_rectangle((80, 760, 1000, 1060), 30, fill=PANEL); s.t(130, 800, 'Gross margin', 52, 700, MUT); s.t(130, 880, '86.8%', 140, 850, GOOD)
        s.src('Micron 8-K: Core Data Center unit $1.58B → $18.0B (11.4×) · gross margin 86.8%'); s.save(o / f'03_at{at}.png')
    s.save(o / '03.png')
    s = Scene(S, '05/08'); s.label(330, 'MICRON SHARE PRICE · THIS YEAR'); s.t(80, 390, 'Nearly 4×', 78, 800); s.t(80, 480, 'in 2026', 78, 750, ACC)
    s.bars([('Dec 31, 2025', 285.41, BAR, '$285'), ('Oct 2, 2026', 1074.89, GOOD, '$1,075')], top=640); s.src('Closes: Nasdaq + Yahoo agree'); s.save(o / '04.png')
    stmt(S, '06/08', ['Memory is', 'boom and', 'bust.'], o / '05.png', 'BUT', [INK, INK, LOSS])
    rows = [('Next quarter: $61.5B', "Micron's own forecast, ±$1.5B"), ('Gross margin: 86.8%', 'does it start to slip?')]
    for lit, at in ((1, 4), (2, 10)): K.watch(S, '07/08', ['Watch two', 'things'], rows, lit, o / f'06_at{at}.png', 'MICRON')
    K.watch(S, '07/08', ['Watch two', 'things'], rows, 0, o / '06_at0.png', 'MICRON'); K.watch(S, '07/08', ['Watch two', 'things'], rows, 2, o / '06.png', 'MICRON')
    K.verdict(S, '08/08', ['Margins hold as', 'new factories open'], ['Memory prices crack,', 'profits shrink fast'], False, o / '07_at0.png')
    K.verdict(S, '08/08', ['Margins hold as', 'new factories open'], ['Memory prices crack,', 'profits shrink fast'], True, o / '07_at11.png', 'Investment test, not a forecast')
    K.verdict(S, '08/08', ['Margins hold as', 'new factories open'], ['Memory prices crack,', 'profits shrink fast'], True, o / '07.png', 'Investment test, not a forecast')
    K.thumb(o / 'thumbnail.png', ['Micron made', 'in 3 months'], '$37.7B', GOOD, 'More than it sold', 'all last year.', 'MICRON · AI MEMORY')


# ---------------------------------------------------------------- 4 AI bubble
def bubble(o):
    S = 'AI investing for everyone · Bubble check'
    s = Scene(S, '01/08'); s.label(330, 'THE QUESTION EVERYONE ASKS'); s.t(80, 430, 'Is AI a', 150, 850); s.t(80, 610, 'bubble?', 150, 850, LOSS)
    for k, n in enumerate(['$725B', '$60B', '−$5.9B']): s.d.rounded_rectangle((80 + k * 312, 900, 370 + k * 312, 1060), 24, fill=PANEL); s.t(110 + k * 312, 945, n, 58, 850, [ACC, GOOD, LOSS][k])
    s.save(o / '00.png')
    for at, lit in ((0, 0), (5, 1), (6, 2), (7, 3), (9, 4)):
        s = Scene(S, '02/08'); s.label(330, 'NUMBER 1 · 2026 SPENDING PLANS'); big(s, 420, '$725B', 250)
        for k, nm in enumerate(['Amazon', 'Microsoft', 'Google', 'Meta']):
            x = 80 + (k % 2) * 470; y = 760 + (k // 2) * 140; on = k < lit; s.d.rounded_rectangle((x, y, x + 450, y + 115), 22, fill=BAR if on else PANEL)
            s.t(x + 225 - s.d.textlength(nm, font=font(48, 800)) / 2, y + 30, nm, 48, 800, INK if on else MUT)
        s.src('Company guidance compiled by the Financial Times'); s.save(o / f'01_at{at}.png')
    s.save(o / '01.png')
    s = Scene(S, '03/08'); s.label(330, 'BIG TECH CAPITAL SPENDING · BILLIONS'); s.t(80, 390, 'Up 77%', 78, 800); s.t(80, 480, 'in one year', 78, 750, ACC)
    s.bars([('2025', 410), ('2026 plan', 725, '#7C8FE8')], top=640); s.src('FT compilation: $410B (2025) → $725B (2026 plans)'); s.save(o / '02.png')
    s = Scene(S, '04/08'); s.label(330, "NUMBER 2 · NVIDIA'S QUARTERLY PROFIT"); big(s, 430, '$60B', 280, GOOD); s.t(80, 790, 'in three months', 90, 800)
    s.src('GAAP net income $59.7B, quarter ended Jul 26, 2026 (Nvidia 8-K)'); s.save(o / '03.png')
    s = Scene(S, '05/08'); s.label(330, "NUMBER 3 · GOOGLE'S FREE CASH FLOW, Q2"); big(s, 430, '−$5.9B', 250, LOSS); s.t(80, 760, 'after all that', 90, 800); s.t(80, 870, 'spending', 90, 800, MUT)
    s.src('Alphabet Q2 2026 release: $39.1B cash in − $44.9B capex'); s.save(o / '04.png')
    s = Scene(S, '06/08'); s.label(330, 'SO FAR')
    for k, (head, sub, col) in enumerate((('Sellers', 'cashing in', GOOD), ('Buyers', 'waiting for payback', LOSS))):
        y = 430 + k * 360; s.d.rounded_rectangle((80, y, 1000, y + 320), 30, fill=PANEL, outline=col, width=5); s.t(130, y + 50, head, 100, 850, col); s.t(130, y + 190, sub, 64, 750)
    s.save(o / '05.png')
    rows = [('Cloud profit', 'Amazon, Microsoft, Google'), ('vs spending', 'next year\'s capex plans')]
    K.watch(S, '07/08', ['On the next', 'earnings calls'], rows, 0, o / '06_at0.png', 'BUBBLE CHECK'); K.watch(S, '07/08', ['On the next', 'earnings calls'], rows, 2, o / '06_at9.png', 'BUBBLE CHECK')
    K.watch(S, '07/08', ['On the next', 'earnings calls'], rows, 2, o / '06.png', 'BUBBLE CHECK')
    g = ['Cloud profit grows', 'faster than spending']; b = ['Spending rises while', 'profits stall']
    K.verdict(S, '08/08', g, b, False, o / '07_at0.png'); K.verdict(S, '08/08', g, b, True, o / '07_at10.png', 'A boom if the first, a bubble if the second · not a forecast')
    K.verdict(S, '08/08', g, b, True, o / '07.png', 'A boom if the first, a bubble if the second · not a forecast')
    K.thumb(o / 'thumbnail.png', ['Is AI a', 'bubble?'], '3 numbers', ACC, '$725B. $60B. −$5.9B.', 'Here is what they say.', 'AI BUBBLE CHECK')


# ---------------------------------------------------------------- 5 ChatGPT stock
def chatgpt(o):
    S = 'AI investing for everyone · ChatGPT'
    for at, no in ((0, False), (1, True)):
        s = Scene(S, '01/08'); s.label(330, 'OPENAI · STILL PRIVATE'); s.t(80, 430, 'ChatGPT', 150, 850); s.t(80, 610, 'stock?', 150, 850, ACC)
        if no: s.d.rounded_rectangle((80, 900, 1000, 1060), 26, fill=PANEL, outline=LOSS, width=5); s.t(130, 945, "You can't buy it.", 64, 850, LOSS)
        s.save(o / f'00_at{at}.png')
    s.save(o / '00.png')
    for at, v in ((0, False), (6, True)):
        s = Scene(S, '02/08'); s.label(330, "OPENAI'S VALUATION · MARCH 31, 2026")
        if v: big(s, 450, '$852B', 250); s.t(80, 770, 'private funding round', 70, 750, MUT)
        else: s.t(80, 520, 'In March,', 120, 850); s.t(80, 670, 'OpenAI was', 120, 850, MUT); s.t(80, 820, 'valued at...', 120, 850, MUT)
        s.src('$122B round, post-money $852B (OpenAI; Bloomberg, TechCrunch)'); s.save(o / f'01_at{at}.png')
    s.save(o / '01.png')
    for at, pct in ((0, False), (5, True)):
        s = Scene(S, '03/08'); s.label(330, "MICROSOFT'S STAKE · OCT 2025"); s.t(80, 420, 'So people buy', 84, 800, MUT if pct else INK); s.t(80, 520, 'Microsoft', 120, 850)
        if pct: big(s, 680, '~27%', 230); s.t(80, 980, 'of OpenAI, diluted since', 52, 650, MUT)
        s.src('Microsoft, Oct 28, 2025: ~27% as-converted diluted'); s.save(o / f'02_at{at}.png')
    s.save(o / '02.png')
    for at, v in ((0, False), (5, True)):
        s = Scene(S, '04/08'); s.label(330, "MICROSOFT'S MARKET VALUE · OCT 2, 2026")
        if v: big(s, 450, '$3.8T', 250, INK); s.t(80, 770, 'Microsoft itself', 84, 800, MUT)
        else: s.t(80, 560, 'But Microsoft', 120, 850); s.t(80, 710, 'itself is worth', 120, 850, MUT)
        s.src('$517.53 × shares (Nasdaq market cap $3.84T; Yahoo close agrees)'); s.save(o / f'03_at{at}.png')
    s.save(o / '03.png')
    for at, sl in ((0, False), (9, True)):
        s = Scene(S, '05/08'); s.label(330, 'MICROSOFT, AND ITS OPENAI STAKE'); s.t(80, 400, 'At most 6%' if sl else 'The whole company', 84, 800)
        s.d.rounded_rectangle((80, 560, 1000, 760), 26, fill=PANEL)
        if sl:
            w = 920 * 0.06; s.d.rounded_rectangle((80, 560, 80 + w, 760), 18, fill=ACC)
            s.t(80, 800, 'OpenAI stake ≤ $230B', 50, 750, ACC); s.t(80, 870, '(27% × $852B)', 44, 600, MUT); s.t(80, 960, 'of a $3.8T company', 60, 800)
        else: s.t(120, 625, 'Microsoft · $3.8T', 60, 850, MUT)
        s.src('Upper bound: pre-dilution stake at the March valuation'); s.save(o / f'04_at{at}.png')
    s.save(o / '04.png')
    for at, c in ((0, False), (6, True)):
        s = Scene(S, '06/08'); s.label(330, 'OF EVERY DOLLAR IN MICROSOFT')
        if c: big(s, 450, '≤ 6¢', 280); s.t(80, 820, 'is ChatGPT', 96, 800)
        else: big(s, 450, '$1', 280, INK); s.t(80, 820, 'of Microsoft...', 96, 800, MUT)
        s.save(o / f'05_at{at}.png')
    s.save(o / '05.png')
    rows = [('An OpenAI IPO filing', 'reports point to 2027')]
    K.watch(S, '07/08', ['What to', 'watch'], rows, 0, o / '06_at0.png', 'OPENAI'); K.watch(S, '07/08', ['What to', 'watch'], rows, 1, o / '06_at4.png', 'OPENAI')
    K.watch(S, '07/08', ['What to', 'watch'], rows, 1, o / '06.png', 'OPENAI')
    s = Scene(S, '08/08'); s.label(330, 'THE BOTTOM LINE')
    s.d.rounded_rectangle((80, 420, 1000, 810), 30, fill=PANEL, outline=GOOD, width=5); s.d.ellipse((120, 468, 156, 504), fill=GOOD); s.t(180, 456, 'JUDGE MICROSOFT ON', 46, 800, GOOD)
    s.t(120, 560, 'Its cloud', 72, 850); s.t(120, 650, 'and software', 72, 850)
    for at, bonus in ((0, False), (10, True)):
        if bonus:
            s.d.rounded_rectangle((80, 850, 1000, 1150), 30, fill=PANEL, outline=ACC, width=5); s.t(120, 900, 'ChatGPT:', 64, 850, ACC); s.t(120, 990, 'a bonus, not the bet', 64, 850)
        s.save(o / f'07_at{at}.png')
    s.save(o / '07.png')
    K.thumb(o / 'thumbnail.png', ["Can't buy", 'ChatGPT. So'], '≤ 6¢', ACC, 'of each Microsoft $1', 'is OpenAI.', 'CHATGPT · OPENAI')


if __name__ == '__main__':
    ask = json.load(open(R / '02-sp500-ai' / 'evidence' / 'ask.json'))
    for g in (0.25, 0.5, 0.75, 1.0):
        K.GROW = g
        nvidia(R / '01-nvidia-1000' / 'scenes'); sp500(R / '02-sp500-ai' / 'scenes', ask); micron(R / '03-micron-profit' / 'scenes')
        bubble(R / '04-ai-bubble' / 'scenes'); chatgpt(R / '05-chatgpt-stock' / 'scenes')
    for d in ('01-nvidia-1000', '02-sp500-ai', '03-micron-profit', '04-ai-bubble', '05-chatgpt-stock'):
        for f in ('thumbnail.png', 'thumbnail.jpg', 'thumbnail-mobile.png'):
            p = R / d / 'scenes' / f
            if p.exists(): p.replace(R / d / f)
    print('scenes + thumbnails written')
