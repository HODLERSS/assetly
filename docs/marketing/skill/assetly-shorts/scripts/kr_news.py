"""Korean news headlines for the Korea editions (korea-open / korea-close), so a SK hynix / Samsung / Hanmi / HBM /
memory / KOSPI claim can be backed by two INDEPENDENT publishers, not two copies of one story.

kr_headlines(hours) -> [{"tag", "title", "publisher", "when", "link", "lang", "via"}], newest first, only items newer than
`hours` and only items about the Korea AI-chip story. `tag` is the KRX symbol whose name is in the title ("000660.KS"),
else "MACRO" (KOSPI, foreign flows, sector-wide memory/HBM stories). `publisher` is always the ORIGINAL newsroom under one
canonical English name; `via` is the feed it came through ("Naver Finance", "Korea Times RSS", ...).

Publisher rules (canonical_publisher):
  * One newsroom = one name. KED Global is the Korea Economic Daily's English desk -> "Korea Economic Daily"; Pulse is
    Maeil Business's English service -> "Maeil Business"; Korea JoongAng Daily -> "JoongAng". Different newsrooms in the
    same group stay separate (Yonhap Infomax, ChosunBiz, Korea Economic TV, Herald Economy), as does Maeil Shinmun
    (a Daegu daily, not Maeil Business).
  * Wire credit wins: a reprint whose dateline/byline carries "(Yonhap)", "(...=연합뉴스)", a yonhap@ byline, or a Naver
    item whose press office is 연합뉴스 is attributed to "Yonhap", so a Yonhap story reprinted by the Korea Times and
    carried by Naver counts ONCE. Same for AP / AFP / Reuters bylines in the Korea Times feed. Yonhap News TV is mapped
    to Yonhap too (its text items are largely wire copy). Photo credits ("/로이터 연합뉴스" captions) do not count.
  * Never an aggregator: Naver, Daum and Google News are never returned as a publisher; we take the press office.

Sources, probed 2026-10-01 (one request each per call, plus one Naver page per ticker):
  WORKING  Yonhap English RSS en.yna.co.kr/RSS/news.xml (~24 h deep; the per-section /RSS/market|industry.xml are 404)
           Korea Herald RSS koreaherald.com/rss/newsAll (~24 h)
           Korea Times RSS feed.koreatimes.co.kr/k/allnews.xml (17 items; byline email marks wire reprints)
           BusinessKorea RSS businesskorea.co.kr/rss/allArticle.xml (mixed English/Korean; naive KST times)
           Yonhap Korean RSS yna.co.kr/rss/industry.xml + market.xml
           Maeil Business Korean RSS mk.co.kr/rss/50200011/ (stocks) + /30100041/ (economy)
           Chosun Ilbo Korean RSS chosun.com/arc/outboundfeeds/rss/category/economy/
           Naver mobile stock news JSON m.stock.naver.com/api/news/stock/<code>?pageSize=50 (officeName = press office;
             Samsung's 50 items cover only ~2 h of a trading morning, hynix/Hanmi longer)
  REJECTED Hankyung RSS (hankyung.com/feed/*): Cloudflare challenge 403. Hankyung still arrives via Naver.
           KED Global (kedglobal.com/rss, /newsRss): /rss is a stale curated list (newest Sep 16), /newsRss is empty.
           Korea JoongAng Daily: no RSS (old joins.com paths redirect to 404).
           Pulse (pulse.mk.co.kr): no RSS (404).
           Naver Finance desktop item/news_news.naver: 410 Gone (EUC-KR stub).
"""
import html, json, re, threading, time, xml.etree.ElementTree as ET_
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

from lib import get, log
import kr as KRM

KST = ZoneInfo("Asia/Seoul")
WALL = 25                                                              # seconds for all sources together

