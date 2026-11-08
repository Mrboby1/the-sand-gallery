-- 0012: which period the "time worked" summary shows (home header and Time log): day, week, month or all time.
alter table public.settings add column if not exists summary_period text not null default 'week'
  check (summary_period in ('day', 'week', 'month', 'all'));
notify pgrst, 'reload schema';
