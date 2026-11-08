// Timer notification on this device: permission, Web Push registration, and the "timer running"
// notification itself (shown/cleared locally at once; pushes keep other devices and a closed app in sync).
import { backend } from './backend'
import { TIMER_TAG, kvGet, kvSet, timerNotification, type DeviceInfo, type TimerNote } from './swShared'
import { CLOUD } from '../cloud.config'

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
export const pushSupported = () => notifySupported() && 'PushManager' in window
export const permission = (): NotificationPermission | 'unsupported' => (notifySupported() ? Notification.permission : 'unsupported')

const ASKED = 'sg.notif.asked'
export const alreadyAsked = () => { try { return localStorage.getItem(ASKED) === '1' } catch { return true } }

/** Asks the browser for permission (call from a tap). Registers this device for push when granted. */
export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!notifySupported()) return 'unsupported'
  try { localStorage.setItem(ASKED, '1') } catch { /* ignore */ }
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (p === 'granted') void ensurePush()
  return p
}

function keyBytes(b64url: string): Uint8Array {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** Subscribes this browser to Web Push and registers it with the Worker (once per subscription). */
export async function ensurePush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted' || backend.mode !== 'cloud' || !CLOUD) return false
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const { publicKey } = (await (await fetch(`${CLOUD.workerUrl}/api/push/key`)).json()) as { publicKey: string }
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource })
    }
    const known = await kvGet<DeviceInfo>('device')
    if (known && known.endpoint === sub.endpoint) return true
    const res = await backend.pushSubscribe(sub.toJSON())
    await kvSet('device', { ...res, workerUrl: CLOUD.workerUrl, endpoint: sub.endpoint } satisfies DeviceInfo)
    return true
  } catch (e) {
    console.warn('push registration failed', e)
    return false
  }
}

export async function disablePush() {
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) { await backend.pushUnsubscribe(sub.endpoint).catch(() => {}); await sub.unsubscribe() }
    await kvSet('device', null)
  } catch { /* ignore */ }
}

/** Shows (or silently refreshes) the "timer running" notification on this device. */
export async function showTimer(n: TimerNote) {
  if (permission() !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.ready
    const shown = await kvGet<string>('timerShown')
    const { title, options } = timerNotification(n, { silent: shown === n.sessionId })
    await reg.showNotification(title, options)
    await kvSet('timerShown', n.sessionId)
  } catch (e) { console.warn('notification failed', e) }
}

export async function clearTimer() {
  if (!notifySupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    for (const n of await reg.getNotifications({ tag: TIMER_TAG })) n.close()
    await kvSet('timerShown', null)
  } catch { /* ignore */ }
}

/** A Stop pressed in the notification while the app was closed and offline, waiting to be applied. */
export async function takePendingStop(): Promise<{ at: string; sessionId?: string } | null> {
  try {
    const p = await kvGet<{ at: string; sessionId?: string }>('pendingStop')
    if (p) await kvSet('pendingStop', null)
    return p ?? null
  } catch { return null }
}
