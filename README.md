# The Sand Gallery

A personal project tracker that looks like a photo gallery: nested items (set > cup > subtasks), photos and
videos, a bottomless-hourglass stopwatch on every item with live roll-up totals, statuses, notes, time log,
costs, templates, tags, board and calendar views, and read-only share links. See `SPEC.md` for the agreed spec.

**Live:** https://thesandgallery.pages.dev (install on a phone: open it in Chrome, menu, *Add to Home screen*).

## How it is built

```
web/                 Vite + React 19 + TypeScript + Tailwind v4, installable PWA (vite-plugin-pwa)
  src/lib/backend/   the data layer behind one interface (Backend in types.ts)
    supabase.ts      cloud: Supabase (DB + Google auth) + the Worker (media, share pages, wake-up, backup)
    local.ts         browser-only: localStorage + IndexedDB (dev/demo, same behaviour)
  src/store/app.ts   app state (zustand) and every action. Every write is an "op" in a persisted outbox:
                     applied to the UI at once, sent now if online, replayed in order when back online
                     (timer start/stop keep the time they really happened). The last snapshot is cached
                     in localStorage so the app opens offline.
  src/components/    Hourglass (logo + timer), tiles, views (grid/list/board/calendar), tabs, sheets
  src/pages/         Home, ItemPage, Search, Settings, SharePage (public /s/:token), Login
  src/i18n/          every UI string goes through t(); add a language by copying en.ts
  src/cloud.config.ts  public Supabase URL + anon key + Worker URL (safe to commit)
  scripts/make-icons.mjs  renders the PWA icons from the hourglass SVG
worker/              Cloudflare Worker "api" (https://api.thesandgallery.workers.dev)
supabase/migrations/ SQL schema (idempotent), RLS on every table
scripts/migrate.ps1  applies migrations through the Supabase Management API
scripts/test-user.ps1  creates/deletes an email+password test user for automated tests
infra/               owned by sand.cloud: CLOUD.md (non-secret config) + get-secret.ps1 (DPAPI secrets)
```

### Data model (Postgres, all per-user with `owner_id = auth.uid()` RLS)
`items` (self-nesting via `parent_id`, cycle-checked by trigger), `statuses`, `sessions` (timer start/end; a partial
unique index allows only ONE open session per user), `media` (B2 keys, photo/video, process/finished), `cost_lines`,
`templates` (JSON tree), `share_links` (random token, revocable), `settings` (one row per user).
RPCs: `ensure_defaults()` (seeds default statuses, advisory-locked), `start_timer(item, session, at)` (closes the open
session and opens a new one, atomically, idempotent per session id; `at` = when it happened offline, clamped to now),
`stop_timer(at)`, `ping()` (anon health probe), `shared_gallery(token)` (service-role only, used by the Worker). View
`item_totals` gives recursive totals in SQL; the app computes the same client-side so parents tick live.

### Media (Backblaze B2, SHARED account)
Adding: one "Add photos / videos" entry (+ menu, the empty Photos area, the Add tile). On touch devices it opens a small
sheet (`PhotoSourceSheet`): "Take photo" (back camera: `accept=image/*` `capture=environment`) or "Choose from
gallery" (`accept=image/*,video/*`, multiple); on computers it goes straight to the picker. Both go through `uploadFiles`: thumbnail, upload queue, Worker/B2, same target.
A photo taken in the app is renamed `SandGallery_YYYYMMDD_HHMMSS.<ext>` and, unless Settings > Photos > "Save camera photos
to phone" is off (per device, `sg.saveCamera`), the same file is saved to the device at once (anchor download; Android
Chrome puts it in Downloads/, which Google Photos/Files show), with a toast to save it again via the share sheet or a
download if the browser held it back. `media.file_name` (migration 0015) keeps the original name; the viewer's
Download uses it: online through the Worker link with `?dl=1&name=` (Content-Disposition: attachment, sanitised,
RFC 5987), offline from the local blob.

