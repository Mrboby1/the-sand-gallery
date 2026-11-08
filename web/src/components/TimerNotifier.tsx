import { useEffect } from 'react'
import { useApp, setTimerStartHook, stopTimer } from '../store/app'
import { useRunning } from '../lib/hooks'
import { alreadyAsked, clearTimer, ensurePush, permission, requestNotifications, showTimer, takePendingStop } from '../lib/notify'
import { confirmDialog } from './ui'
import { t } from '../i18n'

// First timer start on a device: explain, then ask for notification permission (inside the tap).
setTimerStartHook(() => {
  if (!useApp.getState().data.settings.notify_enabled) return
  const p = permission()
  if (p === 'granted') { void ensurePush(); return }
  if (p !== 'default' || alreadyAsked()) return
  void confirmDialog(t('notif.askTitle'), { body: t('notif.askBody'), okLabel: t('notif.allow') }).then((ok) => {
    if (ok) void requestNotifications()
    else try { localStorage.setItem('sg.notif.asked', '1') } catch { /* ignore */ }
  })
})

/** Keeps this device's "timer running" notification in step with the running timer, and applies Stop taps. */
export function TimerNotifier() {
  const running = useRunning()
  const item = useApp((s) => (running ? s.data.items.find((i) => i.id === running.item_id) : undefined))
  const enabled = useApp((s) => s.data.settings.notify_enabled)
  const phase = useApp((s) => s.phase)

  useEffect(() => {
    if (phase !== 'ready') return
    if (running && item && enabled) void showTimer({ itemId: item.id, sessionId: running.id, title: item.title, startedAt: running.started_at })
    else void clearTimer()
  }, [phase, running?.id, running?.started_at, item?.title, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'ready') return
    if (permission() === 'granted' && enabled) void ensurePush()
    // a Stop pressed in the notification while the app was closed and offline
    void takePendingStop().then((p) => { if (p && useApp.getState().data.sessions.some((s) => !s.ended_at)) void stopTimer(p.at) })
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; at?: string } | undefined
      if (d?.type === 'sg-stop-timer' && useApp.getState().data.sessions.some((s) => !s.ended_at)) void stopTimer(d.at)
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
