# The Sand Gallery: QA report

Tester: sand.tester (intern_01), 2026-11-08. Target: https://thesandgallery.pages.dev (deployed build, bundle `index-DjJzvoma.js`).
Method: temporary email/password test user (`scripts/test-user.ps1`), `playwright-anon` browser, phone 390x844 and desktop 1440x900, light/dark, flat/glossy, plus a few network-level checks with curl.
Screenshots: `C:\Users\gabib\sand-gallery\qa-shots\` (file names below).

Cleanup status: test user deleted (0 test users left), all its B2 objects deleted (listing of `sand-gallery/media/` and `sand-gallery/thumbs/` is empty), Supabase email sign-in is OFF again (Google only).

## Summary

Overall the app is in good shape. Timers (start/stop, one at a time, live roll-up, persistence over reload, cross-device sync), nesting, move/duplicate/delete, notes, tags, search, costs maths, statuses, views, sharing and revoking, dark mode and the PWA basics all work. Page load is fast (about 0.5 s to content, 193 KB brotli JS). There are no blockers. The main problems are about reliability on a flaky connection and the template feature.

Top issues:
1. (major) Timer started while offline is shown as running but is silently lost; raw "TypeError: Failed to fetch" toast; app opened offline sits on "Loading…" forever.
2. (major) A transient Backblaze 500 on the thumbnail upload made a photo silently disappear (no retry, no message) and left an orphaned object in the bucket.
3. (major) Templates: the "New item title" and "Tags" fields are never used, "From template" injects sub-items into the current item, and "Save as template" gives no name prompt.
4. (minor) White text on status pills and primary buttons fails contrast (down to 2.6:1).

## Bugs and UX problems

### Major

**M1. Offline: timer lost, raw error toast, infinite "Loading…"**
- Steps: open an item while online. Go offline (airplane mode / DevTools offline). Tap Start. Wait 4 s, go back online, reload.
- Expected: the start is queued and synced when back online, or the user is told clearly that it was not saved.
- Actual: the UI shows the timer running (0:00:04) and a toast "Something went wrong: TypeError: Failed to fetch". After reconnecting and reloading the item is at 0:00:00 / Start, so the time is gone. No retry, no queue.
- Also: opening the app while offline (service worker serves the shell) shows "Loading…" with the hourglass forever, with no offline message; it recovers by itself once online again.
- Screenshots: `47-offline.png`, `48-offline-timer.png` (the second one was taken while offline).
- Why it matters: a maker in a workshop with weak signal loses tracked time.

**M2. Photo upload silently lost after a transient storage error**
- Steps: upload 4 files at once (3 small photos, one 4000x3000 JPEG of 1.2 MB, one 2 s video). The PUT of the big photo's thumbnail to Backblaze returned HTTP 500 once.
- Expected: retry, or an error message and a "retry" button.
- Actual: the tile showed a spinner for about 15 s, then vanished. "All 3" instead of 4, no toast. The original (`media/<uid>/<item>/<uuid>.jpg`) was already uploaded, so an orphaned object stays in the bucket with no DB row (I deleted it manually). Re-uploading the same file worked.
- Screenshots: `36-uploaded.png` (spinner tile), `37-uploaded2.png` (tile gone).

**M3. Templates do not work the way the editor suggests**
- The "New template" dialog has "New item title" and "Tags" fields, but neither is ever used. Applying a template ("item menu > From template") only adds the template's sub-items directly into the current item; no new item with that title or tags is created. There is also no "new from template" in the "New item" dialogs (Home, sub-item), so the spec example "new cup creates the same subtasks every time" needs: create an item, open its menu, From template.
- "Save as template" (item menu) saves immediately with no name prompt and no confirmation beyond a toast; clicking twice creates two identical "Cup 1" templates (no de-duplication). A template saved from an item stores that item's name and children, but applying it to a parent adds the children only (my "Cup 1" template put "Stem > Polish" straight into the Set).
- The picker lists templates as "Cup 1 / Stem", which does not tell you what will happen.
- Screenshots: `12-fromtpl.png`, `63-newtemplate.png`.

### Minor

**m1. Contrast of white text on coloured pills and buttons.** Measured (WCAG ratio, 11 px pill text): In progress 2.62, Idea 3.13, Done 3.18, Curing (custom teal) 3.28; primary buttons ("Resume", "New sub-item") 3.63 in light mode; segmented controls in Settings 4.18. Dark mode is fine. Custom status colours can be any of the 10 swatches, so pills should pick dark or light text automatically. Screenshot: `26-set-grid.png`.

**m2. Revoked share link: already-issued media URLs stay valid.** After "Revoke" the page and `/api/share/<token>` return 404 (good), but presigned media URLs a viewer already fetched keep working until expiry (the GET URLs are signed with Expires=172800 s, i.e. up to 48 h, dated at 00:00 UTC). Acceptable for a hobby app but not "instant revoke". Screenshots: `44-share-created.png`, `45-share-public.png`.

**m3. Title rename is lost if the page is reloaded/closed before blur or Enter.** Steps: edit the item title, wait, reload (no Enter, no tap elsewhere). Title reverts. Enter and blur both save correctly. On a phone, closing the app while the keyboard is open loses the edit.

**m4. Short times are rounded to "<1m" in places while the timer shows seconds.** The tile, "own <1m", "You worked <1m this week" and the time-log rows say "<1m" for 50 s of work while the hourglass shows 0:00:52. Costs use the exact value (1:51 total gave ₪1.24 at ₪40/h, which is correct).

**m5. Overlapping sessions are allowed and double counted.** "Add session" defaults to the last hour ending now and can overlap a running session or another session; both are summed.

**m6. Settings colour picker is clipped.** The popover for a status colour opens inside the Statuses card and the second row of swatches is cut off by the card edge (phone). Screenshot: `21-colorpicker.png`.

**m7. Share page navigation does not change the URL.** Opening a sub-item on `/s/<token>` stays on the same URL, so reload goes back to the root and the browser Back button leaves the page. Sub-item tiles on the share page also show no status pill.

**m8. Wake-up banner only appears after about 7 s of plain "Loading…".** With the database returning 503 immediately (simulated by routing, the real DB was never touched) the banner appears after 7.4 s; before that the screen is just the loading hourglass. Everything else in the flow works: banner, tap Wake up, "Waking your gallery up…" progress bar, data loads when the mock turns healthy, and a failing `/api/wake` shows "Wake-up failed: wake: 500". Screenshots: `49-asleep.png`, `50-waking.png`, `52-asleep-banner.png`.

**m9. First login: two `ensure_defaults` calls race and one returns 409** (console errors on the very first load only; exactly 5 default statuses end up created, so no visible effect).

**m10. Deep link is lost after login.** Opening `/i/<id>` logged out shows the login screen and, after Google login, lands on the home page (redirectTo is the origin only). The login page also logs one 401 in the console.

**m11. Board drag on desktop with 5+ columns.** With a synthetic mouse drag the board auto-scrolled sideways while dragging and the card dropped on "Curing" instead of "Done" (it did persist correctly and survives reload). Likely fine with a real mouse, but touch dragging on a phone was NOT tested (the tooling cannot do real touch). Screenshot: `29-board-dragging.png`.

**m12. Raw technical errors reach the user.** Toasts like "Something went wrong: insert or update on table "items" violates foreign key constraint "items_owner_id_fkey"" (seen when a stale session of a deleted user was still in the browser) and "TypeError: Failed to fetch". Suggest a friendly message plus a "sign in again" or "retry" action.

### Polish

- **p1. Floating mini timer overlaps content** (phone): the "Polish 0:00:33" pill sits over the bottom of the tiles (covers "1 item" on a tile). Screenshot: `06-set-running.png`.
- **p2. Calendar grid:** in November 2026 a stray sixth row of greyed next-month dates (6..12) appears without cards, and the fifth row shows greyed dates without cards, so the grid looks broken. The item's own due date also shows in its own calendar. Screenshots: `27-view-Calendar.png`, `65-home-cal-day.png`.
- **p3. Breadcrumbs clip at depth 5** (Gallery > Set > Cup 1 > Stem > Polish > item): the deepest parents are cut off, no fade or scroll hint. The Back arrow still works. Screenshot: `14-crumbs.png`.
- **p4. Creating a sub-item navigates into it every time**, so adding five siblings needs five "back" taps.
- **p5. Long unbroken titles are clipped at the tile edge without an ellipsis** (home grid). Screenshot: `57-home-longnames.png`. (Item page wraps correctly.)
- **p6. Hebrew/RTL text is left-aligned** (no `dir="auto"` on titles, notes, tiles). Screenshot: `58-hebrew-item.png`.
- **p7. Accessibility:** lightbox "open original" and "delete" buttons have no accessible name or tooltip, media tile images have empty `alt`, the page still scrolls behind the lightbox (scrollbar visible), the tile cover button has no label. Screenshots: `39-lightbox.png`, `38-media-phone-dark-glossy.png`.
- **p8. "Link copied" toast has weak contrast over the dark blurred overlay.** Screenshot: `44-share-created.png`.
- **p9. Delete dialogs say "1 items".** Screenshot: `15-del.png`.
- **p10. Starting a timer does not touch the status** (Idea stays Idea). Maybe auto-set "In progress" (suggestion).
- **p11. Static document title** "The Sand Gallery" on every page (no item name in the tab/history).
- **p12. Hosting details:** unknown paths such as `/zzz.js` answer 200 with the app HTML; hashed assets are served with `max-age=0, must-revalidate` (could be `immutable`); the manifest has no `id` or screenshots.
- **p13. `/api/wake` accepts unauthenticated POSTs with no rate limit** (by design, it must work when the DB is asleep; it did nothing while the DB was up). Worth throttling in the Worker.
- **p14. Desktop Settings column is narrower than the other pages** (620 px vs about 1100 px); the Back arrow therefore jumps horizontally. Screenshot: `33-settings-dark-desktop.png`.

## Verified working (no bug found)

- **Items:** created Set > Cup 1 > Stem > Polish, moved an item to depth 5 (picker excludes self and own subtree), rename, duplicate ("(copy)"), delete with confirmation showing item and media counts, delete while its timer runs (clean). XSS strings (`<img onerror>`), emoji, CJK and very long names are escaped and stored correctly.
- **Timers:** one running timer at a time (starting the Set paused Polish and closed its session), parents tick live (Stem/Cup/Set/Home all matched: 33 s + later totals, arithmetic checked), the timer survives reload and keeps counting, a second browser context sees the running timer and a pause on device 2 reaches device 1 within seconds, manual session add/edit/delete (end before start is rejected), time log with sub-items toggle, weekly total, 1h 01m = 3636 s style sums correct. Full-screen hourglass: sand falls through the bottom opening and does not pile up (screenshots `09-fs-a.png`, `09-fs-b.png`), Escape and X close it.
- **Statuses:** the five defaults, adding a custom status with a colour, reordering controls, deleting a status in use (confirmation, items move to a "No status" board column), bottom status bar.
- **Organising:** notes autosave and persist, tags (normalised to lowercase, de-duplicated, `#` stripped), search by title, note text, tag and status combined, due dates (off by default, the Settings toggle reveals the control), calendar view per item and on Home (also shows worked time per day), costs: materials 2 x 15.5 = 31.00, roll-up from sub-items, time at hourly rate, markup 25% gave the suggested price 40.30.
- **Media:** photo and video upload, auto cover, "Set as cover" moves the cover and the parent tile shows the child's cover, Process/Finished phase, lightbox with next/prev, video plays, delete with confirmation (and the matching B2 delete call).
- **Sharing:** link created, opens in a fresh logged-out context, shows only titles, statuses and media (the API payload has no notes, times, costs or owner fields), unknown tokens say "This gallery is not shared (any more).", revoke makes both the page and API return 404. Worker endpoints reject unauthenticated calls (401), unsigned B2 URLs return 401.
- **Views:** grid small/medium/large, list, board (drag changes status and persists), calendar; the chosen view is remembered.
- **Themes:** Light/Dark/System (System follows the OS live, Light/Dark override it), header toggle, flat and glossy in light and dark. Dark-mode contrast scan found no failures; light-mode failures are in m1.
- **PWA:** valid manifest (standalone, theme and background colours), icons 192/512/maskable are real PNGs (hourglass), apple-touch-icon, favicon.svg, service worker registered and activated, precache plus a thumbnail cache. Install prompt itself cannot be triggered in headless mode.
- **Performance:** cold load to content about 0.5 s, health call 0.3 s, no console errors in normal use.

## Not tested

- "Back up now" (would write a real backup to `sand-gallery/backups/` containing test data).
- Touch drag-and-drop on a real phone, real Google login, the OS-level "Add to home screen" flow.
- The real "database paused" state (never paused; only simulated by request routing).
