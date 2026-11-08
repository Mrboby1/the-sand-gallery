-- The Sand Gallery: initial schema.
-- Every table is per-user (owner_id) with Row Level Security: owner_id = auth.uid().

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ helpers
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------------ statuses
create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  color text not null default '#a8977f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists statuses_owner_idx on public.statuses (owner_id, sort_order);

-- ------------------------------------------------------------------ items (nested to any depth)
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid references public.items (id) on delete cascade,
  title text not null default '' check (length(title) <= 300),
  notes text not null default '',
  status_id uuid references public.statuses (id) on delete set null,
  tags text[] not null default '{}',
  due_date date,
  cover_media_id uuid,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index if not exists items_owner_parent_idx on public.items (owner_id, parent_id, sort_order);
create index if not exists items_tags_idx on public.items using gin (tags);
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();

-- parent must belong to the same owner, and must not create a cycle
create or replace function public.items_check_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur uuid; depth int := 0;
begin
  if new.parent_id is null then return new; end if;
  if not exists (select 1 from items where id = new.parent_id and owner_id = new.owner_id) then
    raise exception 'parent not found';
  end if;
  cur := new.parent_id;
  while cur is not null loop
    if cur = new.id then raise exception 'cycle in item tree'; end if;
    select parent_id into cur from items where id = cur;
    depth := depth + 1;
    if depth > 200 then raise exception 'tree too deep'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists items_parent_check on public.items;
create trigger items_parent_check before insert or update of parent_id on public.items
  for each row execute function public.items_check_parent();

-- ------------------------------------------------------------------ timer sessions
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists sessions_owner_item_idx on public.sessions (owner_id, item_id, started_at);
-- only ONE running timer per user
create unique index if not exists sessions_one_running on public.sessions (owner_id) where ended_at is null;

-- ------------------------------------------------------------------ media (photos/videos in B2)
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  object_key text not null check (object_key like 'sand-gallery/%'),
  thumb_key text check (thumb_key is null or thumb_key like 'sand-gallery/%'),
  kind text not null check (kind in ('photo', 'video')),
  mime text not null default '',
  size_bytes bigint not null default 0,
  width integer,
  height integer,
  duration_s real,
  phase text not null default 'process' check (phase in ('process', 'finished')),
  created_at timestamptz not null default now()
);
create index if not exists media_owner_item_idx on public.media (owner_id, item_id);

do $$ begin
  alter table public.items add constraint items_cover_fk foreign key (cover_media_id) references public.media (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ costs
create table if not exists public.cost_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  label text not null default '',
  qty numeric(12, 3) not null default 1,
  unit_cost numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cost_lines_owner_item_idx on public.cost_lines (owner_id, item_id);

-- ------------------------------------------------------------------ templates
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  item_title text not null default '',
  tags text[] not null default '{}',
  tree jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ public share links
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  token text not null unique check (length(token) >= 20),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ------------------------------------------------------------------ settings (one row per user)
create table if not exists public.settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  hourly_rate numeric(12, 2) not null default 0,
  currency text not null default 'ILS',
  markup_pct numeric(7, 2) not null default 0,
  week_starts_on smallint not null default 0 check (week_starts_on between 0 and 6),
  due_dates_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS: owner only, on every table
do $$
declare t text;
begin
  foreach t in array array['statuses', 'items', 'sessions', 'media', 'cost_lines', 'templates', 'share_links', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ RPCs
-- Seeds default statuses + settings for a new user (idempotent).
create or replace function public.ensure_defaults() returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into settings (owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  if not exists (select 1 from statuses where owner_id = auth.uid()) then
    insert into statuses (name, color, sort_order) values
      ('Idea', '#9b87c9', 0), ('In progress', '#d9903d', 1), ('On hold', '#8f9aa6', 2), ('Done', '#5f9e6e', 3), ('Sold', '#c0564a', 4);
  end if;
end $$;

-- Starts a timer: closes any open session of this user, opens a new one. Single running timer guaranteed.
create or replace function public.start_timer(p_item uuid, p_session uuid default gen_random_uuid())
returns public.sessions
language plpgsql security invoker set search_path = public as $$
declare s sessions;
begin
  if not exists (select 1 from items where id = p_item) then raise exception 'item not found'; end if;
  update sessions set ended_at = now() where owner_id = auth.uid() and ended_at is null;
  insert into sessions (id, item_id) values (p_session, p_item) returning * into s;
  return s;
end $$;

create or replace function public.stop_timer() returns public.sessions
language plpgsql security invoker set search_path = public as $$
declare s sessions;
begin
  update sessions set ended_at = now() where owner_id = auth.uid() and ended_at is null returning * into s;
  return s;
end $$;

-- Recursive totals (seconds) per item, own + descendants, open sessions counted up to now().
create or replace view public.item_totals with (security_invoker = true) as
with recursive own as (
  select i.id, i.parent_id,
         coalesce(sum(extract(epoch from coalesce(s.ended_at, now()) - s.started_at)), 0)::bigint as own_s
  from items i left join sessions s on s.item_id = i.id
  group by i.id
), up as (
  select id as item_id, id as ancestor_id, own_s from own
  union all
  select up.item_id, i.parent_id, up.own_s from up join items i on i.id = up.ancestor_id where i.parent_id is not null
)
select o.id as item_id, o.own_s, coalesce(sum(up.own_s), 0)::bigint as total_s
from own o left join up on up.ancestor_id = o.id
group by o.id, o.own_s;
grant select on public.item_totals to authenticated;

-- Public share page data: only for a valid, unrevoked token. Exposes titles/status/media metadata, nothing private.
create or replace function public.shared_gallery(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare link share_links; result jsonb;
begin
  select * into link from share_links where token = p_token and revoked_at is null;
  if link.id is null then return null; end if;
  with recursive tree as (
    select id from items where id = link.item_id and owner_id = link.owner_id
    union all
    select i.id from items i join tree t on i.parent_id = t.id
  )
  select jsonb_build_object(
    'root_id', link.item_id,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'parent_id', case when i.id = link.item_id then null else i.parent_id end,
              'title', i.title, 'status_id', i.status_id, 'cover_media_id', i.cover_media_id, 'sort_order', i.sort_order))
              from items i where i.id in (select id from tree)), '[]'::jsonb),
    'statuses', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color)) from statuses s where s.owner_id = link.owner_id), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'item_id', m.item_id, 'kind', m.kind, 'width', m.width, 'height', m.height,
              'phase', m.phase, 'created_at', m.created_at, 'object_key', m.object_key, 'thumb_key', m.thumb_key))
              from media m where m.item_id in (select id from tree)), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.shared_gallery(text) from public, anon, authenticated;
-- only the Worker (service_role) calls it, then presigns the media keys
grant execute on function public.shared_gallery(text) to service_role;

grant execute on function public.ensure_defaults() to authenticated;
grant execute on function public.start_timer(uuid, uuid) to authenticated;
grant execute on function public.stop_timer() to authenticated;

-- ------------------------------------------------------------------ realtime (cross-device sync)
do $$
declare t text;
begin
  foreach t in array array['statuses', 'items', 'sessions', 'media', 'cost_lines', 'templates', 'share_links', 'settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null;
    end;
  end loop;
end $$;
