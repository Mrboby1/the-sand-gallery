/// <reference lib="webworker" />
// The Sand Gallery service worker: offline app shell + thumbnail cache (Workbox), and the timer
// notification: Web Push (start/stop/reminders from any device) and the Stop/Open buttons.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { TIMER_TAG, kvGet, kvSet, timerNotification, type DeviceInfo, type TimerNote } from './lib/swShared'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

self.addEventListener('install', () => { void self.skipWaiting() })
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ---------------------------------------------------------------- offline
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))
// B2 thumbnails: presigned URLs change their query string, so cache by path only
registerRoute(
  ({ url }) => url.hostname.endsWith('backblazeb2.com') && /\/thumbs\//.test(url.pathname),
  new CacheFirst({
    cacheName: 'sg-thumbs',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 800, maxAgeSeconds: 30 * 86400 }),
      { cacheKeyWillBeUsed: async ({ request }) => { const u = new URL(request.url); return u.origin + u.pathname } },
    ],
  }),
)

// ---------------------------------------------------------------- push
interface PushData { type: 'timer-start' | 'timer-stop' | 'timer-reminder' | 'test'; session_id?: string; item_id?: string; title?: string; started_at?: string }

async function anyVisibleWindow(): Promise<boolean> {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return wins.some((w) => w.visibilityState === 'visible')
}

self.addEventListener('push', (e) => {
  let d: PushData
  try { d = e.data?.json() as PushData } catch { return }
  e.waitUntil((async () => {
    if (d.type === 'test') {
      await self.registration.showNotification('The Sand Gallery', { body: 'Notifications work on this device.', tag: 'test', icon: '/icon-192.png', badge: '/badge-96.png' })
      return
    }
    if (d.type === 'timer-stop') {
      const open = await self.registration.getNotifications({ tag: TIMER_TAG })
      open.forEach((n) => n.close())
      await kvSet('timerShown', null)
      // Chrome wants every push to show something unless the app is on screen: a short confirmation.
      if (open.length && !(await anyVisibleWindow())) {
        await self.registration.showNotification('⏹ Timer stopped', { tag: TIMER_TAG, silent: true, icon: '/icon-192.png', badge: '/badge-96.png' })
        setTimeout(() => { void self.registration.getNotifications({ tag: TIMER_TAG }).then((ns) => ns.forEach((n) => n.close())) }, 4000)
      }
      return
    }
    if (!d.session_id || !d.item_id || !d.started_at) return
    const note: TimerNote = { itemId: d.item_id, sessionId: d.session_id, title: d.title || 'Timer', startedAt: d.started_at }
    const shown = await kvGet<string>('timerShown')
    const n = timerNotification(note, { silent: shown === note.sessionId, reminder: d.type === 'timer-reminder' })
    await self.registration.showNotification(n.title, n.options)
    await kvSet('timerShown', note.sessionId)
  })())
})

// ---------------------------------------------------------------- buttons
async function openApp(path: string) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const w of wins) {
    if ('focus' in w) {
      await (w as WindowClient).focus()
      if (path) await (w as WindowClient).navigate(path).catch(() => {})
      return
    }
  }
  await self.clients.openWindow(path || '/')
}

/** Stop from the notification: through an open app (its offline queue), else the API, else remember it. */
async function stopFromNotification(n: Partial<TimerNote>) {
  const at = new Date().toISOString()
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (wins.length) {
    wins.forEach((w) => w.postMessage({ type: 'sg-stop-timer', at, sessionId: n.sessionId }))
    return
  }
  const dev = await kvGet<DeviceInfo>('device')
  try {
    if (!dev) throw new Error('no device')
    const r = await fetch(`${dev.workerUrl}/api/timer/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: dev.deviceId, deviceSecret: dev.deviceSecret }),
    })
    if (!r.ok) throw new Error(String(r.status))
  } catch {
    // offline (or not registered): the app applies it, with this time, the next time it opens
    await kvSet('pendingStop', { at, sessionId: n.sessionId })
  }
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification
  const data = (n.data ?? {}) as Partial<TimerNote> & { kind?: string }
  if (e.action === 'stop') {
    n.close()
    e.waitUntil(stopFromNotification(data))
    return
  }
  if (n.tag !== TIMER_TAG) n.close()
  e.waitUntil(openApp(data.itemId ? `/i/${data.itemId}` : '/'))
})
