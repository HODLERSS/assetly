-- Audio briefs: ElevenLabs narration stored per user per day.
alter table public.daily_briefs add column if not exists audio_path text;
insert into storage.buckets (id, name, public) values ('briefs-audio', 'briefs-audio', false)
on conflict (id) do nothing;
drop policy if exists "own brief audio" on storage.objects;
create policy "own brief audio" on storage.objects for select to authenticated
  using (bucket_id = 'briefs-audio' and (storage.foldername(name))[1] = auth.uid()::text);
