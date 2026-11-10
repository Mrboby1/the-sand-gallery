-- 0016: Daily review. One free-text "How did the day go" note per user and (local) date.
create table if not exists public.day_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, day)
);
drop trigger if exists day_notes_touch on public.day_notes;
create trigger day_notes_touch before update on public.day_notes for each row execute function public.touch_updated_at();

alter table public.day_notes enable row level security;
drop policy if exists owner_all on public.day_notes;
create policy owner_all on public.day_notes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- the online version is private (0011): nothing unless allowed
drop policy if exists allowlist on public.day_notes;
create policy allowlist on public.day_notes as restrictive for all to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));
revoke all on public.day_notes from anon;
grant select, insert, update, delete on public.day_notes to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.day_notes;
exception when duplicate_object then null; when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
