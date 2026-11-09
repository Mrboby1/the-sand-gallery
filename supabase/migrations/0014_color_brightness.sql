-- 0014: brightness for each custom colour (-50..50, null/0 = the normal brightness for the theme).
alter table public.settings
  add column if not exists hg_light smallint check (hg_light between -50 and 50),
  add column if not exists sand_light smallint check (sand_light between -50 and 50),
  add column if not exists bg_light smallint check (bg_light between -50 and 50),
  add column if not exists freeze_light smallint check (freeze_light between -50 and 50);
notify pgrst, 'reload schema';
