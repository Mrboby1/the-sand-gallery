-- 0011: the online version is private: only e-mail addresses on the allow-list can use it.
-- Enforced three times: (1) an Auth hook refuses to create accounts for other addresses, (2) a RESTRICTIVE RLS
-- policy on every table (so even an existing account that is removed from the list sees and changes nothing), and
-- (3) the Worker checks public.access_check() before signing media URLs / uploads.
-- The offline version (no account, data only on the device) is unaffected.

create table if not exists public.allowed_emails (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  is_admin boolean not null default false,
  added_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from public, anon;
grant select, insert, delete on public.allowed_emails to authenticated;

create or replace function public.jwt_email() returns text
language sql stable set search_path = public as $$ select lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) $$;

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_emails where email = public.jwt_email())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_emails where email = public.jwt_email() and is_admin)
$$;

-- what the app asks after sign-in
create or replace function public.access_check() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('allowed', public.is_allowed(), 'admin', public.is_admin(), 'email', public.jwt_email())
$$;

revoke all on function public.is_allowed() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.access_check() from public;
grant execute on function public.is_allowed() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.access_check() to authenticated;

-- the list itself: the owner (admin) manages it; everyone else only sees their own row
drop policy if exists read_allowed on public.allowed_emails;
create policy read_allowed on public.allowed_emails for select to authenticated
  using ((select public.is_admin()) or email = (select public.jwt_email()));
drop policy if exists admin_add on public.allowed_emails;
create policy admin_add on public.allowed_emails for insert to authenticated
  with check ((select public.is_admin()) and not is_admin);
drop policy if exists admin_remove on public.allowed_emails;
create policy admin_remove on public.allowed_emails for delete to authenticated
  using ((select public.is_admin()) and not is_admin);

-- every data table: nothing unless allowed (AND-ed with the existing owner-only policies)
do $$
declare t text;
begin
  foreach t in array array['statuses', 'items', 'sessions', 'media', 'cost_lines', 'templates', 'share_links', 'settings', 'notes', 'push_subscriptions'] loop
    execute format('drop policy if exists allowlist on public.%I', t);
    execute format(
      'create policy allowlist on public.%I as restrictive for all to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()))', t);
  end loop;
end $$;

-- Auth hook "before user created": refuse new accounts that are not on the list.
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if exists (select 1 from public.allowed_emails where email = e) then return '{}'::jsonb; end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'not_allowed: The Sand Gallery is private. Use the offline version, or ask the owner to add you.'));
end $$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- seed: the owner (admin) and Gabi's other account
insert into public.allowed_emails (email, is_admin) values ('theradiantjester@gmail.com', true) on conflict (email) do update set is_admin = true;
insert into public.allowed_emails (email) values ('gabibabibo@gmail.com') on conflict (email) do nothing;

notify pgrst, 'reload schema';
