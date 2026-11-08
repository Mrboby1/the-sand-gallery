// User colours (Settings > Appearance): a hue for the hourglass glass/outline, one for the sand, one for the
// app background. Only the hue is chosen; lightness and saturation are fixed per theme so text stays readable
// (surfaces and borders are derived from the background hue). null = the original colours from index.css.

export interface CustomColors { hg_hue: number | null; sand_hue: number | null; bg_hue: number | null; freeze_hue?: number | null }

const KEY = 'sg.colors'
const VARS = [
  '--sg-bg', '--sg-surface', '--sg-surface-2', '--sg-line',
  '--glass-line', '--rim', '--hg2-wall', '--glass-fill',
  '--sand-1', '--sand-2', '--sand-3', '--hg2-sand', '--freeze',
]
let current: CustomColors = read()

function read(): CustomColors {
  try { return { hg_hue: null, sand_hue: null, bg_hue: null, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CustomColors>) } } catch { return { hg_hue: null, sand_hue: null, bg_hue: null } }
}

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${s}% ${l}%)`

/** CSS variable values for the current theme. */
export function colorVars(c: CustomColors, dark: boolean): Record<string, string> {
  const v: Record<string, string> = {}
  if (c.bg_hue !== null) {
    const h = c.bg_hue
    Object.assign(v, dark
      ? { '--sg-bg': hsl(h, 18, 7), '--sg-surface': hsl(h, 16, 10.5), '--sg-surface-2': hsl(h, 14, 15), '--sg-line': hsl(h, 12, 21), '--glass-fill': hsl(h, 14, 13) }
      : { '--sg-bg': hsl(h, 42, 94), '--sg-surface': hsl(h, 50, 98.5), '--sg-surface-2': hsl(h, 30, 91), '--sg-line': hsl(h, 26, 83), '--glass-fill': hsl(h, 50, 98) })
  }
  if (c.hg_hue !== null) {
    const h = c.hg_hue
    const line = dark ? hsl(h, 32, 72) : hsl(h, 38, 27)
    Object.assign(v, { '--glass-line': line, '--rim': line, '--hg2-wall': dark ? hsl(h, 18, 70) : hsl(h, 22, 22) })
  }
  if (c.sand_hue !== null) {
    const h = c.sand_hue
    Object.assign(v, {
      '--sand-1': hsl(h, 78, dark ? 70 : 74),
      '--sand-2': hsl(h, 62, dark ? 60 : 57),
      '--sand-3': hsl(h, 58, dark ? 50 : 45),
      '--hg2-sand': dark ? hsl(h, 48, 54) : hsl(h, 56, 41),
    })
  }
  if (c.freeze_hue !== null && c.freeze_hue !== undefined) v['--freeze'] = dark ? hsl(c.freeze_hue, 70, 68) : hsl(c.freeze_hue, 78, 60)
  return v
}

/** Writes the colours onto <html> for the current theme (and again whenever the theme changes). */
export function applyColors(c: CustomColors = current) {
  current = c
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* ignore */ }
  const root = document.documentElement
  const dark = root.dataset.theme === 'dark'
  const v = colorVars(c, dark)
  for (const name of VARS) {
    if (v[name]) root.style.setProperty(name, v[name])
    else root.style.removeProperty(name)
  }
  const bg = v['--sg-bg']
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg ?? (dark ? '#14110D' : '#F7F1E8')))
}

// re-apply when light/dark switches
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => applyColors(current)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}