# normalized key (lowercase, no "the", no punctuation/spaces) -> canonical name. Also used by research.py for Google News.
_ALIASES = {
    "Yonhap": ["Yonhap", "Yonhap News", "Yonhap News Agency", "연합뉴스", "연합", "yna.co.kr", "en.yna.co.kr",
               "연합뉴스TV", "Yonhap News TV", "Yonhapnews TV"],
    "Yonhap Infomax": ["Yonhap Infomax", "연합인포맥스", "news.einfomax.co.kr"],
    "Korea Economic Daily": ["Korea Economic Daily", "The Korea Economic Daily", "KED Global", "KED", "Hankyung",
                             "한국경제", "한경", "hankyung.com", "kedglobal.com", "한경비즈니스", "Hankyung Business"],
    "Korea Economic TV": ["한국경제TV", "Korea Economic TV", "wowtv.co.kr"],
    "Maeil Business": ["Maeil Business", "Maeil Business News Korea", "Maeil Business Newspaper", "매일경제", "매경",
                       "Pulse", "Pulse by Maeil Business News Korea", "pulse.mk.co.kr", "mk.co.kr", "MK"],
    "Maeil Shinmun": ["매일신문", "Maeil Shinmun", "imaeil.com"],
    "MBN": ["MBN", "매일방송"],
    "JoongAng": ["JoongAng", "JoongAng Ilbo", "Korea JoongAng Daily", "중앙일보", "koreajoongangdaily.joins.com",
                 "joongang.co.kr"],
    "Korea Herald": ["Korea Herald", "The Korea Herald", "koreaherald.com"],
    "Herald Economy": ["헤럴드경제", "Herald Economy", "Herald Business", "heraldcorp.com"],
    "Korea Times": ["Korea Times", "The Korea Times", "KoreaTimes", "koreatimes.co.kr", "한국일보 영문"],
    "Hankook Ilbo": ["한국일보", "Hankook Ilbo", "hankookilbo.com"],
    "BusinessKorea": ["BusinessKorea", "Business Korea", "businesskorea.co.kr", "비즈니스코리아"],
    "Chosun Ilbo": ["Chosun Ilbo", "The Chosun Ilbo", "Chosun Daily", "The Chosun Daily", "조선일보", "chosun.com"],
    "ChosunBiz": ["조선비즈", "ChosunBiz", "Chosun Biz", "biz.chosun.com"],
    "Dong-A Ilbo": ["동아일보", "Dong-A Ilbo", "The Dong-A Ilbo", "donga.com"],
    "Seoul Economic Daily": ["서울경제", "Seoul Economic Daily", "Sedaily", "sedaily.com"],
    "Money Today": ["머니투데이", "Money Today", "mt.co.kr"],
    "Edaily": ["이데일리", "Edaily", "edaily.co.kr"],
    "Financial News": ["파이낸셜뉴스", "Financial News", "fnnews.com"],
    "Asia Economy": ["아시아경제", "Asia Economy", "asiae.co.kr"],
    "Electronic Times": ["전자신문", "Electronic Times", "etnews.com", "ETNews"],
    "Digital Times": ["디지털타임스", "Digital Times", "dt.co.kr"],
    "Digital Daily": ["디지털데일리", "Digital Daily", "ddaily.co.kr"],
    "inews24": ["아이뉴스24", "inews24", "iNews24"],
    "News1": ["뉴스1", "News1", "News1 Korea"],
    "Newsis": ["뉴시스", "Newsis"],
    "Munhwa Ilbo": ["문화일보", "Munhwa Ilbo"],
    "Seoul Shinmun": ["서울신문", "Seoul Shinmun"],
    "Hankyoreh": ["한겨레", "Hankyoreh", "The Hankyoreh"],
    "Kyunghyang": ["경향신문", "Kyunghyang Shinmun"],
    "Dailian": ["데일리안", "Dailian"],
    "Nocut News": ["노컷뉴스", "CBS 노컷뉴스", "Nocut News"],
    "The Fact": ["더팩트", "The Fact"],
    "Bloter": ["블로터", "Bloter"],
    "BizWatch": ["비즈워치", "BizWatch"],
    "Economist Korea": ["이코노미스트", "Economist Korea"],
    "SBS": ["SBS", "SBS Biz", "SBS News"],
    "MBC": ["MBC", "MBC News"], "KBS": ["KBS", "KBS News", "KBS World"], "JTBC": ["JTBC"], "YTN": ["YTN"],
    "TheElec": ["TheElec", "The Elec", "디일렉"], "ZDNet Korea": ["지디넷코리아", "ZDNet Korea"],
    "Reuters": ["Reuters"], "Bloomberg": ["Bloomberg", "Bloomberg.com"], "AP": ["AP", "Associated Press", "AP News"],
    "AFP": ["AFP", "Agence France-Presse"], "CNBC": ["CNBC"], "Nikkei Asia": ["Nikkei Asia", "Nikkei"],
    "DigiTimes": ["DigiTimes", "DIGITIMES", "DIGITIMES Asia"],
}


