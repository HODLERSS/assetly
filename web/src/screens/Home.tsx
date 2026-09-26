import { platformTag, startConnect } from "../lib/native";
import { useInFlight } from "../lib/inflight";
import { useEffect, useState } from "react";
import type { Api, PortfolioRow } from "../lib/api";
import { BriefCard } from "../components/BriefCard";
import { AssessmentCard } from "../components/AssessmentCard";
import { ConnectNote, connectMsg, type ConnectMsg } from "../components/ConnectNote";
import type { AssessState } from "../lib/assessment";
import { isMarketOpen, type Market, marketOf, moveSession, moverEligible, moverMode, sessionLabel } from "../lib/markets";
import { convertCcy, glClass, labelParts, money, moneyClass, moneyExact, priceCompact, qtyUnit, signedMoney, signedMoneyCompact, signedPct, type FxRates } from "../lib/format";
import { Icon } from "../components/Icon";
import { accountTag, isRetirement } from "../lib/accounts";
import { formatQty } from "../lib/numbers";
import { dayGroups, isHeld, marketBreakdown, rowDayChange, rowDayPct } from "../lib/portfolio";

// Canvas 2a: net worth, movers, market pulse.
const DETAIL_KEY = "assetly-nw-detail";
// Market times read in ET with the zone, as the brief states them ("as of 7:31 PM ET"): the device's own clock
// with no zone ("as of 3:00 PM", Central) sat beside the brief's ET stamp (r8 designer).
export const asOfClock = (iso: string) =>
  `${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
// The one-time "what next" hint: armed by the first run of adds (App), "done" once dismissed.
export const NEXT_KEY = "assetly-next-steps";
// A day move's colour: by its sign, except that a move rounding to 0.00% is neutral ("Crypto −$1 (0.00%)" led
// an up day in red; e2e p02 F7).
const dayTone = (day: number, basis: number): string => (Math.abs(basis !== 0 ? (day / basis) * 100 : 0) < 0.005 ? "mutedc" : moneyClass(day));

export function Home({ api, rows: book, totals, baseCurrency, onOpen, onAdd, dispUs = "USD", dispKr = "KRW" , briefBanner = null, onBriefBannerDone, loading = false,
  assessment = null, onAssessRetry, onAssessDismiss, onOpenNews, pricesAsOf = null, briefRev = 0, loadFailed = false }: {
  api: Api; rows: PortfolioRow[]; loading?: boolean;
  /** no book has loaded for this user and the last load failed */
  loadFailed?: boolean;
  totals: { value: number; assets: number; debt: number; gl: number; cost: number; day: number; mixed: boolean; fx: FxRates | number | null; unconverted: number };
  baseCurrency: "USD" | "KRW"; onOpen: (id: string) => void; onAdd: () => void;
  dispUs?: "USD" | "KRW"; dispKr?: "USD" | "KRW";
  briefBanner?: { audio: boolean; edition?: string } | null; onBriefBannerDone?: () => void;
  assessment?: AssessState | null; onAssessRetry?: () => void; onAssessDismiss?: () => void; onOpenNews?: () => void;
  /** set when the last refresh failed: the time of the prices on screen. Nothing reads as live then. */
  pricesAsOf?: string | null;
  /** bumped by App when a newer brief lands or the connection comes back: the card reloads its editions */
  briefRev?: number;
}) {
  // App already drops empty holdings; a 0-share row must never reach Movers or the list whoever renders Home
  const rows = book.filter(isHeld);
  // only the markets this book actually holds drive the session badge and mover mode
  const heldMkts = [...new Set(rows.map((r) => marketOf(r)).filter((m): m is "US" | "KR" => m === "US" || m === "KR"))];
  const hasCrypto = rows.some((r) => marketOf(r) === "CRYPTO");
  const mode = moverMode(new Date(), heldMkts);
  const [pulse, setPulse] = useState<{ symbol: string; name: string; price: number; change_pct: number | null }[]>([]);
  const [filter, setFilter] = useState<"all" | Market | "ret">("all");
  // collapsed by default; whoever wants the split gets it back on every visit
  const [detail, setDetailState] = useState(() => { try { return localStorage.getItem(DETAIL_KEY) === "1"; } catch { return false; } });
  const setDetail = (v: boolean) => { setDetailState(v); try { localStorage.setItem(DETAIL_KEY, v ? "1" : "0"); } catch { /* private mode */ } };
  const [nextArmed, setNextArmed] = useState(() => { try { return localStorage.getItem(NEXT_KEY) === "armed"; } catch { return false; } });
  useEffect(() => { try { if (localStorage.getItem(NEXT_KEY) === "armed") setNextArmed(true); } catch { /* private mode */ } }, [assessment?.startedAt]);
  const setNextDone = () => { setNextArmed(false); try { localStorage.setItem(NEXT_KEY, "done"); } catch { /* private mode */ } };
  // Import / Connect: one at a time (a double tap sent two connect calls), busy while the link is fetched, and a
  // failure said instead of swallowed (r5 power-user). startConnect opens the web portal window inside the tap.
  const [connecting, runConnect] = useInFlight();
  const [connectErr, setConnectErr] = useState<ConnectMsg | null>(null);
  const connect = () => {
    setConnectErr(null);
    void runConnect(async () => {
      try { await startConnect(async () => (await api.snaptrade("connect", { platform: platformTag() })).url); }
      catch (e) { setConnectErr(connectMsg(e)); }
    });
  };
  const connectNote = <ConnectNote msg={connectErr} testId="connect-error" />;
  useEffect(() => {
    let live = true;
    if (mode.kind === "pulse") api.getPulse().then((p) => { if (live) setPulse(p); }).catch(() => {});
    return () => { live = false; };
  }, [api, mode.kind]);
  // Per-market display currency (Settings matrix).
  const show = (v: number | null, r: PortfolioRow): [number | null, string] => {
    const target = r.currency === "KRW" ? dispKr : dispUs;
    if (target === r.currency || v === null) return [v, r.currency];
    const c = convertCcy(v, r.currency, target, totals.fx);
    return c === null ? [v, r.currency] : [c, target];
  };
  // An empty book is only "no positions" once the first load has answered. Before that it is
  // unknown, and the screen holds the shape of Home rather than offering to connect a brokerage.
  if (rows.length === 0 && loading) {
    return (
      <div className="home-skeleton" aria-busy="true" aria-label="Loading your portfolio" data-testid="home-loading">
        <section style={{ margin: "8px 0 18px" }}>
          <div className="skel-line" style={{ height: 34, width: "58%", margin: "6px 0 10px" }} />
          <div className="skel-line" style={{ width: "44%" }} />
          <div className="skel-line" style={{ width: "40%" }} />
          <div className="nw-rule" aria-hidden="true" />
        </section>
        <div className="card insights brief-skeleton" data-testid="home-skeleton-brief" style={{ minHeight: 132 }}>{/* the brief card's own inset and rule (r9 designer m-5) */}
          <div className="skel-line" style={{ width: "36%" }} />
          <div className="skel-line" style={{ width: "88%" }} />
          <div className="skel-line" style={{ width: "72%" }} />
        </div>
        <div className="skel-line" style={{ width: "28%", height: 14, margin: "18px 0 12px" }} />
        {[0, 1, 2].map((i) => <div key={i} className="skel-line" style={{ height: 40, width: "100%" }} />)}
      </div>
    );
  }
  // the book never loaded (the banner above says so, with Retry): an empty list here is unknown, not "no
  // positions", so no Connect call to action for a user who has holdings (r8 power-user m2)
  if (rows.length === 0 && loadFailed) {
    return <p className="empty" data-testid="home-load-failed">Your holdings show here once they load.</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="empty">
        <p style={{ marginBottom: 14 }}>Nothing here yet. Connect a brokerage or add what you own, and your brief starts today.</p>
        <button className="btn" style={{ marginBottom: 10 }} disabled={connecting} aria-busy={connecting || undefined} onClick={connect}>
          <Icon name="bolt" /> {connecting ? "Opening…" : "Connect your brokerage"}</button>
        {connectNote}
        <button className="btn secondary" onClick={onAdd}>Add positions manually</button>
      </div>
    );
  }
  // Holdings folded in: market / retirement filters with their own totals line
  // The filters name what they hold: "US" totals had BTC and ETH in them (r3 power-user). Crypto is its own
  // chip, its own Breakdown line, and its own name in the headline ("US + Crypto" when both moved in a session).
  const order: Market[] = ["US", "KR", "CRYPTO"];
  const marketsHeld = order.filter((m) => rows.some((r) => marketOf(r) === m));
  const hasRet = rows.some((r) => isRetirement(r.account));
  const filterChips: (Market | "ret")[] = [...(marketsHeld.length > 1 ? marketsHeld : []), ...(hasRet ? ["ret" as const] : [])];
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "ret" ? isRetirement(r.account) : marketOf(r) === filter));
  // ranked by the same % each mover line prints (rowDayPct): ranking by the price move left NVDA at +2.46%
  // (a same-day lot) out while TSLA at -1.54% was listed (r8 power-user m3)
  const byShownMove = (a: PortfolioRow, b: PortfolioRow) => Math.abs(rowDayPct(b) ?? 0) - Math.abs(rowDayPct(a) ?? 0);
  // a position bought in full today has not moved for its owner ("0.00% ($0)"): not a mover (r8 newcomer)
  const hasMoved = (r: PortfolioRow) => !(r.day_change !== undefined && rowDayPct(r) === 0);
  const movers = [...rows].filter((r) => r.change_pct !== null && hasMoved(r) && moverEligible(r, new Date(), heldMkts))
    .sort(byShownMove).slice(0, 3);
  const quietMovers = [...rows].filter((r) => r.change_pct !== null && hasMoved(r) && marketOf(r) !== null)
    .sort(byShownMove).slice(0, 3);
  const showPulse = mode.kind === "pulse" && pulse.length > 0;
  // offline, nothing pulses: the dots say "live", and these prices are from the last good refresh
  const isLive = (r: PortfolioRow) => { const m = marketOf(r); return !pricesAsOf && m !== null && r.change_pct !== null && isMarketOpen(m); };
  // Movers ranks holdings against each other: with one stock (plus cash) it only repeated the position list
  const showMovers = rows.filter((r) => r.kind !== "cash" && r.kind !== "debt").length >= 2;
  const assessPending = !!assessment && (assessment.phase === "pending" || assessment.phase === "slow");
  const liveDayPct = totals.assets - totals.day !== 0 ? (totals.day / (totals.assets - totals.day)) * 100 : null;
  const heldSymbols = rows.filter((r) => r.kind !== "cash" && r.kind !== "debt").map((r) => r.symbol);
  const moverList = mode.kind === "pulse" && !showPulse ? quietMovers : movers;
  // The three supporting lines under the headline totals were the busiest thing on the screen and
  // none of them is what you open the app for. They fold away; the toggle only appears when there
  // is actually something folded, and the choice sticks.
  const fxRates = typeof totals.fx === "number" ? { USD: 1, KRW: totals.fx } : totals.fx;
  const groups = dayGroups(rows, baseCurrency, fxRates);
  // the same rows and math as the headline, by market (lib/portfolio marketBreakdown): header and Breakdown agree
  const marketLines = totals.fx ? marketBreakdown(rows, baseCurrency, fxRates) : [];
  const hasDetail = totals.debt > 0 || marketLines.length > 0;
  // one small dot per row, before the day figure: green and pulsing while that market is open, grey when closed;
  // the words stay for assistive tech (owner, home-calm: the per-row "Fri close" / "today" text is gone)
  const sessionDot = (r: PortfolioRow) => {
    const live = isLive(r);
    return <span className={`session-dot${live ? " live" : ""}`} role="img" data-testid="session-dot" aria-label={live ? "Live" : `Closed, ${moveSession(r).label}`} />;
  };
  return (
    <>
      <section aria-label="Net worth" style={{ margin: "8px 0 18px" }}>
        <div className="net num" data-testid="net-worth">{money(totals.value, baseCurrency)}</div>
        {/* Two calm lines (owner, home-calm / home-today): "Today" adds only the markets whose latest session IS
            today on their own exchange's calendar (a coin always counts); sessions from other days are never
            summed into it. Nothing traded today (a US-only book on a Saturday): "Today · markets closed", and the
            Breakdown below carries each market's last session. "All time" is the positions' gain. */}
        {(() => {
          const fig = (d: number, b: number) => `${signedMoney(d, baseCurrency)} (${signedPct(b !== 0 ? (d / b) * 100 : 0)})`;
          const todays = groups.filter((g) => g.today);
          if (!todays.length) {
            const last = groups.map((g) => `${g.markets.join(" + ")} ${g.label}`);
            return (
              <div className="day num mutedc" data-testid="total-day" data-closed="true"
                aria-label={`Today: markets closed${last.length ? `. Last sessions: ${last.join(", ")}` : ""}`}>
                <span className="day-label">Today</span> · markets closed
              </div>
            );
          }
          const day = todays.reduce((a, g) => a + g.day, 0), basis = todays.reduce((a, g) => a + g.basis, 0);
          const which = [...new Set(todays.flatMap((g) => g.markets))];
          const names = which.length > 1 ? `${which.slice(0, -1).join(", ")} and ${which[which.length - 1]}` : which[0];
          return (
            <div className={`day num ${dayTone(day, basis)}`} data-testid="total-day" aria-label={`Today: ${names} ${fig(day, basis)}`}>
              <span className="day-label">Today</span> {fig(day, basis)}
            </div>
          );
        })()}
        <div className={`day num ${moneyClass(totals.gl)}`} data-testid="total-gl" style={{ fontSize: 13.5 }}>
          <span className="day-label">All time</span> {signedMoney(totals.gl, baseCurrency)} ({signedPct(totals.cost !== 0 ? (totals.gl / totals.cost) * 100 : 0)})
        </div>
        <div className="nw-detail" id="nw-detail" hidden={!detail}>
        {totals.debt > 0 && (
          <div className="status-line num" data-testid="assets-debt">
            assets {money(totals.assets, baseCurrency)} · debt {signedMoney(-totals.debt, baseCurrency)}
          </div>
        )}
        {marketLines.length > 0 && (() => {
          // one line per market (US / Korea / Crypto), the headline's own figures, each with its session
          const fig = (d: number, b: number) => `${signedMoney(d, baseCurrency)} (${signedPct(b !== 0 ? (d / b) * 100 : 0)})`;
          const sessionOf = (m: Market) => {
            const r = rows.filter((x) => marketOf(x) === m && x.change_pct !== null).sort((a, b) => (b.as_of ?? "").localeCompare(a.as_of ?? ""))[0];
            return r ? moveSession(r).label : null;
          };
          return (
            <div data-testid="market-breakdown">
              {marketLines.map((m) => (
                <div key={m.market} className={`status-line num ${dayTone(m.day, m.basis)}`} data-testid="market-line" data-market={m.market}>
                  {m.label} {fig(m.day, m.basis)}{sessionOf(m.market) ? ` · ${sessionOf(m.market)}` : ""}
                </div>
              ))}
              <div className="status-line num" data-testid="market-breakdown-all">all time: {marketLines.map((m) => `${m.label} ${fig(m.gl, m.cost)}`).join(" · ")}</div>
            </div>
          );
        })()}
        </div>
        {hasDetail && (
          <button className="nw-more" type="button" data-testid="nw-detail-toggle"
            aria-expanded={detail} aria-controls="nw-detail" onClick={() => setDetail(!detail)}>
            {detail ? "Less" : "Breakdown"}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}
        {totals.unconverted > 0 && (
          <div className="status-line" role="note">{totals.unconverted} position{totals.unconverted > 1 ? "s aren't" : " isn't"} in the total yet (waiting for an exchange rate).</div>
        )}
        {pricesAsOf && (
          <div className="status-line" role="note" data-testid="prices-as-of">Prices as of {asOfClock(pricesAsOf)}</div>
        )}
        <div className="nw-rule" aria-hidden="true" />
      </section>
      {/* "ready" never shows over a newer run that is still being written (r2 newcomer N1) */}
      {briefBanner && !(briefBanner.edition === "assessment" && assessPending) && (
        <div className="status-note ok" role="status" data-testid="brief-banner">
          <span className="lead"><Icon name="check" />{briefBanner.edition === "assessment" ? "Your assessment is ready." : "Your brief is ready."}{briefBanner.audio ? <> Tap <Icon name="play" size={10} /> to listen.</> : ""}</span>
          <button className="chip" onClick={onBriefBannerDone} aria-label="Dismiss"><Icon name="close" size={12} /></button>
        </div>
      )}
      {assessment && <AssessmentCard state={assessment} onRetry={() => onAssessRetry?.()} onDismiss={() => onAssessDismiss?.()} onOpenNews={onOpenNews} />}
      {/* a fresh assessment reloads the brief card so it shows at once (its own look-up gave up after 4 min).
          It refetches in place: a remount by key flashed the card washed out (r7 design n-3) */}
      <BriefCard api={api} reload={`${assessment?.readyAt ?? "brief"}:${briefRev}`} liveDayPct={liveDayPct} held={heldSymbols} book={rows}
        totalUsd={convertCcy(totals.assets, baseCurrency, "USD", totals.fx)}
        pendingSince={assessPending ? assessment!.startedAt : null} onRefreshAssessment={onAssessRetry} />
      {nextArmed && rows.filter((r) => r.kind !== "cash" && r.kind !== "debt").length < 3 && (
        // after the first adds: the obvious next moves, until the book looks like a portfolio or it is dismissed
        <section className="card next-steps" data-testid="next-steps" aria-label="Next steps">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Add the rest of your portfolio</strong>
            <button className="chip" onClick={setNextDone} aria-label="Dismiss next steps"><Icon name="close" size={12} /></button>
          </div>
          <p className="sub" style={{ margin: "4px 0 0" }}>Your brief covers everything you own, so each holding you add makes it sharper.</p>
          <div className="next-steps-actions">
            <button className="chip" onClick={onAdd}>+ Add another</button>
            <button className="chip" disabled={connecting} aria-busy={connecting || undefined} onClick={connect}>
              <Icon name="bolt" size={12} /> {connecting ? "Opening…" : "Import from a brokerage"}</button>
            {/* only once there is something to read: before the first intelligence lands, News is empty */}
            {onOpenNews && !(assessPending && !assessment?.intelligenceReady) && <button className="chip" onClick={onOpenNews}>See today's news</button>}
          </div>
        </section>
      )}
      {(showMovers || showPulse) && <h2 className="h1" style={{ fontSize: 16 }}>Movers <span className="sub" data-testid="session-label" style={{ fontWeight: 400 }}>· {pricesAsOf ? `as of ${asOfClock(pricesAsOf)}` : sessionLabel(new Date(), heldMkts, hasCrypto && (showPulse || moverList.some((r) => marketOf(r) === "CRYPTO")))}</span></h2>}
      {showPulse && (
        <div className="card" style={{ marginBottom: 16 }} data-testid="pulse-card">
          {pulse.map((p) => (
            <div key={p.symbol} className="row" style={{ cursor: "default" }}>
              <span><span className="sym">{p.name}</span></span>
              <span className={`right ${glClass(p.change_pct)}`}>
                <span className="num">{p.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                <span className="num sub"> · {signedPct(p.change_pct)}</span>
              </span>
            </div>
          ))}
          <p className="sub" style={{ margin: "6px 2px 2px" }}>Index futures ahead of the US open.</p>
        </div>
      )}
      {showMovers && !showPulse && <div className="card" style={{ marginBottom: 16 }} data-testid="movers-card">
        {moverList.map((r) => (
          // the same grammar as a position row: coloured "±% (±$)"
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{labelParts(r, dispKr === "KRW").main}</span> <span className="sub">{labelParts(r, dispKr === "KRW").sub}</span></span>
            <span className={`right num ${glClass(rowDayPct(r))}`}>
              {sessionDot(r)}{signedPct(rowDayPct(r))}{(() => { const [dv, dc] = show(rowDayChange(r), r); return <> ({signedMoneyCompact(dv, dc)})</>; })()}
            </span>
          </button>
        ))}
      </div>}
      {/* wraps its chips under the title when they don't fit (AX5 at 320: "+ Add" ran 11px past the screen) */}
      <div className="positions-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", columnGap: 8 }}>
        <h2 className="h1" style={{ fontSize: 16 }}>Positions</h2>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="chip" aria-label="Import from brokerage" disabled={connecting} aria-busy={connecting || undefined} onClick={connect}>
            <Icon name="bolt" size={12} /> {connecting ? "Opening…" : "Import"}</button>
          <button className="chip" onClick={onAdd} aria-label="Add position">+ Add</button>
        </span>
      </div>
      {connectNote}
      {filterChips.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by type">
          <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
          {filterChips.map((k) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {k === "US" ? "US" : k === "KR" ? "Korea" : k === "CRYPTO" ? "Crypto" : "Retirement"}
            </button>
          ))}
        </div>
      )}
      {filter !== "all" && shown.length > 0 && (() => {
        let value = 0, day = 0, gl = 0, invested = 0;   // invested: the all-time % base, cash and debt left out
        for (const r of shown) {
          const sign = r.kind === "debt" ? -1 : 1;
          const v = convertCcy(r.value ?? 0, r.currency, baseCurrency, totals.fx) ?? 0;
          const d = convertCcy(rowDayChange(r) ?? 0, r.currency, baseCurrency, totals.fx) ?? 0;
          const g = convertCcy(r.total_gl ?? 0, r.currency, baseCurrency, totals.fx) ?? 0;
          value += sign * v; day += sign * d; gl += sign * g;
          if (r.kind !== "cash" && r.kind !== "debt") invested += v;
        }
        const dayPct = value - day !== 0 ? (day / (value - day)) * 100 : 0;
        // a filter whose market is closed today says which session its move is from ("Wed close"), as the headline does
        const moving = shown.filter((r) => r.kind !== "cash" && r.kind !== "debt" && r.change_pct !== null);
        const sessions = [...new Set(moving.map((r) => moveSession(r).label))];
        const dayWord = moving.length && moving.every((r) => !moveSession(r).today) && sessions.length === 1 ? sessions[0] : "today";
        const glPct = invested - gl !== 0 ? (gl / (invested - gl)) * 100 : 0;
        return (
          <div className="status-line num" data-testid="filter-totals" style={{ margin: "0 2px 8px" }}>
            {money(value, baseCurrency)} · {dayWord} <span className={moneyClass(day)}>{signedMoney(day, baseCurrency)} ({signedPct(dayPct)})</span> · total <span className={moneyClass(gl)}>{signedMoney(gl, baseCurrency)} ({signedPct(glPct)})</span>
          </div>
        );
      })()}
      <div className="card" data-testid="positions-card">
        {shown.map((r) => {
          const [rv, rc] = show(r.value, r);
          return (
            <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
              <span>
                <span className="sym">{labelParts(r, dispKr === "KRW").main}</span> <span className="sub">{labelParts(r, dispKr === "KRW").sub}</span><br />
                <span className="sub num">{r.kind === "cash" ? "Cash balance" : r.kind === "debt" ? "Debt balance" : `${formatQty(r.qty ?? 0)} ${qtyUnit(r)}`}{accountTag(r.account) ? <span className="row-acct"> · {accountTag(r.account)}</span> : ""}{r.source === "snaptrade" ? <span className="row-acct"> · <Icon name="bolt" size={10} /></span> : ""}{r.kind === "cash" || r.kind === "debt" ? "" : r.price !== null
                  // under 360pt a won price was cut to "\u20a91,86\u2026": the compact form (\u20a91.86M) fits (r3 power-user)
                  ? <> · {priceCompact(r.price, r.currency) === moneyExact(r.price, r.currency) ? moneyExact(r.price, r.currency)
                    : <><span className="px-full">{moneyExact(r.price, r.currency)}</span><span className="px-compact">{priceCompact(r.price, r.currency)}</span></>}</>
                  : ` · avg ${moneyExact(r.avg_cost, r.currency)}`}</span>
              </span>
              <span className="right">
                <span className="num">{r.kind === "debt" ? signedMoney(-(rv ?? 0), rc) : money(rv, rc)}</span>
                {/* a balance has no daily move: "0.00% ($0) today" on cash was noise */}
                {r.kind !== "cash" && r.kind !== "debt" && (<><br />
                <span className={`num sub ${glClass(rowDayPct(r))}`}>{sessionDot(r)}{signedPct(rowDayPct(r))}{r.change_pct !== null && (() => { const [dv, dc] = show(rowDayChange(r), r); return <> ({signedMoneyCompact(dv, dc)})</>; })()}</span></>)}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="empty">Nothing in this filter.</p>}
      </div>
    </>
  );
}
