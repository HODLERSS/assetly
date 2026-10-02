#!/usr/bin/env python3
"""Dry-run self-test of auth.py + post.py against a local mock of the TikTok API. Nothing leaves this machine.
   python3 selftest.py [<delivery dir with tiktok.mp4 + tiktok-caption.txt>]   (default: a 64 KB fake video)
Checks: the request sequence and bodies (PKCE hex challenge, refresh, creator_info, init, one-chunk PUT with Content-Range,
status poll), the auto fallback to the inbox for an unaudited app, every exit code run.sh relies on (0 / 3 / 4 / 5), the
token file chmod 600 + rotation, idempotence (a posted Short is never posted twice), and that no secret reaches stdout/stderr."""
import hashlib, http.server, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
SECRET, REFRESH, ACCESS = "SECRET-cs-123", "REFRESH-rt-1", "ACCESS-at-1"
S = {"scenario": "public", "log": [], "polls": 0}
class Mock(http.server.BaseHTTPRequestHandler):
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); raw = self.rfile.read(n).decode()
        body = dict(urllib.parse.parse_qsl(raw)) if "urlencoded" in self.headers.get("Content-Type", "") else json.loads(raw or "{}")
        S["log"].append(("POST", self.path, body, self.headers.get("Authorization"))); sc = S["scenario"]
        ok = {"error": {"code": "ok", "message": ""}}
        if self.path == "/v2/oauth/token/":
            if sc == "badrefresh" and body.get("grant_type") == "refresh_token": return self._send(400, {"error": "invalid_grant", "error_description": "expired"})
            if body.get("grant_type") == "authorization_code":
                assert hashlib.sha256(body["code_verifier"].encode()).hexdigest() == S["challenge"], "PKCE verifier does not match the hex challenge"
                assert body["code"] == "CODE-1" and body["client_secret"] == SECRET
            return self._send(200, {"access_token": ACCESS, "refresh_token": "REFRESH-rt-2", "expires_in": 86400, "refresh_expires_in": 31536000,
                                    "open_id": "oid", "scope": "user.info.basic,video.publish" + ("" if sc == "noupload" else ",video.upload")})
        if self.path == "/v2/post/publish/creator_info/query/":
            opts = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"] if sc != "selfonly" else ["SELF_ONLY"]
            return self._send(200, {"data": {"privacy_level_options": opts, "max_video_post_duration_sec": 600}, **ok})
        if self.path == "/v2/post/publish/video/init/":
            if sc in ("unaudited", "noupload"): return self._send(403, {"error": {"code": "unaudited_client_can_only_post_to_private_accounts", "message": "x"}})
            return self._send(200, {"data": {"publish_id": "p_direct", "upload_url": f"http://127.0.0.1:{PORT}/upload/direct"}, **ok})
        if self.path == "/v2/post/publish/inbox/video/init/":
            return self._send(200, {"data": {"publish_id": "p_inbox", "upload_url": f"http://127.0.0.1:{PORT}/upload/inbox"}, **ok})
        if self.path == "/v2/post/publish/status/fetch/":
            S["polls"] += 1
            if sc == "stuck": return self._send(200, {"data": {"status": "PROCESSING_UPLOAD"}, **ok})
            if S["polls"] < 2: return self._send(200, {"data": {"status": "PROCESSING_UPLOAD"}, **ok})
            st = "SEND_TO_USER_INBOX" if body["publish_id"] == "p_inbox" else "PUBLISH_COMPLETE"
            return self._send(200, {"data": {"status": st, "publicaly_available_post_id": [7700000000000000001] if st == "PUBLISH_COMPLETE" else []}, **ok})
        self._send(404, {"error": {"code": "not_found"}})
    def do_PUT(self):
        n = int(self.headers["Content-Length"]); data = self.rfile.read(n)
        S["log"].append(("PUT", self.path, {"len": n, "range": self.headers.get("Content-Range"), "type": self.headers.get("Content-Type")}, None))
        S["uploaded"] = data; self.send_response(201); self.end_headers()
    def do_GET(self): self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Mock); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(cond, what):
    print(("PASS " if cond else "FAIL ") + what); cond or fails.append(what)