def _key(s):
    s = re.sub(r"^the\s+", "", (s or "").strip().lower())
    return re.sub(r"[\s.,'’\-_:|·]+", "", s)


PUBLISHER_ALIASES = {_key(a): canon for canon, al in _ALIASES.items() for a in al + [canon]}
AGGREGATORS = {_key(x) for x in ("Naver", "네이버", "Naver News", "Naver Finance", "Daum", "다음", "Google News", "Google",
                                 "finance.biggo.com", "BigGo")}   # BigGo Finance rewrites other outlets' stories

# wire credit in a dateline/byline: "SEOUL, Oct. 2 (Yonhap) --", "(서울=연합뉴스) 홍길동 기자", "yonhap@koreatimes.co.kr"
_WIRE = [(re.compile(r"\(Yonhap\)|\(\s*[가-힣]+\s*=\s*연합뉴스\s*\)|^\s*yonhap@|연합뉴스\s+[가-힣]{2,4}\s*기자", re.I), "Yonhap"),
         (re.compile(r"^\s*reuters@|\(Reuters\)"), "Reuters"), (re.compile(r"^\s*afp@|\(AFP\)"), "AFP"),
         (re.compile(r"^\s*ap@|\(AP\)"), "AP")]


def canonical_publisher(name, title="", credit=""):
    """One canonical English name per newsroom. `title` / `credit` (dateline, byline, first line of the summary) are
    scanned for a wire credit, which overrides the reprinting outlet. Returns None for a bare aggregator name."""
    for rx, wire in _WIRE:
        if rx.search(title or "") or rx.search((credit or "")[:160]):
            return wire
    n = re.sub(r"\s+-\s+.*$", "", (name or "").strip())               # "Yonhap News Agency - English" style suffixes
    k = _key(n)
    if k in PUBLISHER_ALIASES: return PUBLISHER_ALIASES[k]
    if k in AGGREGATORS or not k: return None
    return n


# ---- relevance + tagging -------------------------------------------------------------------------------------------
_KO_NAMES = {"000660.KS": ["SK하이닉스", "하이닉스", "SK hynix", "Hynix"], "005930.KS": ["삼성전자", "Samsung Electronics",
             r"Samsung(?!\s*(?:Electro|Bio|C&T|SDI|SDS|Heavy|Life|Fire|Securities|Card|E&A|Engineering|Biologics))"],
             "042700.KS": ["한미반도체", "Hanmi Semi", r"Hanmi(?!\s*(?:Pharm|Science|Fine))"], "009150.KS": ["삼성전기", "Samsung Electro-Mechanics"],
             "000990.KS": ["DB하이텍", "DB HiTek"], "403870.KQ": ["HPSP"], "058470.KQ": ["리노공업", "Leeno"],
             "240810.KQ": ["원익IPS", "Wonik IPS"], "039030.KQ": ["이오테크닉스", "EO Technics"]}
