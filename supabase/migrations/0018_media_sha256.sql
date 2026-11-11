-- 0018: content hash of every photo/video, so other apps (the Sus Gallery phone backup) can skip files that are
-- already in the Sand Gallery. The browser computes SHA-256 of the original before uploading it.
-- Contract: C:\Users\gabib\family-gallery\infra\SAND-DEDUPE.md (Worker endpoint POST /api/dedupe/check).
alter table public.media add column if not exists sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
create index if not exists media_sha256_idx on public.media (sha256) where sha256 is not null;
-- fallback match (original file name + size) for files a phone hands over with location bytes blanked out
create index if not exists media_name_size_idx on public.media (size_bytes, lower(file_name)) where file_name is not null;

-- Which of these hashes / (name, size) pairs are stored, and where? Read-only. Only the Worker (service_role) calls
-- it, behind its own shared secret. `owner_email` limits the answer to one Sand account (null = everyone's media).
-- Returns { hashes: [found], files: [{name, size}], matches: [{via, sha256, name, size, file_name, kind, created_at,
--   media_id, item_id, item_title, item_kind, path}] }; path = "Folder › Project › Subtask" (the item the file is in, last).
create or replace function public.dedupe_check(hashes text[], files jsonb default '[]'::jsonb, owner_email text default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with recursive owners as (
    select u.id from auth.users u where owner_email is not null and lower(u.email) = lower(owner_email)
  ), mine as (
    select m.* from public.media m
    where owner_email is null or m.owner_id in (select id from owners)
  ), wanted as (
    select lower(f->>'name') as name, (f->>'size')::bigint as size
    from jsonb_array_elements(coalesce(files, '[]'::jsonb)) f
    where jsonb_typeof(f->'size') = 'number' and coalesce(f->>'name', '') <> ''
  ), hit as (
    select m.*, 'hash'::text as via, null::text as wname from mine m where m.sha256 = any(coalesce(hashes, '{}'))
    union all
    select m.*, 'name'::text, w.name from wanted w join mine m on m.size_bytes = w.size and lower(m.file_name) = w.name
  ), up as (
    -- walk from each hit's item up to the top level
    select h.id as media_id, i.id, i.parent_id, i.title, 0 as depth
    from (select distinct id, item_id from hit) h join public.items i on i.id = h.item_id
    union all
    select up.media_id, p.id, p.parent_id, p.title, up.depth + 1
    from up join public.items p on p.id = up.parent_id
    where up.depth < 30
  ), paths as (
    select media_id, string_agg(title, ' › ' order by depth desc) as path from up group by media_id
  )
  select jsonb_build_object(
    'hashes', coalesce((select jsonb_agg(distinct h.sha256) from hit h where h.via = 'hash'), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(distinct jsonb_build_object('name', h.wname, 'size', h.size_bytes)) from hit h where h.via = 'name'), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
        'via', h.via, 'media_id', h.id, 'sha256', h.sha256, 'name', coalesce(h.wname, lower(h.file_name)), 'size', h.size_bytes,
        'file_name', h.file_name, 'kind', h.kind, 'created_at', h.created_at,
        'item_id', h.item_id, 'item_title', i.title, 'item_kind', i.kind, 'path', p.path) order by h.created_at)
      from hit h join public.items i on i.id = h.item_id left join paths p on p.media_id = h.id), '[]'::jsonb)
  )
$$;
revoke all on function public.dedupe_check(text[], jsonb, text) from public, anon, authenticated;
grant execute on function public.dedupe_check(text[], jsonb, text) to service_role;

notify pgrst, 'reload schema';
