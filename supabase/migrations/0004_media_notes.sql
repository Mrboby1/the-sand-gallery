-- 0004: a note / caption per photo or video. RLS on media is unchanged (owner only); backups use
-- select * so the new column is included automatically.
alter table public.media add column if not exists note text;

-- share pages show media notes as captions (read-only)
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
              'phase', m.phase, 'created_at', m.created_at, 'note', m.note, 'object_key', m.object_key, 'thumb_key', m.thumb_key))
              from media m where m.item_id in (select id from tree)), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.shared_gallery(text) from public, anon, authenticated;
grant execute on function public.shared_gallery(text) to service_role;

notify pgrst, 'reload schema';