for _s, _n in KRM.KR_NAMES.items():                                   # keep in step with kr.py's universe
    if _s != "^KS11" and _s not in _KO_NAMES: _KO_NAMES[_s] = [_n]
_NAME_RX = {s: re.compile("|".join(n if "(?" in n else re.escape(n) for n in ns), re.I) for s, ns in _KO_NAMES.items()}
# sector/macro words: an item with none of these and no universe name is off-story
_TOPIC = re.compile(r"\bHBM\d*|\bmemory\b|메모리|D램|\bDRAM\b|낸드|\bNAND\b|semiconductor|반도체|\bchips?\b|chipmaker|"
                    r"KOSPI|코스피|foreign investors?|외국인.{0,6}(?:순매|매수|매도|투자자)|AI\s*(?:chip|accelerator)", re.I)


def _tag(text):
    hits = [(m.start(), s) for s, rx in _NAME_RX.items() for m in [rx.search(text)] if m]
    return min(hits)[1] if hits else None


# ---- parsing helpers -----------------------------------------------------------------------------------------------
def _clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", html.unescape(s or "")))
    return re.sub(r"\s+", " ", s).strip()


def _when(s):
    """RFC 822 (incl. '+09:00' offsets), ISO 8601, 'YYYY-MM-DD HH:MM:SS' or Naver 'YYYYMMDDHHMM'; naive = KST."""
    s = (s or "").strip()
    if not s: return None
    try:
        if re.fullmatch(r"\d{12}", s): return datetime.strptime(s, "%Y%m%d%H%M").replace(tzinfo=KST).astimezone(timezone.utc)
        if re.match(r"\d{4}-\d{2}-\d{2}", s):
            d = datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T", 1))
        else:
            d = parsedate_to_datetime(re.sub(r"([+-]\d{2}):(\d{2})$", r"\1\2", s))
        return (d if d.tzinfo else d.replace(tzinfo=KST)).astimezone(timezone.utc)
    except Exception:                                                   # noqa: BLE001 (one bad date drops one item)
        return None


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _rss_items(text):
    """RSS 2.0 / RSS 1.0 (RDF) / Atom -> dicts of title, link, when, author, summary (namespace-agnostic)."""
    root = ET_.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    for it in root.iter():
        if _local(it.tag) not in ("item", "entry"): continue
        f = {}
        for c in it:
            n = _local(c.tag)
            if n == "link" and not (c.text or "").strip(): f.setdefault("link", c.get("href", ""))
            elif n not in f: f[n] = c.text or ""
        when = _when(f.get("pubDate") or f.get("date") or f.get("published") or f.get("updated") or f.get("publishDate"))
        yield {"title": _clean(f.get("title")), "link": (f.get("link") or f.get("guid") or "").strip(), "when": when,
               "author": _clean(f.get("author") or f.get("creator")), "summary": _clean(f.get("description") or f.get("summary"))}


# ---- sources -------------------------------------------------------------------------------------------------------
# (via, url, default publisher). Default publisher applies unless a wire credit says otherwise.
RSS = [("Yonhap RSS", "https://en.yna.co.kr/RSS/news.xml", "Yonhap"),
       ("Korea Herald RSS", "https://www.koreaherald.com/rss/newsAll", "Korea Herald"),
       ("Korea Times RSS", "https://feed.koreatimes.co.kr/k/allnews.xml", "Korea Times"),
       ("BusinessKorea RSS", "https://www.businesskorea.co.kr/rss/allArticle.xml", "BusinessKorea"),
       ("Yonhap Korean RSS", "https://www.yna.co.kr/rss/industry.xml", "Yonhap"),
       ("Yonhap Korean RSS", "https://www.yna.co.kr/rss/market.xml", "Yonhap"),
       ("Maeil Business RSS", "https://www.mk.co.kr/rss/50200011/", "Maeil Business"),
       ("Maeil Business RSS", "https://www.mk.co.kr/rss/30100041/", "Maeil Business"),
       ("Chosun Ilbo RSS", "https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml", "Chosun Ilbo")]


