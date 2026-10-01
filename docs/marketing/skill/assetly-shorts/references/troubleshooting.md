# Traps already hit

- **Keys.** Service key: `npx --no-install supabase projects api-keys --project-ref hhdpthrfmsdmxdrfckxq -o json` (the CLI
  must be logged in) into `<work>/srk` (600). MARA / ElevenLabs / internal token: Vault `get_secret` with that key. Never
  echo them; `lib.vault()` writes 600 files in the work dir.
- **Yahoo 429 from this Mac.** The chart API rate-limits curl from this IP. v1.0 does not call Yahoo directly: the two
  price feeds are the CNBC quote service and the Nasdaq quote API; the app's own `prices` table (Yahoo via Supabase)
  is the second feed for ES=F / NQ=F / ^GSPC / ^VIX.
- **MARA 502 "routing broker forward failed"** and a reasoning model that writes two JSON objects: `lib.llm()` retries,
  then falls back to OpenRouter, and parses the first JSON object only (`raw_decode`).
- **The judge is strict on purpose.** A sentiment only one publisher states is dropped; the repair round asks the model to
  pick a reaction two publishers state. Fewer than 3 surviving items refuses the run: re-run research later (more
  coverage lands within an hour of the close) or take the refusal.
- **Out-of-window briefs.** The app writes an edition only inside its ET window (morning 8:00-9:30, midday 9:30-16:00,
  close after 16:00). A `--test` pre-open at night passes `--out-of-window`, which sends the Vault internal token as
  `x-internal-token` with `outOfWindow: true`.
- **Simulator collisions.** The skill records on its own simulator ("ShortsSkill iPhone 17 Pro",
  43B3BBEF-E13F-47E8-ADFA-2E8FB829E217; override with `SHORTS_UDID`) and its own result bundle / derived data, so a
  parallel agent's tests cannot land in the take. `record-hero.sh` writes `Hero.xctestplan` into the project: do not
  run two recordings at the same moment.
- **Two "Send" buttons** (the composer's and the keyboard's): the UI test taps the web view's first match.
- **The clock.** UI-test marks are wall-clock; the display recording's t=0 is the recorder's "Recording started" stamp
  (perl-stamped in `disp.reclog`), refined by fitting each `tap_*` mark to the screen change it causes (`marks.json`
  shows the fit error).
- **Charts load ~3 s** after a position opens (a grey skeleton). Beats start 0.5 s after `pos_<SYM>_chart` (5 s after
  the tap); Q29 catches a skeleton that still slips through.
- **Seeding takes ~5 min** (insights in threes ~3 min, the brief ~1.5 min). For the close edition, see schedule.md.
- **Storyline refused on ordinary words (10/1 7:32 preopen, exit 1 after 31 min).** "IBM" and "NASA" were rejected as
  tickers, "cheer / credit / liked / purchase" as unsourced words, and the verified-wording fallback ran over budget with
  no timing word. Now: only a ticker of a candidate/held company is refused (`SPOKEN_CAPS` in storyline.py = narrate/ear.ts
  `SPOKEN_CAPS`, the earAudit allowlist; add a name to both), the source check covers named entities and specific nouns,
  every problem carries a "-> do this" instruction, and the fallback trims verified clauses to fit and leads with "Before
  the bell," / "At midday," / "At the close,". If the voice still stumbles on a new all-caps name, add it to both lists.
- **Pre-open Ask "today".** The app's Ask answer labels the previous session "today" before the open; retakes never
  cleared it (three takes, ~11 min on 10/1), so it is now noted in ask-check.json, not retaken. The real fix is in the
  app's Ask prompt. Jargon in the answer still earns a retake.
- **The Ask beat showed "Still thinking..." (10/1 7:32 preopen, uploaded).** The UI test took the dots ("Thinking") going
  away as the answer, but a slow answer swaps them for "Still thinking...", so the 7 s hold ended before the answer drew
  (the answer text in the attachment was read later, at teardown). testGshort now waits until neither shows and the
  answer's "Not financial advice" foot is on screen (90 s), and logs every text's frame; record.py keeps the visible
  answer lines with their boxes, and facts --ask retakes when none is visible. Q32 reads the final frames.
- **OCR.** `scripts/ocr.swift` (Vision, accurate) is compiled once to `/tmp/assetly-shorts/ocr-<hash>`; ~0.3 s an image.
  The status-bar clock reads as "9", "41": matching only uses figures with % or $ for spoken lines.
- **The Ask failed on camera (10/1 midday).** The app answered "Couldn't finish that answer. Please ask again in a
  moment." and the old check passed it (no figures to fail). facts --ask now retakes on the failure message.
- **Home drifts while the take records (10/1 midday).** Facts at 10:2x had the day at $4,368, Home in the take showed
  +$3,965; with "spoken = on screen" AND "spoken = verified", nothing could pass. Home figures within the live tolerance
  of a cross-checked figure now count as verified.
