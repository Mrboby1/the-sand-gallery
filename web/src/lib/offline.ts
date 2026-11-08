import { useEffect, useState } from 'react'

/**
 * The offline version: no account, everything in this browser (localStorage + IndexedDB, the LocalBackend).
 * The choice is remembered per device (localStorage `sg.backend`); switching reloads the app with the other backend.
 */
const MODE_KEY = 'sg.backend'
const LOCAL_USER_KEY = 'sg.local.user'
const AUTO_SIGN_IN = 'sg.autoSignIn'

export function isOfflineMode(): boolean {
  try { return localStorage.getItem(MODE_KEY) === 'local' } catch { return false }
}

/** Opens the offline version on this device (data already stored here is kept). */
export function enterOffline(path = '/') {
  localStorage.setItem(MODE_KEY, 'local')
  localStorage.setItem(LOCAL_USER_KEY, '1')
  void askPersistentStorage()
  location.replace(path)
}

/** Back to the online version. The offline data stays on this device for later. */
export function leaveOffline(signIn = false) {
  localStorage.removeItem(MODE_KEY)
  localStorage.removeItem(LOCAL_USER_KEY)
  if (signIn) try { sessionStorage.setItem(AUTO_SIGN_IN, '1') } catch { /* ignore */ }
  location.replace('/')
}

/** True once after leaveOffline(true): the login page then opens Google sign-in by itself. */
export function takeAutoSignIn(): boolean {
  try { const v = sessionStorage.getItem(AUTO_SIGN_IN) === '1'; sessionStorage.removeItem(AUTO_SIGN_IN); return v } catch { return false }
}

/** Asks the browser not to clear this site's storage under pressure (granted silently for installed apps). */
export async function askPersistentStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false } catch { return false }
}

export async function storageInfo(): Promise<{ used: number; quota: number; persisted: boolean } | null> {
  try {
    const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted()])
    return { used: est.usage ?? 0, quota: est.quota ?? 0, persisted }
  } catch { return null }
}

// ---------------------------------------------------------------- install ("download the offline version")
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallPromptEvent | null = null
const subs = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; subs.forEach((f) => f()) })
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()) })
}

export const isInstalled = () => typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

/** Whether the browser offers its install prompt right now, and a function that opens it. */
export function useInstall(): { canPrompt: boolean; installed: boolean; install: () => Promise<boolean> } {
  const [, force] = useState(0)
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => void subs.delete(f) }, [])
  return {
    canPrompt: !!deferred,
    installed: isInstalled(),
    install: async () => {
      if (!deferred) return false
      const e = deferred
      deferred = null
      await e.prompt()
      const r = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
      subs.forEach((f) => f())
      return r.outcome === 'accepted'
    },
  }
}