def _fetch(url, headers=None):
    return get(url, headers=headers, timeout=6, tries=2)               # one quick retry (2 s) rides out a DNS blip


def _from_rss(via, url, default):
    out = []
    for it in _rss_items(_fetch(url, {"Accept": "application/rss+xml, application/xml, text/xml"})):
        # Korea Times bylines are emails ("yonhap@koreatimes.co.kr(KoreaTimes)"): the credit field carries the wire
        pub = canonical_publisher(default, it["title"], it["author"] + " " + it["summary"])
        out.append({**it, "publisher": pub, "via": via, "sym": None})
    return out


def _from_naver(code):
    url = f"https://m.stock.naver.com/api/news/stock/{code}?pageSize=50&page=1"
    d = json.loads(_fetch(url, {"Referer": f"https://m.stock.naver.com/domestic/stock/{code}/news",
                                              "Accept": "application/json"}))
    out = []
    for grp in d or []:
        for it in grp.get("items") or []:
            title = _clean(it.get("titleFull") or it.get("title"))
            pub = canonical_publisher(it.get("officeName"), title, _clean(it.get("body")))
            if not pub: continue                                          # never let "Naver" through as a publisher
            link = it.get("mobileNewsUrl") or f"https://n.news.naver.com/mnews/article/{it.get('officeId')}/{it.get('articleId')}"
            out.append({"title": title, "link": link, "when": _when(it.get("datetime")), "author": "", "summary": "",
                        "publisher": pub, "via": "Naver Finance", "sym": next((s for s in KRM.KR_UNIVERSE if s.startswith(code)), None)})
    return out


def _core(t):
    """Headline identity: Yonhap re-files one story as (URGENT) -> plain -> (LEAD) -> (2nd LD) / (종합), and English
    reprints write '2%' for Yonhap's '2 pct'; all of those are one story."""
    t = re.sub(r"^\s*(?:\((?:URGENT|LEAD|\d+(?:st|nd|rd|th) LD|News Focus|Yonhap Feature)\)\s*)+|\((?:종합\d*|\d보|속보)\)|\[속보\]",
               "", t, flags=re.I)
    t = re.sub(r"\s*(?:pct|percent)\b", "%", t.lower())
    return re.sub(r"\W+", "", t)[:60]


def kr_headlines(hours, codes=("000660", "005930", "042700")):
    """Korea AI-chip headlines newer than `hours`, deduped per (publisher, title); see the module docstring."""
    jobs = [(_from_rss, src) for src in RSS] + [(_from_naver, (c,)) for c in codes]

    def run(job):
        fn, args = job
        try:
            return fn(*args)
        except Exception as e:                                          # noqa: BLE001 (one dead source never sinks the rest)
            log("kr_news source failed", args[0] if fn is _from_naver else args[1].split("/")[2], str(e)[:90]); return []
    # hard wall-time cap: a hung DNS lookup ignores urlopen's timeout, so stragglers are abandoned on daemon threads
    # (a ThreadPoolExecutor would still be joined at interpreter exit)
    res, ts = {}, []
    for i, j in enumerate(jobs):
        ts.append(threading.Thread(target=lambda i=i, j=j: res.__setitem__(i, run(j)), daemon=True)); ts[-1].start()
    end = time.time() + WALL
    for t in ts: t.join(max(0, end - time.time()))
    if len(res) < len(jobs): log(f"kr_news: {len(jobs) - len(res)} source(s) still pending after {WALL}s, skipped")
    raw = [x for r in list(res.values()) for x in r]
    cut, seen, out = datetime.now(timezone.utc) - timedelta(hours=hours), set(), []
    # an uncredited reprint (Korea Herald runs Yonhap copy with no dateline) still has Yonhap's headline: same core
    # headline as a Yonhap item -> it IS the Yonhap story
    wire = {_core(x["title"]) for x in raw if x["publisher"] == "Yonhap" and x["title"]}
    for it in sorted(raw, key=lambda x: x["when"] or cut, reverse=True):
        t = it["title"]
        if not t or not it["publisher"] or not it["when"] or it["when"] < cut: continue
        sym = _tag(t)
        # RSS items need a universe name or a sector word in the title; Naver ticker news is on-stock by construction
        if not (sym or _TOPIC.search(t) or it["sym"]): continue
        core = _core(t)
        if core in wire: it["publisher"] = "Yonhap"
        k = (it["publisher"], core)
        if k in seen or it["link"] in seen: continue
        seen.update([k, it["link"]])
        out.append({"tag": sym or it["sym"] or "MACRO", "title": t, "publisher": it["publisher"], "when": it["when"],
                    "link": it["link"], "lang": "ko" if re.search(r"[가-힣]", t) else "en", "via": it["via"]})
    return out


