-- 0010: colour of the "frozen" look of a paused hourglass (hue 0-360; null = icy blue).
alter table public.settings add column if not exists freeze_hue smallint check (freeze_hue between 0 and 360);
notify pgrst, 'reload schema';
