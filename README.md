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
  src/store/app.ts   app state (zustand) and every action; optimistic updates, then persist
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
RPCs: `ensure_defaults()` (seeds default statuses), `start_timer(item, session)` (closes the open session and opens a
new one, atomically), `stop_timer()`, `shared_gallery(token)` (service-role only, used by the Worker). View
`item_totals` gives recursive totals in SQL; the app computes the same client-side so parents tick live.

### Media (Backblaze B2, SHARED account)
Bucket `sand-gallery-ypghnj`. **Every key starts with `sand-gallery/`** and the B2 key is restricted to that prefix:
- originals `sand-gallery/media/<user>/<item>/<uuid>.<ext>`
- thumbnails `sand-gallery/thumbs/<user>/<item>/<uuid>.webp` (made in the browser: resized photo / video poster frame)
- backups `sand-gallery/backups/YYYY-MM-DD.json`

The browser uploads straight to B2 with presigned PUT URLs and reads with presigned GET URLs, both from the Worker
after it verifies the Supabase JWT. The Worker only signs keys under the caller's own `media/<uid>/` or
`thumbs/<uid>/` folders. GET URLs are signed with a date fixed to the start of the UTC day so they stay identical
all day, and the service worker caches thumbnails by path.

### Worker endpoints (`worker/src/index.ts`)
| | |
|---|---|
| `POST /api/media/upload` | presigned PUTs for a new file (+ thumb) [auth] |
| `POST /api/media/urls` | presigned GETs for own keys [auth] |
| `POST /api/media/delete` | delete own objects [auth] |
| `GET /api/share/:token` | public gallery for a share link (titles, statuses, media; no notes/times/costs) |
| `GET /api/health` | `up` / `asleep` / `waking` / `unreachable` |
| `POST /api/wake` | restores a paused Supabase project (Management API) |
| `POST /api/backup` | run the backup now [auth] (Settings > Account > Back up now) |
| cron `0 3 * * *` | keep-alive query + JSON export of all tables to B2; if the DB is asleep it requests a restore |

Vars live in `worker/wrangler.toml`; secrets (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
`B2_APPLICATION_KEY`) are Worker secrets only.

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
5. `npm run build`, test locally, deploy.

## Testing
Automated browser tests used a temporary email/password user (`scripts/test-user.ps1`) because Google blocks
automated logins. Email sign-in is **turned off** now (Google-only). To test again: enable it
(`PATCH /v1/projects/<ref>/config/auth {"external_email_enabled": true}`), create the user, test, delete the user,
and turn it off again.

## Rules
No git push. Secrets never printed/committed. Backblaze: only bucket `sand-gallery-ypghnj`, only `sand-gallery/` keys.
