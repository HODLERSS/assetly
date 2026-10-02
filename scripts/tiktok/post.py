#!/usr/bin/env python3
"""Post a Short to TikTok (@assetlyapp) with the Content Posting API (FILE_UPLOAD), the TikTok twin of youtube/upload.py.
   python3 post.py <delivery dir>       reads tiktok.mp4, tiktok-caption.txt; updates tiktok.json
Needs ~/.private_keys/tiktok_token.json {"client_key","client_secret","refresh_token",...}, written once by auth.py after the
owner's one-time developer-app setup (references/tiktok.md "Owner setup"). Never prints secrets.

Modes (TIKTOK_MODE): direct (Direct Post, video.publish), inbox (Upload to the creator's TikTok inbox, video.upload: the owner
taps the notification and posts, like YouTube's private upload + publish), auto (default: direct; an unaudited app that
TikTok refuses for a public account falls back to inbox when the token carries video.upload).
Labels: is_aigc true (synthetic voices), brand_organic_toggle true (Assetly promotes itself).

Exit codes (run.sh reads them): 0 posted / in the inbox; 3 no token (queue for Chrome); 4 refused before any upload (safe to
queue or retry); 5 uploaded but not confirmed (do NOT re-post: check TikTok Studio, the status is in tiktok.json).
TIKTOK_API_BASE / TIKTOK_TOKEN_FILE / TIKTOK_POLL_S point it at a mock (selftest.py)."""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request
K = os.environ.get("TIKTOK_TOKEN_FILE", os.path.expanduser("~/.private_keys/tiktok_token.json"))
BASE = os.environ.get("TIKTOK_API_BASE", "https://open.tiktokapis.com")
POLL = float(os.environ.get("TIKTOK_POLL_S", "6"))
class TikTokError(Exception):
    def __init__(self, code, msg, http=0): super().__init__(f"{code}: {msg}"); self.code, self.http = code, http
def api(path, body=None, tok=None, form=False):
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    if form: data = urllib.parse.urlencode(body).encode(); h["Content-Type"] = "application/x-www-form-urlencoded"
    else: data = json.dumps(body or {}).encode(); h["Content-Type"] = "application/json; charset=UTF-8"
    try: r = json.loads(urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=h, method="POST"), timeout=60).read())
    except urllib.error.HTTPError as e:      # TikTok puts the reason in the body: {"error": {"code", "message"}}
        try: err = json.loads(e.read()).get("error", {})
        except Exception: err = {}
        if isinstance(err, str): err = {"code": err}
        raise TikTokError(err.get("code") or f"http_{e.code}", err.get("message", ""), e.code)
    err = r.get("error") or {}
    if isinstance(err, str): raise TikTokError(err, r.get("error_description", ""))      # the OAuth endpoint's shape
    if err.get("code") not in (None, "", "ok"): raise TikTokError(err["code"], err.get("message", ""))
    return r
def save_token(k):
    tmp = K + ".tmp"; fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f: json.dump(k, f)
    os.replace(tmp, K)
def record(D, **kw):
    p = os.path.join(D, "tiktok.json"); j = json.load(open(p)) if os.path.exists(p) else {}
    j.update(kw); json.dump(j, open(p, "w"), indent=1); return j
