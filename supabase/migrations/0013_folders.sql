-- 0013: folders. An item is either a project/subtask ('item', all existing rows) or a 'folder' that only groups
-- projects and other folders (it has notes and photos, but no status, timer, costs, tags or due date).
alter table public.items add column if not exists kind text not null default 'item' check (kind in ('item', 'folder'));

-- parent must belong to the same owner, must not create a cycle, and a folder can only sit at the top level or
-- inside another folder (never inside a project/subtask)
create or replace function public.items_check_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur uuid; depth int := 0; parent_kind text;
begin
  if new.parent_id is null then return new; end if;
  select kind into parent_kind from items where id = new.parent_id and owner_id = new.owner_id;
  if parent_kind is null then raise exception 'parent not found'; end if;
  if new.kind = 'folder' and parent_kind <> 'folder' then raise exception 'a folder can only be inside another folder'; end if;
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
create trigger items_parent_check before insert or update of parent_id, kind on public.items
  for each row execute function public.items_check_parent();

-- share pages: include the kind so folders look like folders there too
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
              'title', i.title, 'status_id', i.status_id, 'cover_media_id', i.cover_media_id, 'sort_order', i.sort_order, 'kind', i.kind))
              from items i where i.id in (select id from tree)), '[]'::jsonb),
    'statuses', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color)) from statuses s where s.owner_id = link.owner_id), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'item_id', m.item_id, 'kind', m.kind, 'width', m.width, 'height', m.height,
              'phase', m.phase, 'created_at', m.created_at, 'note', m.note, 'object_key', m.object_key, 'thumb_key', m.thumb_key))
              from media m where m.item_id in (select id from tree)), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.shared_gallery(text) from public, anon, authenticated;
grant execute on function public.shared_gallery(text) to service_role;

notify pgrst, 'reload schema';
