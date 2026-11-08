-- 0009: several notes per item. Each note has its own text, timestamps and an optional pin.
-- The old single items.notes text is copied into the first note of its item (idempotent: marked with
-- from_item_notes, never copied twice). items.notes itself is left untouched as a backup.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  body text not null default '',
  pinned boolean not null default false,
  from_item_notes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_owner_item_idx on public.notes (owner_id, item_id);
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes for each row execute function public.touch_updated_at();

alter table public.notes enable row level security;
drop policy if exists owner_all on public.notes;
create policy owner_all on public.notes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;

-- copy the old single note of every item (once)
insert into public.notes (owner_id, item_id, body, from_item_notes, created_at, updated_at)
select i.owner_id, i.id, i.notes, true, i.created_at, i.updated_at
from public.items i
where btrim(i.notes) <> ''
  and not exists (select 1 from public.notes n where n.item_id = i.id and n.from_item_notes);

do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null; when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
