-- 0017: per-project looks. settings.look_mode: 'same' (one look everywhere, the default) or 'separate' (each project
-- may have its own). items.look: that project's colours (+ how its subtasks look); kept when switching back to 'same'.
alter table public.settings add column if not exists look_mode text not null default 'same' check (look_mode in ('same', 'separate'));
alter table public.items add column if not exists look jsonb check (look is null or jsonb_typeof(look) = 'object');
notify pgrst, 'reload schema';
