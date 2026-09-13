-- The spoken script is stored with the brief so the app can read it with the device voice when there is
-- no MP3 (ElevenLabs quota exhausted or key gone), and so the 10-minute narrate sweep never re-spends a
-- model call composing a script it already has. daily-brief clears it with audio_path when the text changes.
alter table public.daily_briefs add column if not exists script text;
