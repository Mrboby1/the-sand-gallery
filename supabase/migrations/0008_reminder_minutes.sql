-- 0008: reminder interval in minutes (any value from 15 min, the reminder cron runs every 15 min); 0 = off.
-- reminder_hours stays for older app versions; the Worker uses reminder_minutes.
alter table public.settings add column if not exists reminder_minutes integer
  check (reminder_minutes = 0 or reminder_minutes between 15 and 10080);
update public.settings set reminder_minutes = reminder_hours * 60 where reminder_minutes is null;
alter table public.settings alter column reminder_minutes set default 120;
alter table public.settings alter column reminder_minutes set not null;
notify pgrst, 'reload schema';
