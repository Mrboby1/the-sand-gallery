-- 0019: read-only views of Sand for the Sus Gallery (contract: C:\Users\gabib\family-gallery\infra\SAND-DEDUPE.md).
-- Only the Worker (service_role) calls these, behind the shared DEDUPE_SECRET. Nothing here writes anything.
--
-- Grouping: a "group" is a folder or a project (an item at the top level or directly in a folder). Media on a subtask
-- belongs to its project's group, with `sub_path` = the subtask path inside the project ("Stem / Polish").

create or replace function private.sand_tree()
returns table (id uuid, kind text, title text, group_id uuid, group_name text, group_path text, sub_path text)
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select i.id, i.kind, i.title, i.id as group_id, i.title as group_name, i.title as group_path, null::text as sub_path, 0 as depth
    from public.items i where i.parent_id is null
    union all
    select c.id, c.kind, c.title,
      case when c.kind = 'folder' or t.kind = 'folder' then c.id else t.group_id end,
      case when c.kind = 'folder' or t.kind = 'folder' then c.title else t.group_name end,
      case when c.kind = 'folder' or t.kind = 'folder' then t.group_path || ' / ' || c.title else t.group_path end,
      case when c.kind = 'folder' or t.kind = 'folder' then null else coalesce(t.sub_path || ' / ', '') || c.title end,
      t.depth + 1
    from public.items c join t on c.parent_id = t.id
    where t.depth < 40
  )
  select id, kind, title, group_id, group_name, group_path, sub_path from t
$$;
revoke all on function private.sand_tree() from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.sand_tree() to service_role;

-- Part 1: which hashes / (name, size) pairs are in Sand, and where (project + subtask path).
create or replace function public.dedupe_check(hashes text[], files jsonb default '[]'::jsonb, owner_email text default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with owners as (
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
  ), tree as (select * from private.sand_tree())
  select jsonb_build_object(
    'hashes', coalesce((select jsonb_agg(distinct h.sha256) from hit h where h.via = 'hash'), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(distinct jsonb_build_object('name', h.wname, 'size', h.size_bytes)) from hit h where h.via = 'name'), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
        'via', h.via, 'media_id', h.id, 'sha256', h.sha256, 'name', coalesce(h.wname, lower(h.file_name)), 'size', h.size_bytes,
        'file_name', h.file_name, 'kind', h.kind, 'created_at', h.created_at,
        'project_id', t.group_id, 'project', t.group_name, 'project_path', t.group_path, 'folder', t.sub_path,
        'item_id', h.item_id, 'item_title', t.title, 'item_kind', t.kind,
        'path', t.group_path || coalesce(' / ' || t.sub_path, '')) order by h.created_at)
      from hit h left join tree t on t.id = h.item_id), '[]'::jsonb)
  )
$$;
revoke all on function public.dedupe_check(text[], jsonb, text) from public, anon, authenticated;
grant execute on function public.dedupe_check(text[], jsonb, text) to service_role;

-- Part 2: a page of Sand media, newest first, with the groups for the Sus "Sand Gallery" folder. The Worker adds the
-- signed /f/ URLs. Keyset paging on (created_at, id).
create or replace function public.sand_list(after_created timestamptz default null, after_id uuid default null, lim int default 500, owner_email text default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with owners as (
    select u.id from auth.users u where owner_email is not null and lower(u.email) = lower(owner_email)
  ), tree as (select * from private.sand_tree()),
  page as (
    select m.* from public.media m
    where (owner_email is null or m.owner_id in (select id from owners))
      and (after_created is null or (m.created_at, m.id) < (after_created, after_id))
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(lim, 500), 1000))
  )
  select jsonb_build_object(
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.title, 'path', t.group_path, 'kind', t.kind) order by t.group_path)
                          from tree t where t.group_id = t.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'project_id', t.group_id, 'folder', t.sub_path, 'name', p.file_name, 'kind', p.kind, 'mime', p.mime,
        'size', p.size_bytes, 'sha256', p.sha256, 'taken_at', null, 'created_at', p.created_at,
        'width', p.width, 'height', p.height, 'duration', p.duration_s, 'phase', p.phase,
        'object_key', p.object_key, 'thumb_key', p.thumb_key) order by p.created_at desc, p.id desc)
      from page p left join tree t on t.id = p.item_id), '[]'::jsonb)
  )
$$;
revoke all on function public.sand_list(timestamptz, uuid, int, text) from public, anon, authenticated;
grant execute on function public.sand_list(timestamptz, uuid, int, text) to service_role;

notify pgrst, 'reload schema';
