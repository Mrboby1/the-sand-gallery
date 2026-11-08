-- 0003: "finished" statuses (items with them switch to a pure gallery view) + when an item was finished.

alter table public.statuses add column if not exists is_finished boolean not null default false;
-- defaults: Done and Sold count as finished (only for rows nobody changed yet)
update public.statuses set is_finished = true where name in ('Done', 'Sold') and is_finished = false;

alter table public.items add column if not exists finished_at timestamptz;

-- Keep finished_at right whenever the status changes (also when a status's flag changes, see below).
create or replace function public.items_finished_at() returns trigger
language plpgsql security definer set search_path = public as $$
declare fin boolean;
begin
  if tg_op = 'UPDATE' and new.status_id is not distinct from old.status_id then return new; end if;
  select is_finished into fin from statuses where id = new.status_id;
  if coalesce(fin, false) then
    new.finished_at := coalesce(case when tg_op = 'UPDATE' then old.finished_at end, new.finished_at, now());
  else
    new.finished_at := null;
  end if;
  return new;
end $$;
drop trigger if exists items_finished on public.items;
create trigger items_finished before insert or update of status_id on public.items
  for each row execute function public.items_finished_at();

-- backfill: items already in a finished status
update public.items i set finished_at = coalesce(i.finished_at, i.updated_at)
  from public.statuses s where s.id = i.status_id and s.is_finished and i.finished_at is null;

create or replace function public.ensure_defaults() returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('sg-defaults-' || auth.uid()::text));
  insert into settings (owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  if not exists (select 1 from statuses where owner_id = auth.uid()) then
    insert into statuses (name, color, sort_order, is_finished) values
      ('Idea', '#9b87c9', 0, false), ('In progress', '#d9903d', 1, false), ('On hold', '#8f9aa6', 2, false),
      ('Done', '#5f9e6e', 3, true), ('Sold', '#c0564a', 4, true);
  end if;
end $$;

notify pgrst, 'reload schema';
