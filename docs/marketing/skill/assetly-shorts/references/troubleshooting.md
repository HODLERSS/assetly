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
