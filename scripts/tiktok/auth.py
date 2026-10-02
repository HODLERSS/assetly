#!/usr/bin/env python3
"""One-time TikTok sign-in for the Shorts poster (Login Kit for Desktop, PKCE, loopback redirect), the twin of youtube/auth.py.
   python3 auth.py   -> writes the TikTok authorize URL to /tmp/tiktok_auth_url.txt; open it in the Chrome profile logged in
                        to @assetlyapp and click Authorize. Saves ~/.private_keys/tiktok_token.json (chmod 600).
The app's client key + secret come from ~/.private_keys/tiktok_client.json {"client_key","client_secret"} (the owner pastes
them there from developers.tiktok.com), else they are asked for without echo. Never prints secrets.
Redirect URI to register on the app (Login Kit > Desktop): http://127.0.0.1:53683/callback/
Scopes: user.info.basic, video.publish, video.upload (TIKTOK_SCOPES overrides). The access token lasts 24 h and post.py
refreshes it each run; the refresh token lasts 365 days and rotates on use, so this normally runs once a year."""
import getpass, hashlib, http.server, json, os, secrets, time, urllib.parse, urllib.request
KEYS = os.path.expanduser("~/.private_keys")
OUT = os.environ.get("TIKTOK_TOKEN_FILE", f"{KEYS}/tiktok_token.json")
PORT = int(os.environ.get("TIKTOK_AUTH_PORT", "53683"))
REDIRECT = f"http://127.0.0.1:{PORT}/callback/"
SCOPES = os.environ.get("TIKTOK_SCOPES", "user.info.basic,video.publish,video.upload")
cf = f"{KEYS}/tiktok_client.json"
if os.path.exists(cf): c = json.load(open(cf))
else: c = {"client_key": getpass.getpass("TikTok client key: ").strip(), "client_secret": getpass.getpass("TikTok client secret: ").strip()}
# TikTok's desktop PKCE: the challenge is the HEX sha256 of the verifier (not base64url as in RFC 7636)
verifier = secrets.token_urlsafe(64)[:96]
challenge = hashlib.sha256(verifier.encode()).hexdigest()
state = secrets.token_urlsafe(16)
url = "https://www.tiktok.com/v2/auth/authorize/?" + urllib.parse.urlencode({
    "client_key": c["client_key"], "response_type": "code", "scope": SCOPES, "redirect_uri": REDIRECT, "state": state,
    "code_challenge": challenge, "code_challenge_method": "S256"})
open("/tmp/tiktok_auth_url.txt", "w").write(url); os.chmod("/tmp/tiktok_auth_url.txt", 0o600)
print("AUTH_URL_WRITTEN /tmp/tiktok_auth_url.txt  (open it in the @assetlyapp Chrome profile: open \"$(cat /tmp/tiktok_auth_url.txt)\")", flush=True)
got = {}
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        if q.get("state") == state and "code" in q: got["code"] = q["code"]
        elif q.get("state") == state and "error" in q: got["error"] = q.get("error_description") or q["error"]
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
        self.wfile.write(b"<h3>Assetly Shorts TikTok poster authorized. You can close this tab.</h3>" if "code" in got else b"<h3>Not authorized.</h3>")
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", PORT), H)
while not got: srv.handle_request()
if "error" in got: raise SystemExit(f"TikTok declined the authorization: {got['error']}")
body = urllib.parse.urlencode({"client_key": c["client_key"], "client_secret": c["client_secret"], "code": got["code"],
    "grant_type": "authorization_code", "redirect_uri": REDIRECT, "code_verifier": verifier}).encode()
req = urllib.request.Request(os.environ.get("TIKTOK_API_BASE", "https://open.tiktokapis.com") + "/v2/oauth/token/", body,
                             headers={"Content-Type": "application/x-www-form-urlencoded"})
tok = json.loads(urllib.request.urlopen(req, timeout=60).read())
if "refresh_token" not in tok: raise SystemExit(f"no refresh token returned ({tok.get('error', '?')}: {tok.get('error_description', '')})")
now = int(time.time())
rec = {"client_key": c["client_key"], "client_secret": c["client_secret"], "refresh_token": tok["refresh_token"],
       "refresh_expires_at": now + int(tok.get("refresh_expires_in", 0)), "open_id": tok.get("open_id"), "scope": tok.get("scope")}
os.makedirs(KEYS, exist_ok=True)
fd = os.open(OUT + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: json.dump(rec, f)
os.replace(OUT + ".tmp", OUT); os.chmod(OUT, 0o600)
print("saved", OUT, "scope:", tok.get("scope"), "refresh token valid for", int(tok.get("refresh_expires_in", 0)) // 86400, "days")