tmp = tempfile.mkdtemp(prefix="tiktok-selftest-"); TOK = os.path.join(tmp, "tiktok_token.json")
env = dict(os.environ, TIKTOK_API_BASE=f"http://127.0.0.1:{PORT}", TIKTOK_TOKEN_FILE=TOK, TIKTOK_POLL_S="0.05", HOME=tmp)
def leaks(*outs): return [s for s in (SECRET, REFRESH, "REFRESH-rt-2", ACCESS) if any(s in o for o in outs)]

# ---- auth.py: PKCE + loopback + token file
os.makedirs(os.path.join(tmp, ".private_keys")); json.dump({"client_key": "ck_test", "client_secret": SECRET}, open(os.path.join(tmp, ".private_keys/tiktok_client.json"), "w"))
aport = 53699; ae = dict(env, TIKTOK_AUTH_PORT=str(aport))
try: os.remove("/tmp/tiktok_auth_url.txt")
except FileNotFoundError: pass
p = subprocess.Popen([sys.executable, os.path.join(HERE, "auth.py")], env=ae, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
for _ in range(100):
    if os.path.exists("/tmp/tiktok_auth_url.txt") and os.path.getsize("/tmp/tiktok_auth_url.txt"): break
    time.sleep(0.05)
q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(open("/tmp/tiktok_auth_url.txt").read()).query)); S["challenge"] = q["code_challenge"]
check(q["code_challenge_method"] == "S256" and len(q["code_challenge"]) == 64 and all(ch in "0123456789abcdef" for ch in q["code_challenge"]), "auth: PKCE challenge is hex sha256 (TikTok desktop)")
check(q["redirect_uri"] == f"http://127.0.0.1:{aport}/callback/" and "video.publish" in q["scope"] and "video.upload" in q["scope"], "auth: redirect URI + scopes")
urllib.request.urlopen(f"http://127.0.0.1:{aport}/callback/?" + urllib.parse.urlencode({"code": "CODE-1", "state": q["state"]})).read()
out, err = p.communicate(timeout=30)
check(p.returncode == 0, f"auth: exit 0 ({err.strip()[-200:]})")
check(oct(os.stat(TOK).st_mode & 0o777) == "0o600", "auth: token file chmod 600")
tk = json.load(open(TOK)); check(tk["refresh_token"] == "REFRESH-rt-2" and tk["client_secret"] == SECRET, "auth: token file holds client + refresh token")
check(not leaks(out, err, open("/tmp/tiktok_auth_url.txt").read()), "auth: no secret printed or in the URL file")
os.remove("/tmp/tiktok_auth_url.txt")

# ---- post.py scenarios
src = sys.argv[1] if len(sys.argv) > 1 else None
def delivery():
    d = tempfile.mkdtemp(dir=tmp)
    if src: shutil.copy(os.path.join(src, "tiktok.mp4"), d); shutil.copy(os.path.join(src, "tiktok-caption.txt"), d)
    else: open(os.path.join(d, "tiktok.mp4"), "wb").write(os.urandom(65536)); open(os.path.join(d, "tiktok-caption.txt"), "w").write("Hook title\n\nBody.\n\n#NVDA #stocks #Assetly")
    json.dump({"status": "pending", "account": "@assetlyapp"}, open(os.path.join(d, "tiktok.json"), "w")); return d
def post(sc, d=None, extra=None):
    S.update(scenario=sc, log=[], polls=0); S.pop("uploaded", None); d = d or delivery()
    json.dump({"client_key": "ck_test", "client_secret": SECRET, "refresh_token": REFRESH, "scope": "user.info.basic,video.publish,video.upload"}, open(TOK, "w")); os.chmod(TOK, 0o600)
    r = subprocess.run([sys.executable, os.path.join(HERE, "post.py"), d], env=dict(env, **(extra or {})), capture_output=True, text=True, timeout=60)
    return r, d, json.load(open(os.path.join(d, "tiktok.json"))), [(m, pth) for m, pth, *_ in S["log"]]