def main():
    D = sys.argv[1]
    tj = os.path.join(D, "tiktok.json")
    if os.path.exists(tj) and json.load(open(tj)).get("status") in ("posted", "publish_complete", "send_to_user_inbox"):
        print("already posted: nothing to do"); sys.exit(0)        # never post the same Short twice
    if not os.path.exists(K): print(f"no TikTok API token ({K}): run app/scripts/tiktok/auth.py once; queue for Chrome", file=sys.stderr); sys.exit(3)
    k = json.load(open(K))
    try:
        t = api("/v2/oauth/token/", {"client_key": k["client_key"], "client_secret": k["client_secret"],
                "grant_type": "refresh_token", "refresh_token": k["refresh_token"]}, form=True)
    except TikTokError as e:
        print(f"TikTok token refresh failed ({e.code}): run app/scripts/tiktok/auth.py again", file=sys.stderr); sys.exit(3)
    if t.get("refresh_token") and t["refresh_token"] != k["refresh_token"]:
        k["refresh_token"] = t["refresh_token"]; k["refresh_expires_at"] = int(time.time()) + int(t.get("refresh_expires_in", 0)); save_token(k)
    tok, scopes = t["access_token"], set((t.get("scope") or k.get("scope") or "").replace(" ", "").split(","))
    vid = os.path.join(D, "tiktok.mp4"); size = os.path.getsize(vid)
    cap = open(os.path.join(D, "tiktok-caption.txt")).read()
    # one chunk: the package is < 10 MB (TikTok: a file under 5 MB must go whole; up to 64 MB may be one chunk)
    src = {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": size, "total_chunk_count": 1}
    mode = os.environ.get("TIKTOK_MODE", "auto")
    init = privacy = None
    try:
        if mode in ("auto", "direct"):
            try:
                ci = api("/v2/post/publish/creator_info/query/", tok=tok)["data"]
                opts = ci.get("privacy_level_options", [])
                # owner, 10/1 evening: TikTok posts are public (Everyone); when the creator cannot (audit pending) it is SELF_ONLY
                privacy = os.environ.get("TIKTOK_PRIVACY", "PUBLIC_TO_EVERYONE")
                if privacy not in opts: privacy = "SELF_ONLY"
                init = api("/v2/post/publish/video/init/", {
                    "post_info": {"title": cap, "privacy_level": privacy, "disable_comment": False, "disable_duet": False, "disable_stitch": False,
                                  "is_aigc": True, "brand_organic_toggle": True, "brand_content_toggle": False,
                                  "video_cover_timestamp_ms": 0},   # the cover = frame 0, the headline cover (thumbnail.png)
                    "source_info": src}, tok=tok)["data"]
                mode = "direct"
            except TikTokError as e:
                # an unaudited app may only Direct Post to a PRIVATE account; @assetlyapp is public. The inbox upload works
                # unaudited: the video lands in the owner's TikTok inbox and he posts it (caption + labels as in tiktok.json)
                if mode == "auto" and e.code in ("unaudited_client_can_only_post_to_private_accounts", "scope_not_authorized") and "video.upload" in scopes:
                    print(f"direct post refused ({e.code}): sending to the TikTok inbox instead", file=sys.stderr); mode = "inbox"
                else: raise
        if mode == "inbox":
            init = api("/v2/post/publish/inbox/video/init/", {"source_info": src}, tok=tok)["data"]
    except TikTokError as e:
        record(D, status="refused", via="api", error=e.code); print(f"TikTok refused before upload: {e}", file=sys.stderr); sys.exit(4)
    put = urllib.request.Request(init["upload_url"], data=open(vid, "rb").read(), method="PUT",
                                 headers={"Content-Type": "video/mp4", "Content-Length": str(size), "Content-Range": f"bytes 0-{size - 1}/{size}"})
    try: urllib.request.urlopen(put, timeout=300).read()
    except urllib.error.URLError as e:
        record(D, status="upload_failed", via="api", mode=mode, publish_id=init["publish_id"]); print(f"TikTok upload failed: {e}", file=sys.stderr); sys.exit(4)
    done = "SEND_TO_USER_INBOX" if mode == "inbox" else "PUBLISH_COMPLETE"
    st = {}
    for _ in range(40):
        time.sleep(POLL)
        try: st = api("/v2/post/publish/status/fetch/", {"publish_id": init["publish_id"]}, tok=tok)["data"]
        except TikTokError as e: st = {"status": "UNKNOWN", "fail_reason": e.code}; continue
        if st.get("status") in (done, "PUBLISH_COMPLETE", "FAILED"): break
    status = st.get("status", "UNKNOWN")
    j = record(D, status=status.lower(), via="api", mode=mode, privacy=privacy if mode == "direct" else "inbox (owner posts)",
               publish_id=init["publish_id"], fail_reason=st.get("fail_reason"),
               ids=st.get("publicaly_available_post_id") or st.get("publicly_available_post_id"), posted_at=int(time.time()))
    print(json.dumps(j))
    if status in (done, "PUBLISH_COMPLETE"): sys.exit(0)
    sys.exit(4 if status == "FAILED" else 5)
if __name__ == "__main__": main()
