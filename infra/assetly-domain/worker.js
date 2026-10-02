// assetly.minjae.co -> https://hodlerss.github.io/assetly/ (owner, 2026-10-01). A transparent mirror: the address bar
// stays on assetly.minjae.co and nothing on GitHub changes (App Store privacy/support links, Google OAuth verification
// and Supabase redirects keep their github.io URLs working).
// The built web app references absolute "/assetly/..." paths, so both "/x" and "/assetly/x" map to the same origin file.
const ORIGIN = "https://hodlerss.github.io/assetly";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.protocol === "http:") { url.protocol = "https:"; return Response.redirect(url.toString(), 301); }
    // /get (owner 10/2, cafe flyer QR): one link for every phone. iPhone/iPad -> the App Store with a campaign token
    // (App Store Connect counts flyer installs as ct=flyer-<c>); Android and everything else -> the web app.
    if (url.pathname === "/get" || url.pathname === "/get/") {
      const c = (url.searchParams.get("c") || "cafe").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "cafe";
      const ios = /iPhone|iPad|iPod/i.test(request.headers.get("User-Agent") || "");
      const to = ios ? `https://apps.apple.com/app/apple-store/id6811739789?pt=129454012&ct=flyer-${c}&mt=8`
                     : `https://${url.host}/?ref=flyer-${c}`;
      return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
    }
    let path = url.pathname.replace(/^\/assetly(?=\/|$)/, "") || "/";
    const upstream = new URL(ORIGIN + path + url.search);
    const res = await fetch(upstream.toString(), {
      method: request.method,
      headers: { "Accept": request.headers.get("Accept") || "*/*", "Accept-Encoding": request.headers.get("Accept-Encoding") || "" },
      redirect: "manual",
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    const out = new Response(res.body, res);
    // GitHub's own redirects (e.g. /about -> /about/) point at github.io: bring them back to this host
    const loc = out.headers.get("Location");
    if (loc) out.headers.set("Location", loc.replace(/^https?:\/\/hodlerss\.github\.io\/assetly/, `https://${url.host}`));
    out.headers.delete("x-github-request-id");
    return out;
  },
};