Bucket `sand-gallery-ypghnj`. **Every key starts with `sand-gallery/`** and the B2 key is restricted to that prefix:
- originals `sand-gallery/media/<user>/<item>/<uuid>.<ext>`
- thumbnails `sand-gallery/thumbs/<user>/<item>/<uuid>.webp` (made in the browser: resized photo / video poster frame)
- backups `sand-gallery/backups/YYYY-MM-DD.json`

The browser uploads straight to B2 with presigned PUT URLs (ingress is free). It never downloads from B2: reads go
through the Worker at `/f/<key>?e=<expiry>&s=<HMAC>` (B2 -> Cloudflare egress is free under the Bandwidth Alliance;
B2 -> browser is billable and counts against the shared account's daily cap). `/api/media/urls` (after the JWT and
allow-list check, only keys under the caller's own `media/<uid>/` or `thumbs/<uid>/`) and share pages issue these links;
the HMAC key is derived from the B2 application key. Expiry is aligned to the UTC day (share pages: hour), so a link is
the same all day and caches hit. `/f/` streams from B2 with Range (video seeking), `Cache-Control: private,
max-age=604800, immutable`, and never caches errors (a B2 refusal, e.g. the daily cap, becomes 502 + `X-Storage-Status`).
The service worker caches thumbnails by path, fetching in CORS mode so only real 200s are stored.

### Worker endpoints (`worker/src/index.ts`)
| | |
|---|---|
| `POST /api/media/upload` | presigned PUTs for a new file (+ thumb) [auth] |
| `POST /api/media/urls` | presigned GETs for own keys [auth] |
| `POST /api/media/delete` | delete own objects [auth] |
| `GET /api/share/:token` | public gallery for a share link (titles, statuses, media; no notes/times/costs) |
| `GET /api/health` | `up` / `asleep` / `waking` / `unreachable` |
| `POST /api/wake` | restores a paused Supabase project. Needs a Supabase JWT, verified locally against the embedded JWKS (works while the DB sleeps; tokens up to 30 days past expiry accepted); 1 call/min per user, and 1 per 30 min total without a token (KV `RATE`) |
| `POST /api/backup` | run the backup now [auth, 1 per 5 min] (Settings > Account > Back up now) |
| cron `0 3 * * *` | keep-alive query + JSON export of all tables to B2; if the DB is asleep it requests a restore |
| `GET /api/push/key`, `POST /api/push/subscribe`, `/unsubscribe`, `/test` | Web Push device registration and a test push [auth] |
| `POST /api/timer/stop` | the notification's Stop button: `{deviceId, deviceSecret}`, no sign-in token needed |
| `POST /api/hooks/session` | called by the database (pg_net) on every timer start/stop, with `X-Hook-Secret` |
| cron `*/15 * * * *` | "Still working on X?" reminder every N hours (Settings > Notifications) while a timer runs |

### Timer notifications (Web Push)
- While a timer runs, devices that allowed notifications show "⏳ <title>, running since 14:02" (tag `timer`, stays
  until stopped) with **Stop** / **Open**. The page shows and clears it at once (`src/components/TimerNotifier.tsx`).
- Other devices and closed apps: the trigger `private.notify_session_change` (pg_net) calls `/api/hooks/session` on
  every start/stop, and the Worker pushes to all of the user's `push_subscriptions` (`worker/src/webpush.ts`: VAPID
  JWT + RFC 8291 aes128gcm with WebCrypto). Push topic `timer`, so an offline phone only gets the latest state.
- Stop in the notification (`src/sw.ts`): an open app stops it through its offline queue; otherwise the service
  worker calls `/api/timer/stop` with this device's secret; offline, it is stored and applied (with the time it was
  pressed) the next time the app opens.
- Secrets: `VAPID_PRIVATE_JWK`, `HOOK_SECRET` (Worker secrets + DPAPI `vapid-private.key`, `hook-secret.key`; the hook
  secret is also in `private.hook_config`). Re-create with `scripts/setup-push.ps1` (devices then re-allow once).

