export type ThemePref = 'system' | 'light' | 'dark'

export function getTheme(): ThemePref {
  try { return (localStorage.getItem('sg.theme') as ThemePref) || 'system' } catch { return 'system' }
}

export function applyTheme(pref: ThemePref = getTheme()) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#14110D' : '#F7F1E8'))
}

export function setTheme(pref: ThemePref) {
  try { localStorage.setItem('sg.theme', pref) } catch { /* ignore */ }
  applyTheme(pref)
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme())
