import { useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
/** Visual style: 'flat' (default, clean) or 'glossy' (the original 3D look: gradients, shine, shadows). */
export type StylePref = 'flat' | 'glossy' | 'line'

export function getTheme(): ThemePref {
  try { return (localStorage.getItem('sg.theme') as ThemePref) || 'system' } catch { return 'system' }
}

export function applyTheme(pref: ThemePref = getTheme()) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.style = getStyle()
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#14110D' : '#F7F1E8'))
}

export function setTheme(pref: ThemePref) {
  try { localStorage.setItem('sg.theme', pref) } catch { /* ignore */ }
  applyTheme(pref)
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme())

// ---------------------------------------------------------------- style
const styleListeners = new Set<() => void>()

export function getStyle(): StylePref {
  try { const v = localStorage.getItem('sg.style'); return v === 'glossy' || v === 'line' ? v : 'flat' } catch { return 'flat' }
}

export function setStyle(s: StylePref) {
  try { localStorage.setItem('sg.style', s) } catch { /* ignore */ }
  document.documentElement.dataset.style = s
  styleListeners.forEach((l) => l())
}

export function useStyle(): StylePref {
  return useSyncExternalStore(
    (cb) => { styleListeners.add(cb); return () => void styleListeners.delete(cb) },
    getStyle,
    () => 'flat',
  )
}
