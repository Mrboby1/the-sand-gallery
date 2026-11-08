# The Sand Gallery: spec (agreed with Gabi on Telegram, 2026-11-08)

A personal project-management app with a Dropbox/gallery-style UI. Gabi makes things by hand (e.g. glass sets),
but the app is GENERIC: no glass-specific terms are hard-coded.

## Core
- **Items:** nested folders/projects to any depth (e.g. Set → Cup → subtasks). Every item can hold children, photos/videos,
  notes, a timer and a status. Subtasks are items too, with their own status. There are no checklists.
- **Stopwatch on every item:** it persists across days, with sessions stored server-side so it survives closing the app or
  switching device.
  - Parents show the LIVE total of their own time + all descendants, ticking while a child runs.
  - Only ONE timer runs at a time; starting another pauses the current one.
  - A parent may have its own timer for general work (planning etc.).
- **Timer visual:** an hourglass open at BOTH ends, so the sand flows forever while running and freezes when paused. It doubles as the
  app icon/logo. The timer has a fullscreen mode (big hourglass + time).
- **Statuses:** defaults Idea, In progress, On hold, Done, Sold. Custom statuses (name + color) can be added or edited in a
  Settings screen. Statuses show as colored pills.
- **Media:** upload photos and videos (process + finished). Mark one as the cover (before/after) so the folder tile shows it.

## Features (v1)
- Notes per item.
- Manual time edits: add, edit or delete a session, for when he forgot to start or stop the timer.
- Time log per item: every session with date + length, and a weekly total ("you worked 14h this week").
- Templates: e.g. "new cup" creates the same subtasks every time.
- Tags + search/filter by tag.
- Due dates are OPTIONAL and off by default (passion projects). Calendar view.
- Costs per item/set: materials + time → a suggested price.
- Share link like Google Drive: a read-only public page of an item/set gallery, which can be revoked.
- **View switcher:** grid (small/medium/large), list, board (Trello-style: one column per status, drag a card to change its
  status), calendar.

## Layout idea
- Folder grid tiles: cover photo, status pill, total time, due date (if set).
- Item page: the timer + tags + due date on top; tabs Gallery | Notes | Time log | Costs; the **status pills sit in a separate
  bar at the bottom** so the top isn't crowded.
- Phone AND PC: one responsive web app, installable as a PWA (home-screen icon, standalone). English UI, but all strings
  go through an i18n layer so other languages can be added later.

## Accounts / sharing
- Personal only for now: one owner (Gabi), login with Google (Supabase Auth). Keep the data model per-user (owner_id + RLS)
  so it could be opened up later, but build NO friends or sharing features beyond the public share links.

## Stack (decided, all free tiers; NOT base44)
- **Supabase:** Postgres DB + Auth. Use Row Level Security on every table.
- **Backblaze B2** (S3-compatible API): photos/videos in a NEW private bucket. The browser uploads directly through presigned URLs
  and reads through presigned GET URLs. The bucket needs a CORS rule for the app origin.
- **Cloudflare Pages:** hosts the app (e.g. thesandgallery.pages.dev). A **Cloudflare Worker** holds the secrets and does:
  - presigned B2 URLs (after verifying the Supabase JWT);
  - "Wake up" restore of a paused Supabase project through the Supabase Management API;
  - a **daily cron**: a keep-alive query (free Supabase projects pause after 7 idle days) plus a JSON export of all tables
    written to B2 under `backups/YYYY-MM-DD.json`.
- **Wake-up UX:** when the app opens and the DB is paused or unreachable, show a banner "Your gallery is asleep 💤 Wake up".
  Tapping it calls the Worker restore endpoint, and an hourglass progress view shows until the DB answers.
- No AI at runtime. No paid features. No credit card anywhere.

## Hard rules
- **Backblaze: NEVER touch anything we did not create.** No viewing-to-change, editing, deleting or re-keying of existing buckets,
  files, keys or settings. Create only our own bucket + an application key restricted to that bucket.
  The Backblaze account is SHARED (Gabi, msg 467): every object goes under the top-level folder `sand-gallery/`, and the key
  is restricted to that bucket + name prefix.
- Secrets (B2 key, Cloudflare API token, Supabase service-role key and access token) are stored DPAPI-encrypted under
  `%LOCALAPPDATA%\sand-gallery\` and as Worker secrets. They are never printed, never sent to Telegram and never committed. The Supabase anon key and
  URL are public by design and can go in the frontend config.
- No git push anywhere (local git only). Never read or print `C:\Users\gabib\lead-gibbs\bots.json`.
- Nothing about lead.sham / the `C:\Users\gabib\sham` folder: that's his brother's bot, so leave it out.
