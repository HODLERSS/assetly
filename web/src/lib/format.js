// Money and percent formatting. Sign always travels with color (never color alone).
export function money(v, currency = "USD", compactKrw = false) {
    if (v === null || v === undefined || Number.isNaN(v))
        return "—";
    if (currency === "KRW") {
        const n = Math.round(v);
        if (compactKrw && Math.abs(n) >= 1e8)
            return `₩${(n / 1e8).toFixed(1)}억`;
        return `₩${n.toLocaleString("en-US")}`;
    }
    const abs = Math.abs(v);
    const dp = abs > 0 && abs < 1000 ? 2 : 0;
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
export function signedMoney(v, currency = "USD") {
    if (v === null || v === undefined || Number.isNaN(v))
        return "—";
    const sign = v > 0 ? "+" : v < 0 ? "-" : "";
    return sign + money(Math.abs(v), currency);
}
export function signedPct(v, dp = 2) {
    if (v === null || v === undefined || Number.isNaN(v))
        return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${v.toFixed(dp)}%`;
}
export function glClass(v) {
    if (v === null || v === undefined || v === 0)
        return "mutedc";
    return v > 0 ? "gain" : "loss";
}
export function timeAgo(iso) {
    if (!iso)
        return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90)
        return "just now";
    if (s < 3600)
        return `${Math.round(s / 60)}m ago`;
    if (s < 86400)
        return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
}
