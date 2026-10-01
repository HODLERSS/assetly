# TikTok (@assetlyapp): every Short is posted there too (owner, 2026-10-01)

## What the run does
- `scripts/tiktok_pack.py <delivery> <date>` (every non-test run): `tiktok.mp4` (< 10 MB, SSIM >= 0.99 against the YouTube
  upload), `tiktok-caption.txt` (title with the edition date, description, "Search Assetly on the App Store.", hashtags
  without #Shorts plus #stocks #fintech #Assetly), `tiktok.json` (status + required settings). A posted record is kept.
- Caption (v1.0.7): the title is the first line (the hook TikTok shows), then the description, then 3-5 hashtags: up to
  three companies + #stocks + #Assetly (no #fyp / #viral). Cover: the first frame (the headline cover, `thumbnail.png`):
  in the Chrome flow leave TikTok's default cover or pick 0:00 under "Edit cover".
- With `--upload`: `app/scripts/tiktok/post.py <delivery>` posts via the TikTok Content Posting API when
  `~/.private_keys/tiktok_token.json` exists. It does not exist yet (needs a TikTok developer app with `video.publish`;
  Claude cannot create accounts or apps). Without it the delivery joins `app/docs/marketing/shorts/tiktok-queue.txt` and
  the owner gets a macOS notice: "ask Claude to post the TikTok queue".
- launchd runs headless, so the Chrome path below needs an interactive Claude session.

## Posting the queue from Chrome (what was done 10/1, ~2 min per video)
Chrome profile: the aiinsights.crypto one (Claude-in-Chrome "Browser 1"), logged in to TikTok as @assetlyapp. Claude never
types credentials: if TikTok shows the login page, the owner logs in.
1. Open https://www.tiktok.com/tiktokstudio/upload; `find` the file input; `file_upload` `<delivery>/tiktok.mp4`.
2. "Turn on automatic content checks?" prompt: **Cancel** (an account setting; not ours to change). Close tips ("Got it").
3. Description: click it, cmd+A, Backspace, type `tiktok-caption.txt` (the body, then the hashtag line), Escape to close the
   hashtag picker. Verify with JS: `document.querySelector('[contenteditable="true"]').innerText`.
4. Show more: **AI-generated content ON** (synthetic voices; confirm "Turn on"), **Disclose post content ON -> Your brand**
   (Assetly promoting itself). Who can see: **Only me** (owner, 10/1 afternoon: the owner reviews each post and switches it to Everyone by hand for about a week, through ~Oct 8, then the default is revisited). Set the "Who can see this post" dropdown to Only me before Post. Comments and reuse on.
5. Verify the dropdown reads **Only me**. `find` "Post" and click it by ref (a coordinate click after the page scrolls misses). TikTok shows "Content under review"
   / "Only me" for a few minutes, then Everyone.
6. Studio > Posts: read the new `/@assetlyapp/video/<id>` link; write status "posted", url, posted_at into `tiktok.json`; remove
   the line from `tiktok-queue.txt`.

## Posted
| Date | Edition | URL |
|---|---|---|
| 2026-10-01 | preopen (v5) | https://www.tiktok.com/@assetlyapp/video/7691790101013220639 |
| 2026-10-01 | midday | https://www.tiktok.com/@assetlyapp/video/7691791021277072670 |
| 2026-10-01 | close | (posted Only me) |