if __name__ == "__main__":
    cases = {"Yonhap": "Yonhap", "연합뉴스": "Yonhap", "Yonhap News Agency": "Yonhap", "연합뉴스TV": "Yonhap",
             "Yonhap Infomax": "Yonhap Infomax", "연합인포맥스": "Yonhap Infomax",
             "한국경제": "Korea Economic Daily", "Hankyung": "Korea Economic Daily", "The Korea Economic Daily": "Korea Economic Daily",
             "KED Global": "Korea Economic Daily", "매일경제": "Maeil Business", "Maeil Business News Korea": "Maeil Business",
             "Pulse by Maeil Business News Korea": "Maeil Business", "mk.co.kr": "Maeil Business", "매일신문": "Maeil Shinmun",
             "Korea JoongAng Daily": "JoongAng", "중앙일보": "JoongAng", "The Korea Herald": "Korea Herald",
             "Business Korea": "BusinessKorea", "The Chosun Daily": "Chosun Ilbo", "조선비즈": "ChosunBiz",
             "The Korea Times": "Korea Times", "Reuters": "Reuters"}
    for name, want in cases.items():
        assert canonical_publisher(name) == want, (name, canonical_publisher(name), want)
    # wire credits override the reprinting outlet; photo captions do not
    assert canonical_publisher("Korea Times", "x", "yonhap@koreatimes.co.kr(KoreaTimes) SEOUL") == "Yonhap"
    assert canonical_publisher("The Korea Herald", "SK hynix hits record (Yonhap)") == "Yonhap"
    assert canonical_publisher("머니투데이", "t", "(서울=연합뉴스) 홍길동 기자 = 삼성전자가") == "Yonhap"
    assert canonical_publisher("Korea Times", "t", "reuters@koreatimes.co.kr(KoreaTimes)") == "Reuters"
    assert canonical_publisher("조선일보", "t", "트레이더들이 일하고 있다. /로이터 연합뉴스") == "Chosun Ilbo"
    for agg in ("Naver", "네이버", "Daum", "Google News"):
        assert canonical_publisher(agg) is None, agg
    assert _tag("Samsung Electro-Mechanics and SK hynix rally") == "009150.KS" and _tag("Hanmi Pharm up") is None
    assert _tag("삼성전자, HBM4 공급") == "005930.KS" and _tag("Samsung Biologics wins deal") is None
    assert _core("(2nd LD) Seoul stocks rise nearly 2 pct") == _core("Seoul stocks rise nearly 2% ")
    assert _when("Fri, 02 Oct 2026 10:08:17 +09:00") == datetime(2026, 10, 2, 1, 8, 17, tzinfo=timezone.utc)
    assert _when("2026-10-02 10:03:50") == datetime(2026, 10, 2, 1, 3, 50, tzinfo=timezone.utc)
    assert _when("202610021009") == datetime(2026, 10, 2, 1, 9, tzinfo=timezone.utc)
    print(f"kr_news self-test OK: {len(cases)} alias cases, 5 wire-credit cases, 4 aggregator rejections, tag + date parsing")
