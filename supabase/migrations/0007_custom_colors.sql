-- 0007: colour customisation (Settings > Appearance). Hues 0-360; null = the original colours.
alter table public.settings add column if not exists hg_hue smallint check (hg_hue between 0 and 360);
alter table public.settings add column if not exists sand_hue smallint check (sand_hue between 0 and 360);
alter table public.settings add column if not exists bg_hue smallint check (bg_hue between 0 and 360);
notify pgrst, 'reload schema';
