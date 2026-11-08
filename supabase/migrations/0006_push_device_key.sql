-- 0006: one push subscription per device. The app sends a stable random device key; registering again from
-- the same device replaces its older row(s) instead of adding another (two parts of the app subscribing at
-- the same moment had created duplicates).
alter table public.push_subscriptions add column if not exists device_key text;
create index if not exists push_subscriptions_owner_device_idx on public.push_subscriptions (owner_id, device_key);
notify pgrst, 'reload schema';
