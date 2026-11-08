-- 0005: timer notifications. Web Push subscriptions per device, notification settings, and a database
-- hook (pg_net) that tells the Worker whenever a timer starts or stops, so every device can show or
-- clear its "timer running" notification even when the app is closed.

-- ------------------------------------------------------------------ settings
alter table public.settings add column if not exists notify_enabled boolean not null default true;
alter table public.settings add column if not exists reminder_hours smallint not null default 2
  check (reminder_hours in (0, 1, 2, 4));

-- reminders: when the last "still working?" push went out for this session
alter table public.sessions add column if not exists reminded_at timestamptz;

-- ------------------------------------------------------------------ push subscriptions (one per device/browser)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- sha-256 of a per-device secret: lets the notification's Stop button work without a sign-in token
  device_secret_hash text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
alter table public.push_subscriptions enable row level security;
drop policy if exists owner_all on public.push_subscriptions;
create policy owner_all on public.push_subscriptions for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;
grant select, delete on public.push_subscriptions to authenticated; -- writes go through the Worker

-- ------------------------------------------------------------------ hook: sessions -> Worker
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.hook_config (id int primary key default 1 check (id = 1), url text not null, secret text not null);
revoke all on private.hook_config from public, anon, authenticated;

create or replace function private.notify_session_change() returns trigger
language plpgsql security definer set search_path = public, private, extensions as $$
declare cfg private.hook_config; ev text; ttl text;
begin
  select * into cfg from private.hook_config where id = 1;
  if cfg.url is null then return null; end if;
  if tg_op = 'INSERT' and new.ended_at is null then ev := 'start';
  elsif tg_op = 'UPDATE' and old.ended_at is null and new.ended_at is not null then ev := 'stop';
  elsif tg_op = 'DELETE' and old.ended_at is null then ev := 'stop';
  else return null;
  end if;
  select title into ttl from items where id = coalesce(new.item_id, old.item_id);
  perform net.http_post(
    url := cfg.url,
    body := jsonb_build_object('event', ev, 'owner_id', coalesce(new.owner_id, old.owner_id), 'session_id', coalesce(new.id, old.id),
                               'item_id', coalesce(new.item_id, old.item_id), 'title', coalesce(ttl, ''), 'started_at', coalesce(new.started_at, old.started_at)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Hook-Secret', cfg.secret)
  );
  return null;
end $$;
drop trigger if exists sessions_notify on public.sessions;
create trigger sessions_notify after insert or update of ended_at or delete on public.sessions
  for each row execute function private.notify_session_change();

notify pgrst, 'reload schema';
