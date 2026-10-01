#!/usr/bin/env python3
"""Post a Short to TikTok (@assetlyapp) with the Content Posting API (Direct Post, FILE_UPLOAD).
   python3 post.py <delivery dir>       reads tiktok.mp4, tiktok-caption.txt; updates tiktok.json
Needs ~/.private_keys/tiktok_token.json {"client_key","client_secret","refresh_token"} from a TikTok developer app with
the video.publish scope (not set up yet: exit 3 so the run queues the post for Chrome instead). An unaudited app may only
post SELF_ONLY; the post then needs the owner to switch it to Everyone. Never prints secrets.
Labels: is_aigc true (synthetic voices), brand_organic_toggle true (Assetly promotes itself)."""
import json, os, sys, time, urllib.parse, urllib.request
K = os.path.expanduser("~/.private_keys/tiktok_token.json")
def api(url, body=None, tok=None, form=False):
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    if form: data = urllib.parse.urlencode(body).encode(); h["Content-Type"] = "application/x-www-form-urlencoded"
    else: data = json.dumps(body or {}).encode(); h["Content-Type"] = "application/json; charset=UTF-8"
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method="POST"), timeout=60).read())
def main():
    D = sys.argv[1]
    if not os.path.exists(K): print("no TikTok API token (~/.private_keys/tiktok_token.json): queue for Chrome", file=sys.stderr); sys.exit(3)
    k = json.load(open(K))
    t = api("https://open.tiktokapis.com/v2/oauth/token/", {"client_key": k["client_key"], "client_secret": k["client_secret"],
            "grant_type": "refresh_token", "refresh_token": k["refresh_token"]}, form=True)
    if t.get("refresh_token") and t["refresh_token"] != k["refresh_token"]:
        k["refresh_token"] = t["refresh_token"]; json.dump(k, open(K, "w")); os.chmod(K, 0o600)
    tok = t["access_token"]
    ci = api("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", tok=tok)["data"]
    opts = ci.get("privacy_level_options", [])
    # owner, 10/1 evening: TikTok posts are public (Everyone); an unaudited app falls back to SELF_ONLY
    privacy = os.environ.get("TIKTOK_PRIVACY", "PUBLIC_TO_EVERYONE")
    if privacy not in opts: privacy = "SELF_ONLY"
    vid = os.path.join(D, "tiktok.mp4"); size = os.path.getsize(vid)
    cap = open(os.path.join(D, "tiktok-caption.txt")).read()
    init = api("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        "post_info": {"title": cap, "privacy_level": privacy, "disable_comment": False, "disable_duet": False, "disable_stitch": False,
                      "is_aigc": True, "brand_organic_toggle": True, "brand_content_toggle": False,
                      "video_cover_timestamp_ms": 0},   # the cover = frame 0, the headline cover (thumbnail.png)
        "source_info": {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": size, "total_chunk_count": 1}}, tok=tok)["data"]
    put = urllib.request.Request(init["upload_url"], data=open(vid, "rb").read(), method="PUT",
                                 headers={"Content-Type": "video/mp4", "Content-Length": str(size), "Content-Range": f"bytes 0-{size - 1}/{size}"})
    urllib.request.urlopen(put, timeout=300).read()
    st = {}
    for _ in range(40):
        time.sleep(6)
        st = api("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {"publish_id": init["publish_id"]}, tok=tok)["data"]
        if st.get("status") in ("PUBLISH_COMPLETE", "FAILED"): break
    j = json.load(open(os.path.join(D, "tiktok.json")))
    j.update(status=st.get("status", "UNKNOWN").lower(), via="api", privacy=privacy, publish_id=init["publish_id"],
             ids=st.get("publicaly_available_post_id") or st.get("publicly_available_post_id"))
    json.dump(j, open(os.path.join(D, "tiktok.json"), "w"), indent=1); print(json.dumps(j))
    sys.exit(0 if st.get("status") == "PUBLISH_COMPLETE" else 4)
if __name__ == "__main__": main()
