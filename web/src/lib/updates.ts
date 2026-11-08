import { registerSW } from 'virtual:pwa-register'
import { toast } from '../store/app'
import { t } from '../i18n'

/**
 * Keeps the installed app on the newest version. An installed Android app that is only resumed (never
 * freshly opened) would otherwise keep running an old build for days:
 *  - check for a new service worker every 30 min and whenever the app comes back to the foreground;
 *  - the new worker activates at once (skipWaiting + clients.claim in sw.ts);
 *  - when it takes over, reload: right away if the app is in the background, otherwise offer
 *    "New version: Update" and reload by itself the next time the app is put away.
 */
export function setupUpdates() {
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => { if (navigator.onLine !== false) void reg.update().catch(() => {}) }
      setInterval(check, 30 * 60_000)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
    },
  })

  let hadController = !!navigator.serviceWorker.controller
  let reloading = false
  const reload = () => { if (!reloading) { reloading = true; location.reload() } }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return } // first install, not an update
    if (document.visibilityState === 'hidden') return reload()
    toast(t('update.ready'), 'info', { label: t('update.now'), run: reload }, 30_000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reload() })
  })
}
