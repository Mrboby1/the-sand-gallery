-- 0002: offline-friendly timers, race-free defaults, a cheap health probe.

-- Timers can be started/stopped while offline; the queued call carries the time it happened (p_at).
-- The time is clamped to "now" so a wrong device clock cannot create future sessions.
drop function if exists public.start_timer(uuid, uuid);
create or replace function public.start_timer(p_item uuid, p_session uuid default gen_random_uuid(), p_at timestamptz default null)
returns public.sessions
language plpgsql security invoker set search_path = public as $$
declare s sessions; v_at timestamptz := least(coalesce(p_at, now()), now());
begin
  if not exists (select 1 from items where id = p_item) then raise exception 'item not found'; end if;
  -- idempotent: a retried call for the same session returns it unchanged
  select * into s from sessions where id = p_session;
  if s.id is not null then return s; end if;
  update sessions set ended_at = greatest(started_at, v_at) where owner_id = auth.uid() and ended_at is null;
  insert into sessions (id, item_id, started_at) values (p_session, p_item, v_at) returning * into s;
  return s;
end $$;

drop function if exists public.stop_timer();
create or replace function public.stop_timer(p_at timestamptz default null) returns public.sessions
language plpgsql security invoker set search_path = public as $$
declare s sessions; v_at timestamptz := least(coalesce(p_at, now()), now());
begin
  update sessions set ended_at = greatest(started_at, v_at)
   where owner_id = auth.uid() and ended_at is null returning * into s;
  return s;
end $$;

grant execute on function public.start_timer(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.stop_timer(timestamptz) to authenticated;

-- Two tabs (or React's double effect) calling this at once must not race.
create or replace function public.ensure_defaults() returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('sg-defaults-' || auth.uid()::text));
  insert into settings (owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  if not exists (select 1 from statuses where owner_id = auth.uid()) then
    insert into statuses (name, color, sort_order) values
      ('Idea', '#9b87c9', 0), ('In progress', '#d9903d', 1), ('On hold', '#8f9aa6', 2), ('Done', '#5f9e6e', 3), ('Sold', '#c0564a', 4);
  end if;
end $$;

-- Health probe that touches the database and is allowed for anon (no 401 noise on the login page).
create or replace function public.ping() returns boolean language sql stable as $$ select true $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

notify pgrst, 'reload schema';
