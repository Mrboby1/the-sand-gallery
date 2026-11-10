-- 0015: the original file name of a photo/video (used as the name when it is downloaded). null for older rows.
alter table public.media add column if not exists file_name text check (file_name is null or length(file_name) <= 255);
notify pgrst, 'reload schema';
