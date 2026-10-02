# TikTok (@assetlyapp): every Short is posted there too (owner, 2026-10-01; API-first since v1.4.0)

Owner, 10/2: "you keep failing uploading videos on tiktok. make sure you can update tiktok too as you do in Youtube."
The Chrome path is broken: TikTok Studio's uploader ignores a file set by automation (no upload request is ever sent;
verified in several tabs on 10/2). The reliable path is the **TikTok Content Posting API**, the same shape as YouTube:
a one-time OAuth sign-in by the owner, then every `--upload` run posts by itself.

## What the run does
- `scripts/tiktok_pack.py <delivery> <date>` (every non-test run): `tiktok.mp4` (< 10 MB, SSIM >= 0.99 against the YouTube
  upload), `tiktok-caption.txt` (the hook title, the description, "Search Assetly on the App Store.", 3-5 hashtags: up to
  three companies + #stocks + #Assetly, never #fyp / #viral), `tiktok.json` (status + the settings the post must carry).
- With `--upload`, right after the YouTube upload (and even when YouTube failed): `app/scripts/tiktok/post.py <delivery>`.
  - Refreshes the token, asks TikTok which privacy levels the creator has, then **Direct Post** (`video.publish`): caption =
    `tiktok-caption.txt`, Everyone when the app is audited (else SELF_ONLY), AI-generated label on (`is_aigc`), "Your
    brand" on (`brand_organic_toggle`), cover = frame 0 (the headline cover). One-chunk FILE_UPLOAD, then polls the status.
  - **Before the app passes TikTok's audit** TikTok refuses Direct Post to a public account
    (`unaudited_client_can_only_post_to_private_accounts`). post.py then sends the video to the owner's **TikTok inbox**
    (`video.upload`): a notification in the TikTok app opens the draft; the owner pastes the caption from
    `tiktok-caption.txt`, turns on the AI-generated label and "Your brand", picks Everyone and taps Post. That is the
    TikTok twin of "YouTube uploads private, the owner publishes". `TIKTOK_MODE=direct|inbox` forces one path.
  - `tiktok.json` records status, mode, privacy, publish_id; a Short whose `tiktok.json` says posted / in the inbox is
    never posted again.
- Exit codes run.sh acts on: 0 posted or in the inbox (logged); 3 no token / token expired (queued + notice "run
  app/scripts/tiktok/auth.py once"); 4 refused before any upload (queued + notice); 5 uploaded but TikTok had not confirmed
  within 4 minutes (NOT queued: a second post would duplicate it; check TikTok Studio, the publish_id is in tiktok.json).
- The queue (`app/docs/marketing/shorts/tiktok-queue.txt`) is only for failures now.
- Self-test, offline (a local mock of the API; nothing leaves the machine): `python3 app/scripts/tiktok/selftest.py
  [<delivery dir>]` must print `ALL PASS` (PKCE, token file 600 + rotation, request order and bodies, the inbox fallback,
  every exit code, idempotence, no secret in any output).

## Owner setup (one time, ~15 min, then a 1-click sign-in about once a year)
Only the owner can do these (an account, an app, a sign-in). Claude never creates accounts or apps and never logs in.

1. **Developer account.** Go to https://developers.tiktok.com, "Log in" with the TikTok account that owns @assetlyapp
   (or a developer account in the same organization), accept the developer terms.
2. **Create the app.** "Manage apps" > "Connect an app" (individual, or the Assetly organization). App name "Assetly
   Shorts", category "Business" / "Finance", description "Posts Assetly's own daily market Shorts to @assetlyapp", icon =
   the Assetly app icon (`web/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`), Terms of Service and
   Privacy Policy URLs = Assetly's (the App Store listing's links). Platform: **Desktop**.
3. **Add products.** "Add products": **Login Kit** and **Content Posting API**. In Content Posting API turn on
   **Direct Post** (and keep Upload on).
4. **Scopes.** Under Scopes make sure these are added: `user.info.basic`, `video.publish`, `video.upload`.
5. **Redirect URI.** Login Kit > Desktop > Redirect URI: `http://127.0.0.1:53683/callback/` (exactly, with the trailing
   slash). Save.
6. **Keys into a private file.** From the app's page copy **Client key** and **Client secret** into
   `~/.private_keys/tiktok_client.json` as `{"client_key": "...", "client_secret": "..."}` and run
   `chmod 600 ~/.private_keys/tiktok_client.json`. (Or skip the file: auth.py then asks for both without echo.)
7. **Sandbox first (optional, recommended).** Under "Sandbox", create a sandbox and add @assetlyapp as a **target user**:
   the scopes work for that account at once, before any review.
8. **Sign in once.** In Terminal: `python3 ~/Documents/_Claude/AI/stockAnalysis/app/scripts/tiktok/auth.py`, then
   `open "$(cat /tmp/tiktok_auth_url.txt)"` in the Chrome profile logged in to @assetlyapp, click **Authorize**. It saves
   `~/.private_keys/tiktok_token.json` (chmod 600) and prints only the scope and how long the token lasts (365 days;
   post.py rotates it every run, so this is needed again only if a run reports exit 3).
9. **Check without posting:** `python3 app/scripts/tiktok/selftest.py` (offline). The next scheduled `--upload` run posts
   for real; until step 10 is done that lands in the TikTok inbox (one tap to post).
10. **Submit for review (so posts go public on their own).** App page > "Submit for review": describe the use ("an
    internal tool posting the company's own videos to its own account; no third-party users"), attach a short screen
    recording of a post landing on @assetlyapp, and, if asked, how the UI shows the creator's nickname, privacy choice,
    and the AI / branded-content disclosures (the run sets them; the owner reviews each Short before publishing on
    YouTube). Approval moves the app out of the unaudited limits; Direct Post then publishes as Everyone without the inbox step.

Limits worth knowing: ~6 requests a minute per token (a run makes ~5), a daily post cap per creator (TikTok does not
publish the number; six a day has not hit it), the access token lasts 24 h and is refreshed each run.

## Posting the queue from Chrome (fallback, interactive session only)
TikTok Studio's uploader ignored automated file input on 10/2, so this may not work; prefer fixing the API token. If it is
needed: the aiinsights.crypto Chrome profile ("Browser 1"), https://www.tiktok.com/tiktokstudio/upload, `file_upload`
`<delivery>/tiktok.mp4`; "automatic content checks?" -> Cancel; description = `tiktok-caption.txt`; Show more: AI-generated
content ON, Disclose post content ON -> Your brand; Who can see: Everyone; Post (by ref). Then write status "posted", url,
posted_at into `tiktok.json` and remove the line from `tiktok-queue.txt`. Claude never types credentials.

## Posted
| Date | Edition | URL |
|---|---|---|
| 2026-10-01 | preopen (v5) | https://www.tiktok.com/@assetlyapp/video/7691790101013220639 |
| 2026-10-01 | midday | https://www.tiktok.com/@assetlyapp/video/7691791021277072670 |
| 2026-10-01 | close | (posted Only me) |