Share-page media URLs are signed per hour (valid up to 2 h), so revoking a link takes effect within about 2 hours.
Uploads retry with backoff; a failed thumbnail keeps the photo (shown from the original), a failed original
deletes whatever was stored and shows Retry/Remove on the tile.

Vars live in `worker/wrangler.toml`; secrets (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
`B2_APPLICATION_KEY`) are Worker secrets only.

### Updates of the installed app
`src/lib/updates.ts`: the service worker is checked for a new version every 30 min and whenever the app comes back
to the foreground (an installed Android app is often only resumed, never reopened). A new worker takes over at once
(`skipWaiting` + `clients.claim` in `src/sw.ts`); the page then reloads by itself if it is in the background, or shows
"A new version of the app is ready · Update" and reloads the next time it is put away.

### Hourglass styles
Settings > Appearance > Style: Flat (default), Glossy (3D) and 2D (Gabi's sketch: two bare walls, no caps, darker
muted colours; `Hourglass2D` in `src/components/Hourglass.tsx`). All keep the same grains: fading in above the
glass, fading out below it, frozen when paused.

### Colours
Settings > Appearance > Colours: a hue slider per colour and, behind a sun button (one open at a time), a brightness
slider (`*_light`, -50..50 = black..white, migration 0014) for the hourglass, the sand, the background and the
freeze colour. The background decides light or dark text/cards whatever the theme: `colorVars` flips them, nudges
mid tones just past the band where neither works, and keeps body, muted and accent text >= 4.5:1 against the
background, both surfaces and the accent tint; the hourglass outline keeps exactly the chosen brightness and gets a thin contrasting halo (`--hg-halo`, a drop-shadow)
when it is under 3:1 against the background, and the sand stays visible in the glass
(checked for 22,032 hue x brightness x theme combinations). Colours:
saved per user in `settings` (`hg_hue`, `sand_hue`, `bg_hue`, `freeze_hue`; null = original colours) so they sync across devices.
`src/lib/customColors.ts` turns a hue into CSS variables for the current theme with fixed lightness/saturation, so
text keeps its contrast (surfaces and borders are derived from the background hue). Works with all three styles.
Only the save is debounced; the preview (including the canvas sand, via a MutationObserver on `<html style>`) updates
on every slider move without restarting the simulation.
"Full screen" (and the palette button on the timer's fullscreen view) opens `CustomizeFullscreen` /
`CustomizePanel` (`src/components/CustomizePanel.tsx`): the big live hourglass with a Running/Paused preview toggle and
a collapsible sheet with theme, style and all colour sliders.

### Sand fill and the neck
The upper pile follows the item's total time: `sandFill(total)` = 1 − (1 − t)², t = total / 10 min (empty for a new
project, full at 10 min). `SandSim` starts with that many grains and gets `setTarget` as time grows; below target it
pours in extra grains and the neck lets fewer through, so the hill builds up naturally. The neck has simulation-only
45° walls narrowing to one cell, so the bottom of the pile is a point made by the grains.

### Frozen when paused
A paused hourglass blends its outline, rims and sand toward `--freeze` (`freeze_hue`, default icy blue) with CSS
transitions, the canvas grains blend over ~0.8 s, and a static frost layer (tint, frosted edges, crystals) fades in.
The timer card and time text take an icy tint too. Small CSS glyphs get a lighter tint. Nothing animates while frozen.

### Daily review
`/day` (calendar button in the header; `?d=YYYY-MM-DD`, never in the future): time worked that local day (sessions split
at midnight, a running timer up to now), time per project (sessions rolled up to their top-level / in-folder
project, bars, tap to open), photos/videos added that day, projects started (`created_at`) and finished
(`finished_at`), and a "How did the day go" note in `day_notes` (migration 0016: one per owner + date, owner RLS +
allow-list, realtime; autosaved; in offline mode, export/import and the nightly backup). The offline backend now
stamps `finished_at` like the database trigger does.

### Add time log
The + menu has "Add time log": inside a project/subtask it opens the Time log's session sheet (start, end) for it; on
home or in a folder it first asks which project (`ProjectPickerSheet`, projects in scope, active first, searchable).

