#!/usr/bin/env python3
"""TikTok package for a delivered Short (owner, 10/1: every Short goes to TikTok too).
   tiktok_pack.py <delivery dir> <YYYY-MM-DD>
Writes, next to the YouTube files:
  tiktok.mp4          the -upload.mp4 re-encoded under 10 MB (the Chrome uploader's per-file limit; SSIM >= 0.99 checked)
  tiktok-caption.txt  title (edition date) + the description + "Search Assetly on the App Store." + hashtags (no #Shorts)
  tiktok.json         {"status": "pending", settings the post must use}; the poster (API or Chrome) fills id/url/status
Never posts by itself."""
import json, os, re, subprocess, sys
from datetime import date
D, DATE = sys.argv[1], sys.argv[2]
src = next(os.path.join(D, f) for f in os.listdir(D) if f.endswith("-upload.mp4"))
out = os.path.join(D, "tiktok.mp4")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-maxrate", "3M",
                "-bufsize", "6M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], check=True)
size = os.path.getsize(out)
ssim = float(re.search(r"All:([0-9.]+)", subprocess.run(["ffmpeg", "-i", out, "-i", src, "-lavfi", "ssim", "-f", "null", "-"],
                                                        capture_output=True, text=True).stderr).group(1))
assert size < 10_000_000, f"tiktok.mp4 is {size} bytes (limit 10 MB)"
assert ssim >= 0.99, f"tiktok.mp4 SSIM {ssim} < 0.99"
m = json.load(open(os.path.join(D, "youtube-metadata.json")))
d = date.fromisoformat(DATE); tag = f"{d.strftime('%b')} {d.day}"
title = re.sub(r"\s*\|\s*[A-Z][a-z]{2} \d{1,2}$", "", m["title"])   # owner 10/1: hook only, no date
body = m["description"].split("\n\nAssetly on the App Store")[0]
first, _, rest = body.partition("\n")              # "Data as of ... ET" is a heading line: end it with a full stop
body = (first.rstrip(".") + ". " + rest).strip() if rest else first
# no "link in bio": the post must not promise a link the profile may not carry
tags = list(dict.fromkeys([h for h in m.get("hashtags", []) if h.lower() != "#shorts"] + ["#stocks", "#fintech", "#Assetly"]))
cap = f"{title}\n\n{body}\nSearch Assetly on the App Store.\n\n" + " ".join(tags)
assert len(cap) <= 2200, "caption over 2,200 characters"
open(os.path.join(D, "tiktok-caption.txt"), "w").write(cap)
tj = os.path.join(D, "tiktok.json")
if os.path.exists(tj) and json.load(open(tj)).get("status") in ("posted", "publish_complete"):
    print("already posted: tiktok.json kept"); sys.exit(0)
json.dump({"status": "pending", "account": "@assetlyapp", "video": "tiktok.mp4", "bytes": size, "ssim": round(ssim, 4),
           "settings": {"who_can_see": "Only me", "ai_generated_label": True, "disclose_post_content": "Your brand",
                        "comments": True, "reuse": True, "automatic_checks_prompt": "Cancel (do not change account settings)"}},
          open(os.path.join(D, "tiktok.json"), "w"), indent=1)
print(f"tiktok package: {size / 1e6:.1f} MB, SSIM {ssim:.4f}, caption {len(cap)} chars")
