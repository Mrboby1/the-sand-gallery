// User colours (Settings > Appearance): a hue and a brightness for the hourglass glass/outline, the sand, the app
// background and the freeze (paused) colour. null = the original colours from index.css.
// Saturation is fixed per theme. Brightness moves lightness within a range; for the background the range is clamped
// per theme and the text colours are recomputed so body and muted text keep a contrast of at least 4.5:1 against the
// background and every surface (see textFor).

export interface CustomColors {
  hg_hue: number | null; sand_hue: number | null; bg_hue: number | null; freeze_hue?: number | null
  /** Brightness -50..50 (0/null = normal). */
  hg_light?: number | null; sand_light?: number | null; bg_light?: number | null; freeze_light?: number | null
}

/** Default hues, used when only the brightness is changed. */
export const DEFAULT_HUES = { hg: 29, sand: 32, bg: 36, freeze: 200 } as const

const KEY = 'sg.colors'
const VARS = [
  '--sg-bg', '--sg-surface', '--sg-surface-2', '--sg-line', '--sg-ink', '--sg-muted', '--sg-accent-strong',
  '--glass-line', '--rim', '--hg2-wall', '--glass-fill',
  '--sand-1', '--sand-2', '--sand-3', '--hg2-sand', '--freeze',
]
let current: CustomColors = read()