### Finished projects and the filter
A project is finished when its status (or an ancestor's) has `is_finished` (Done and Sold by default; the database stamps
`finished_at`). Folders have no status, so they are never finished. One filter dropdown (`components/FilterMenu.tsx`)
above the gallery and inside folders: All / Unfinished / Finished (with counts) and a Tags section with a search box
(live, case-insensitive, matches anywhere; Enter picks the first match, Esc clears then closes; focused on computers
only so phones do not open the keyboard); it replaced the
tag chips and the old Active/Finished switch. Remembered per place in localStorage (`sg.filter.home`,
`sg.filter.folder.<id>`); home defaults to Unfinished, folders to All. Home lists top-level items only (what is in a
folder shows in that folder). Long-press / the ⋯ menu: Mark finished (first finished status, creates "Done" if none)
and Reopen ("In progress", else the first open status), both with Undo. No schema change.

### Folders
An item with `kind = 'folder'` (migration 0013; existing rows are 'item') groups projects and other folders. Folders sit at
the top level or inside folders, never inside a project (enforced by `items_check_parent`, the Move sheet and
`createFolder`/`moveItem`). They look like a folder everywhere (`components/Folder.tsx`: tab, back, up to three
covers of what is inside peeking out, front flap; outlined in the 2D style), come first in lists, are skipped on the
board, and open as a gallery (`FolderPage`): their projects and folders as tiles, a Notes tab and their own photos;
no status, timer, time log, costs, tags or due date (only a read-only total). + offers New folder at the top level
and inside folders; New project inside a folder creates it there. Long-press on a folder: Rename, Set cover, Move to…,
Share link, Delete (move the contents out to the parent, or delete everything). Share pages show folders as folders
(`shared_gallery` returns `kind`); export/import and backups carry the column.

### Offline version
"Use the offline version" on the sign-in page (or Settings > Your data) runs the app on the `LocalBackend`
(localStorage + IndexedDB, no account, nothing uploaded). The choice is per device (`localStorage sg.backend=local`,
`src/lib/offline.ts`); switching reloads with the other backend. An explainer is shown before it starts (data lives
only in this browser, clearing site data or uninstalling deletes it, export regularly). Settings shows storage use,
asks for persistent storage, and offers the browser's install prompt ("download" the app) when it has one.

### Export / import (`.sandgallery`)
`src/lib/portable.ts` + `src/lib/zip.ts`: a plain ZIP (stored entries, readable by any unzip tool) with
`manifest.json` (format `sand-gallery-export`, version 1, `origin` + `key`: `offline:<device id>` or
`cloud:<user id>`, counts, file list), `data.json` (all rows) and `media/` (originals + thumbnails). Import merges:
rows with an existing id are skipped, statuses are matched by name, open timers are closed at the export time, share
links are not imported, settings only when the target is empty. Routing: in the offline version everything goes to
local storage; in the online version a **cloud** file is restored into the account (media re-uploaded to B2), and an
**offline** file is never uploaded: it is imported into local storage and the app switches to the offline version.
Anything without a clear `cloud:` key counts as offline. Limit: 4 GB per file (no ZIP64).

### Private online version (allow-list)
Migration 0011: `public.allowed_emails` (owner = `is_admin`), `access_check()` for the app, a RESTRICTIVE
`allowlist` RLS policy on every table, and the Auth hook `hook_before_user_created` (enabled with
`scripts/auth-hook.ps1 -Action enable`) that refuses new accounts for addresses not on the list. The Worker checks
`is_allowed` before media/upload/backup/push calls (cached 5 min; a recent yes in KV keeps photos working while the DB
sleeps). Not-listed accounts get "This gallery is private" with a button to the offline version. The owner adds and
removes people in Settings > Allowed people. Google sign-in is published (In production since 2026-11-08, with
/privacy and /terms pages), so adding an e-mail to the list is all a new person needs.

### Wake-up
Free Supabase projects pause after 7 idle days (the daily cron should prevent it). If the app cannot reach the DB it
asks the Worker; a paused project shows the banner "Your gallery is asleep 💤 Wake up", which calls `/api/wake` and
shows the hourglass until the DB answers again (polling every 5 s, up to 8 min).

