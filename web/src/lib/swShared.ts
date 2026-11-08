// Shared by the page and the service worker (no DOM-only APIs here).

// ---------------------------------------------------------------- tiny IndexedDB key/value store
const DB = 'sg-sw'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key)
    r.onsuccess = () => { resolve(r.result as T | undefined); db.close() }
    r.onerror = () => { resolve(undefined); db.close() }
  })
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    if (value === undefined || value === null) tx.objectStore(STORE).delete(key)
    else tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => { resolve(); db.close() }
    tx.onerror = () => { resolve(); db.close() }
  })
}

/** What the service worker needs to stop a timer from the notification with the app closed. */
export interface DeviceInfo { deviceId: string; deviceSecret: string; workerUrl: string; endpoint: string }

// ---------------------------------------------------------------- notification content
export const TIMER_TAG = 'timer'

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
function dur(ms: number): string {
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export interface TimerNote { itemId: string; sessionId: string; title: string; startedAt: string }

/** "⏳ Cup 3, running since 14:02": stays until the timer stops; Stop / Open buttons. */
export function timerNotification(n: TimerNote, opts: { silent: boolean; reminder?: boolean }): { title: string; options: NotificationOptions & Record<string, unknown> } {
  const now = Date.now()
  return {
    title: opts.reminder ? `⏳ Still working on ${n.title}?` : `⏳ ${n.title}, running since ${hhmm(n.startedAt)}`,
    options: {
      body: opts.reminder ? `Running for ${dur(now - Date.parse(n.startedAt))}` : 'Tap to open, or stop it here.',
      tag: TIMER_TAG,
      requireInteraction: true,
      renotify: !!opts.reminder,
      silent: opts.silent && !opts.reminder,
      timestamp: Date.parse(n.startedAt),
      icon: '/icon-192.png',
      badge: '/badge-96.png', // white hourglass on transparent: Android's small status-bar icon
      data: { kind: 'timer', ...n },
      actions: [{ action: 'stop', title: 'Stop' }, { action: 'open', title: 'Open' }],
    },
  }
}
