-- Earnings-call transcript bodies are third-party article text. They exist only as model input for
-- daily-brief, insights-sync, ask and warmup, all of which run with the service key. Nothing in the
-- client reads public.transcripts, so the anon/authenticated grants were pure exposure: with the anon
-- key and any session, PostgREST handed back the full verbatim article. Close it.
drop policy if exists "transcripts readable" on public.transcripts;
revoke all on public.transcripts from anon, authenticated;
-- service_role bypasses RLS; keep the explicit grant so the edge functions keep reading and writing.
grant select, insert, update, delete on public.transcripts to service_role;