## Develop

```powershell
cd web
npm install
npm run dev            # http://localhost:5173, talks to the real cloud (localhost is allowed in auth + CORS)
```
- Browser-only mode with demo data: in the browser console run `localStorage.setItem('sg.backend','local')`, then
  open `http://localhost:5173/?seed=1` (dev server only). Remove the key to go back to the cloud.
- Simulate the asleep banner in local mode: `localStorage.setItem('sg.local.asleep','1')`.
- `npm run build` typechecks and builds to `web/dist`. `npm run icons` regenerates the icons.

## Deploy (PowerShell; secrets are piped, never shown)

```powershell
cd C:\Users\gabib\sand-gallery
$env:CLOUDFLARE_API_TOKEN  = powershell -NoProfile -File infra\get-secret.ps1 -Name cloudflare-api-token
$env:CLOUDFLARE_ACCOUNT_ID = '92c0925f1726a45f64556448560d3cd0'
cd web; npm run build; cd ..\worker
npx wrangler pages deploy ..\web\dist --project-name thesandgallery --branch main   # frontend
npx wrangler deploy                                                                  # worker + cron
# a Worker secret (example):
cmd /c "powershell -NoProfile -File ..\infra\get-secret.ps1 -Name b2-app-key | npx wrangler secret put B2_APPLICATION_KEY"
Remove-Item Env:CLOUDFLARE_API_TOKEN
```
Database changes: add `supabase/migrations/000N_name.sql` (write it idempotent: `create ... if not exists`,
`create or replace`), then `powershell -File scripts\migrate.ps1 -Pattern 000N_*.sql`. Ad-hoc SQL:
`scripts\migrate.ps1 -Sql "select ..."`.

## Backups and restore
Every night at 03:00 UTC the Worker writes `sand-gallery/backups/YYYY-MM-DD.json` (all tables, as rows) to B2; the
bucket keeps old versions. "Back up now" in Settings does the same on demand. To restore, download the JSON from the
bucket and insert the rows back table by table (statuses, items parents-first, media, sessions, cost_lines,
templates, share_links, settings) with the service-role key or SQL. Photos/videos are never deleted by the backup.

## Adding a feature
1. Schema: new migration with RLS (`owner_id = auth.uid()` policy, like 0001).
2. Types in `web/src/lib/types.ts` (and `TableName` if it is a new table); load it in `SupabaseBackend.loadAll`
   and `LocalBackend` (`emptyDB`).
3. Actions in `web/src/store/app.ts` using `commit(local, remote)` for an instant UI with server persistence.
4. UI in `components/` or `pages/`; every string in `i18n/en.ts`.
5. **Add it to Settings > Features & tips**: one entry in `web/src/lib/features.ts` (id + search keywords) and
   its `feature.<id>.title` / `feature.<id>.how` strings in `i18n/en.ts`. Every new feature must be listed there;
   the Settings search also finds it. If it adds a setting, add a row to `settingsIndex` in `SettingsPage.tsx`.
6. `npm run build`, test locally, deploy.

## Testing
Automated browser tests used a temporary email/password user (`scripts/test-user.ps1`) because Google blocks
automated logins. Email sign-in is **turned off** now (Google-only). To test again: enable it
(`PATCH /v1/projects/<ref>/config/auth {"external_email_enabled": true}`), create the user, test, delete the user,
and turn it off again.

## Rules
Code lives in the PUBLIC repo https://github.com/Mrboby1/the-sand-gallery (public since 2026-11-09, at Gabi's request):
push `main` after each commit, never force-push. Because anyone can read it: never commit secrets or tokens (the
Supabase anon key and the VAPID public key are public by design; anything from `infra/get-secret.ps1` never), never
commit real user data, and only commit screenshots of test/demo data (never Gabi's real account). `infra/` stays
untracked. Backblaze: only bucket `sand-gallery-ypghnj`, only `sand-gallery/` keys.