function read(): CustomColors {
  try { return { hg_hue: null, sand_hue: null, bg_hue: null, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CustomColors>) } } catch { return { hg_hue: null, sand_hue: null, bg_hue: null } }
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${s}% ${Math.round(clamp(l, 0, 100) * 10) / 10}%)`

/** HSL (deg, %, %) -> sRGB 0..1 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
function luminance([r, g, b]: [number, number, number]): number {
  const c = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}
export function contrast(a: number, b: number): number { return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
const lumOf = (h: number, s: number, l: number) => luminance(hslToRgb(h, s, clamp(l, 0, 100)))

/** Lightness shift for a brightness value (-50..50): about +-18 points. */
const shift = (b: number | null | undefined) => (b ?? 0) * 0.36
const has = (v: number | null | undefined) => v !== null && v !== undefined
const active = (hue: number | null | undefined, light: number | null | undefined) => has(hue) || (has(light) && light !== 0)

/**
 * Background lightness for a brightness value. Light theme: 66..98 (normal 94); dark theme: 3..28 (normal 7).
 * Outside those ranges the surfaces would stop looking like the theme (and text could not stay readable).
 */
export function bgLightness(b: number, dark: boolean): number {
  if (dark) return b >= 0 ? 7 + b * (21 / 50) : 7 + b * (4 / 50)
  return b >= 0 ? 94 + b * (4 / 50) : 94 + b * (28 / 50)
}

/**
 * Text colours for a set of background lightnesses: the darkest/lightest ink and a muted tone that both keep a
 * contrast of at least 4.5:1 against every one of them.
 */
function textFor(h: number, surfaces: { s: number; l: number }[], dark: boolean): { ink: string; muted: string; accent: string } {
  const lums = surfaces.map((x) => lumOf(h, x.s, x.l))
  const worst = (l: number, s: number) => Math.min(...lums.map((bl) => contrast(lumOf(h, s, l), bl)))
  // ink: the theme's ink, pushed further from the background if needed
  let inkL = dark ? 91 : 13
  while (worst(inkL, 30) < 7 && (dark ? inkL < 99 : inkL > 2)) inkL += dark ? 1 : -1
  // muted: as soft as possible while still >= 4.5:1
  let mutedL = dark ? 58 : 40
  while (worst(mutedL, 16) < 4.6 && (dark ? mutedL < inkL : mutedL > inkL)) mutedL += dark ? 1 : -1
  // accent-coloured text (links, icons): the theme's accent, darker/lighter until it reads at 4.5:1 too
  let accL = dark ? 70 : 31
  while (Math.min(...lums.map((bl) => contrast(lumOf(32, 80, accL), bl))) < 4.6 && (dark ? accL < 95 : accL > 5)) accL += dark ? 1 : -1
  return { ink: hsl(h, 30, inkL), muted: hsl(h, 16, mutedL), accent: hsl(32, 80, accL) }
}

/** CSS variable values for the current theme. */
export function colorVars(c: CustomColors, dark: boolean): Record<string, string> {
  const v: Record<string, string> = {}
  if (active(c.bg_hue, c.bg_light)) {
    const h = c.bg_hue ?? DEFAULT_HUES.bg
    const L = bgLightness(c.bg_light ?? 0, dark)
    const s = dark
      ? { bg: [18, L], surface: [16, L + 3.5], surface2: [14, L + 8], line: [12, L + 14], glass: [14, L + 6] }
      : { bg: [42, L], surface: [50, Math.min(99.5, L + 4.5)], surface2: [30, L - 3], line: [26, L - 11], glass: [50, Math.min(99, L + 4)] }
    Object.assign(v, {
      '--sg-bg': hsl(h, s.bg[0], s.bg[1]), '--sg-surface': hsl(h, s.surface[0], s.surface[1]), '--sg-surface-2': hsl(h, s.surface2[0], s.surface2[1]),
      '--sg-line': hsl(h, s.line[0], s.line[1]), '--glass-fill': hsl(h, s.glass[0], s.glass[1]),
    })
    // text stays readable on the background and on both surfaces
    if ((c.bg_light ?? 0) !== 0) {
      const t = textFor(h, [{ s: s.bg[0], l: s.bg[1] }, { s: s.surface[0], l: s.surface[1] }, { s: s.surface2[0], l: s.surface2[1] }], dark)
      v['--sg-ink'] = t.ink
      v['--sg-muted'] = t.muted
      v['--sg-accent-strong'] = t.accent
    }
  }
  if (active(c.hg_hue, c.hg_light)) {
    const h = c.hg_hue ?? DEFAULT_HUES.hg, d = shift(c.hg_light)
    const line = dark ? hsl(h, 32, clamp(72 + d, 40, 92)) : hsl(h, 38, clamp(27 + d, 8, 60))
    Object.assign(v, { '--glass-line': line, '--rim': line, '--hg2-wall': dark ? hsl(h, 18, clamp(70 + d, 40, 92)) : hsl(h, 22, clamp(22 + d, 6, 60)) })
  }
  if (active(c.sand_hue, c.sand_light)) {
    const h = c.sand_hue ?? DEFAULT_HUES.sand, d = shift(c.sand_light)
    Object.assign(v, {
      '--sand-1': hsl(h, 78, clamp((dark ? 70 : 74) + d, 12, 95)),
      '--sand-2': hsl(h, 62, clamp((dark ? 60 : 57) + d, 10, 92)),
      '--sand-3': hsl(h, 58, clamp((dark ? 50 : 45) + d, 8, 88)),
      '--hg2-sand': dark ? hsl(h, 48, clamp(54 + d, 10, 90)) : hsl(h, 56, clamp(41 + d, 8, 88)),
    })
  }
  if (active(c.freeze_hue, c.freeze_light)) {
    const h = c.freeze_hue ?? DEFAULT_HUES.freeze, d = shift(c.freeze_light)
    v['--freeze'] = dark ? hsl(h, 70, clamp(68 + d, 25, 92)) : hsl(h, 78, clamp(60 + d, 20, 90))
  }
  return v
}

/** Writes the colours onto <html> for the current theme (and again whenever the theme changes). */
let liveTimer: ReturnType<typeof setTimeout> | undefined
/** Applies the colours at once everywhere: CSS colour transitions (the 0.8 s freeze/thaw) are switched off while colours change, so glass, frost, text and the canvas sand move together. */
export function applyColors(c: CustomColors = current) {
  current = c
  document.documentElement.dataset.live = '1'
  clearTimeout(liveTimer)
  liveTimer = setTimeout(() => { delete document.documentElement.dataset.live }, 400)
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
