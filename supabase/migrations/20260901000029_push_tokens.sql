-- Push tokens for the native shell. One row per device; a user can have several.
-- The brief already knows when it lands, so the notification is a push, not a poll.
create table if not exists public.push_tokens (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  token         text not null,
  platform      text not null default 'ios',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

-- A device registers and refreshes its OWN token; nothing else can read them.
-- Sending is done by the service role, which bypasses RLS.
drop policy if exists push_tokens_own_select on public.push_tokens;
create policy push_tokens_own_select on public.push_tokens
  for select using (auth.uid() = user_id);

drop policy if exists push_tokens_own_insert on public.push_tokens;
create policy push_tokens_own_insert on public.push_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists push_tokens_own_update on public.push_tokens;
create policy push_tokens_own_update on public.push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_tokens_own_delete on public.push_tokens;
create policy push_tokens_own_delete on public.push_tokens
  for delete using (auth.uid() = user_id);