r, d, j, seq = post("public")
check(r.returncode == 0 and j["status"] == "publish_complete" and j["mode"] == "direct" and j["privacy"] == "PUBLIC_TO_EVERYONE", f"direct public post: exit {r.returncode}, {j.get('status')}")
check(seq[:4] == [("POST", "/v2/oauth/token/"), ("POST", "/v2/post/publish/creator_info/query/"), ("POST", "/v2/post/publish/video/init/"), ("PUT", "/upload/direct")], "direct: request order")
init = next(b for m, pth, b, a in S["log"] if pth == "/v2/post/publish/video/init/")
size = os.path.getsize(os.path.join(d, "tiktok.mp4")); put = next(b for m, pth, b, a in S["log"] if m == "PUT")
check(init["post_info"]["is_aigc"] and init["post_info"]["brand_organic_toggle"] and init["post_info"]["video_cover_timestamp_ms"] == 0, "direct: AI label + Your brand + frame-0 cover")
check(init["source_info"] == {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": size, "total_chunk_count": 1}, "direct: one-chunk FILE_UPLOAD")
check(put == {"len": size, "range": f"bytes 0-{size - 1}/{size}", "type": "video/mp4"} and S["uploaded"] == open(os.path.join(d, "tiktok.mp4"), "rb").read(), "direct: PUT carries the whole file + Content-Range")
check(init["post_info"]["title"] == open(os.path.join(d, "tiktok-caption.txt")).read(), "direct: caption = tiktok-caption.txt")
check(all(a == f"Bearer {ACCESS}" for m, pth, b, a in S["log"] if pth.startswith("/v2/post")), "direct: bearer = refreshed access token")
check(json.load(open(TOK))["refresh_token"] == "REFRESH-rt-2" and oct(os.stat(TOK).st_mode & 0o777) == "0o600", "refresh token rotated, file still 600")
check(not leaks(r.stdout, r.stderr), "direct: no secret printed")
r2, _, _, seq2 = post("public", d)
check(r2.returncode == 0 and seq2 == [], "idempotent: an already-posted Short is not posted again")
r, d, j, seq = post("selfonly")
check(r.returncode == 0 and j["privacy"] == "SELF_ONLY", "creator cannot post public: SELF_ONLY")
r, d, j, seq = post("unaudited")
check(r.returncode == 0 and j["mode"] == "inbox" and j["status"] == "send_to_user_inbox" and ("PUT", "/upload/inbox") in seq, "unaudited app: falls back to the creator's inbox")
r, d, j, seq = post("noupload")
check(r.returncode == 4 and j["status"] == "refused" and not any(m == "PUT" for m, _ in seq), "no video.upload scope: exit 4, nothing uploaded")
r, d, j, seq = post("unaudited", extra={"TIKTOK_MODE": "direct"})
check(r.returncode == 4 and j["error"] == "unaudited_client_can_only_post_to_private_accounts", "TIKTOK_MODE=direct: no fallback, exit 4")
r, d, j, seq = post("stuck")
check(r.returncode == 5 and j["status"] == "processing_upload", "uploaded but unconfirmed: exit 5 (run.sh must not re-post)")
r, d, j, seq = post("badrefresh")
check(r.returncode == 3 and "auth.py" in r.stderr and not leaks(r.stdout, r.stderr), "expired refresh token: exit 3 + the auth.py fix")
os.remove(TOK); r = subprocess.run([sys.executable, os.path.join(HERE, "post.py"), delivery()], env=env, capture_output=True, text=True)
check(r.returncode == 3, "no token file: exit 3 (queue)")
shutil.rmtree(tmp, ignore_errors=True); srv.shutdown()
print(f"\n{'ALL PASS' if not fails else f'{len(fails)} FAILED'}"); sys.exit(1 if fails else 0)
