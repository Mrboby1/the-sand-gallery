// User colours (Settings > Appearance): a hue and a brightness for the hourglass glass/outline, the sand, the app
// background and the freeze (paused) colour. null = the original colours from index.css. Brightness runs from black to
// white. The background decides light or dark text and surfaces (whatever the theme setting): body, muted and accent
// text keep >= 4.5:1 against the background and both surfaces, the hourglass outline >= 3:1, and the sand stays
// visible inside the glass.

export interface CustomColors {
  hg_hue: number | null; sand_hue: number | null; bg_hue: number | null; freeze_hue?: number | null
  /** Brightness -50..50 (0/null = normal). */
  hg_light?: number | null; sand_light?: number | null; bg_light?: number | null; freeze_light?: number | null
}

/** Luminance of the theme backgrounds from index.css (#f7f1e8 / #14110d). */
const THEME_BG_LUM = { light: 0.887, dark: 0.0059 } as const

/** Default hues, used when only the brightness is changed. */
export const DEFAULT_HUES = { hg: 29, sand: 32, bg: 36, freeze: 200 } as const

const KEY = 'sg.colors'
const VARS = [
  '--sg-bg', '--sg-surface', '--sg-surface-2', '--sg-line', '--sg-ink', '--sg-muted', '--sg-accent-strong', '--sg-accent-soft', 'color-scheme',
  '--glass-line', '--rim', '--hg2-wall', '--glass-fill',
  '--sand-1', '--sand-2', '--sand-3', '--hg2-sand', '--freeze', '--hg-halo',
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

const has = (v: number | null | undefined) => v !== null && v !== undefined
const active = (hue: number | null | undefined, light: number | null | undefined) => has(hue) || (has(light) && light !== 0)

/**
 * Lightness for a brightness value: -50 = black (0 %), 0 = the colour's normal lightness, +50 = white (100 %).
 */
export function lightness(base: number, b: number | null | undefined): number {
  const x = clamp(b ?? 0, -50, 50) / 50
  return x < 0 ? base * (1 + x) : base + (100 - base) * x
}

/**
 * Text colours on a background and its surfaces: an ink, a muted tone and an accent tone that all keep at least 4.5:1
 * against every one of them. `onDark`: light text (the background is dark), whatever the theme setting says.
 */
function textFor(h: number, surfaces: { h?: number; s: number; l: number }[], onDark: boolean): { ink: string; muted: string; accent: string } {
  const lums = surfaces.map((x) => lumOf(x.h ?? h, x.s, x.l))
  const worstAt = (hh: number, sat: number, l: number) => Math.min(...lums.map((bl) => contrast(lumOf(hh, sat, l), bl)))
  const step = onDark ? 1 : -1
  let inkL = onDark ? 91 : 13
  while (worstAt(h, 30, inkL) < 7 && (onDark ? inkL < 100 : inkL > 0)) inkL += step
  let mutedL = onDark ? 62 : 40
  while (worstAt(h, 16, mutedL) < 4.6 && (onDark ? mutedL < inkL : mutedL > inkL)) mutedL += step
  let accL = onDark ? 70 : 31
  while (worstAt(32, 80, accL) < 4.6 && (onDark ? accL < 100 : accL > 0)) accL += step
  return { ink: hsl(h, 30, inkL), muted: hsl(h, 16, mutedL), accent: hsl(32, 80, accL) }
}

/** Moves a colour's lightness away from a background until it reaches `min` contrast (or the end of the range). */
function separate(h: number, sat: number, l: number, bgLum: number, min: number): number {
  const ok = (x: number) => contrast(lumOf(h, sat, x), bgLum) >= min
  const walk = (dir: number) => { let x = l; while (!ok(x)) { const nx = x + dir; if (nx < 0 || nx > 100) return null; x = nx } return x }
  const first = lumOf(h, sat, l) >= bgLum ? 1 : -1
  return walk(first) ?? walk(-first) ?? l
}

/** CSS variable values for the current theme. */
export function colorVars(c: CustomColors, dark: boolean): Record<string, string> {
  const v: Record<string, string> = {}
  // which way the background goes decides light/dark text and surfaces (not the theme setting)
  let onDark = dark
  let bgLum = -1
  let glassL = -1, glassH = 0, glassS = 0
  if (active(c.bg_hue, c.bg_light)) {
    const h = c.bg_hue ?? DEFAULT_HUES.bg
    let L = lightness(dark ? 7 : 94, c.bg_light)
    const satOf = (l: number) => (l < 50 ? 18 : 42)
    const lumL = (l: number) => lumOf(h, satOf(l), l)
    onDark = contrast(lumL(L), 1) > contrast(lumL(L), 0) // white text reads better than black
    // cards and tints sit a little towards the text colour; at the end of the range they flip to the other side
    const surfacesAt = (l: number) => onDark
      ? (l <= 88
        ? { surface: [16, l + 3.5], surface2: [14, l + 7], line: [12, l + 13], glass: [14, l + 5], soft: [35, l + 9] }
        : { surface: [16, l - 3.5], surface2: [14, l - 7], line: [12, l - 13], glass: [14, l - 5], soft: [35, l - 9] })
      : (l >= 10
        ? { surface: [50, Math.min(100, l + 4.5)], surface2: [30, l - 3], line: [26, l - 11], glass: [50, Math.min(100, l + 4)], soft: [70, l - 5] }
        : { surface: [50, l + 4.5], surface2: [30, l + 7], line: [26, l + 13], glass: [50, l + 4], soft: [70, l + 9] })
    // the text must reach 4.6:1 against the background and every surface: nudge mid tones away from the text
    const worstFor = (l: number) => {
      const sf0 = surfacesAt(l)
      const ls = [lumL(l), ...[sf0.surface, sf0.surface2].map((x) => lumOf(h, x[0], clamp(x[1], 0, 100))), lumOf(32, sf0.soft[0], clamp(sf0.soft[1], 0, 100))]
      return Math.min(...ls.map((x) => contrast(x, onDark ? 1 : 0)))
    }
    while (worstFor(L) < 4.6 && L > 0 && L < 100) L += onDark ? -1 : 1
    const sat = satOf(L)
    bgLum = lumL(L)
    const sf = surfacesAt(L)
    const px = (x: number[]) => hsl(h, x[0], clamp(x[1], 0, 100))
    Object.assign(v, {
      '--sg-bg': hsl(h, sat, L), '--sg-surface': px(sf.surface), '--sg-surface-2': px(sf.surface2), '--sg-line': px(sf.line), '--glass-fill': px(sf.glass),
    })
    glassL = clamp(sf.glass[1], 0, 100); glassH = h; glassS = sf.glass[0]
    if ((c.bg_light ?? 0) !== 0 || onDark !== dark) {
      // text (and the soft accent tint behind accent text) stays readable on the background and both surfaces
      const surfaces = [{ s: sat, l: L }, { s: sf.surface[0], l: clamp(sf.surface[1], 0, 100) }, { s: sf.surface2[0], l: clamp(sf.surface2[1], 0, 100) }]
      const softL = clamp(sf.soft[1], 0, 100)
      v['--sg-accent-soft'] = hsl(32, sf.soft[0], softL)
      const t = textFor(h, [...surfaces, { h: 32, s: sf.soft[0], l: softL }], onDark)
      v['--sg-ink'] = t.ink
      v['--sg-muted'] = t.muted
      v['--sg-accent-strong'] = t.accent
      v['color-scheme'] = onDark ? 'dark' : 'light'
    }
  }
  // the hourglass outline is exactly the chosen colour/brightness; if it would get lost against the background
  // (< 3:1, the bar for graphics), a thin halo in the opposite tone keeps its shape visible
  if (active(c.hg_hue, c.hg_light) || bgLum >= 0) {
    const h = c.hg_hue ?? DEFAULT_HUES.hg
    const base = onDark ? 72 : 27, wallBase = onDark ? 70 : 22
    const ls = onDark ? 32 : 38, ws = onDark ? 18 : 22
    const line = lightness(base, c.hg_light), wall = lightness(wallBase, c.hg_light)
    const lc = hsl(h, ls, line)
    Object.assign(v, { '--glass-line': lc, '--rim': lc, '--hg2-wall': hsl(h, ws, wall) })
    const back = bgLum >= 0 ? bgLum : dark ? THEME_BG_LUM.dark : THEME_BG_LUM.light
    if (Math.min(contrast(lumOf(h, ls, line), back), contrast(lumOf(h, ws, wall), back)) < 3) {
      // halo colour: whichever of near-white / near-black stands out more against the background
      const halo = contrast(1, back) >= contrast(0, back) ? 'rgb(255 255 255 / 0.9)' : 'rgb(0 0 0 / 0.85)'
      v['--hg-halo'] = `drop-shadow(0 0 0.6px ${halo}) drop-shadow(0 0 1.4px ${halo})`
    }
  }
  if (active(c.sand_hue, c.sand_light) || glassL >= 0) {
    const h = c.sand_hue ?? DEFAULT_HUES.sand
    let mid = lightness(onDark ? 60 : 57, c.sand_light)
    // the sand stays visible inside the glass (>= 1.6:1 against the glass fill)
    if (glassL >= 0) mid = separate(h, 62, mid, lumOf(glassH, glassS, glassL), 1.7)
    Object.assign(v, {
      '--sand-1': hsl(h, 78, clamp(mid + 14, 0, 100)),
      '--sand-2': hsl(h, 62, mid),
      '--sand-3': hsl(h, 58, clamp(mid - 11, 0, 100)),
      '--hg2-sand': hsl(h, onDark ? 48 : 56, clamp(mid - (onDark ? 6 : 16), 0, 100)),
    })
  }
  if (active(c.freeze_hue, c.freeze_light)) {
    const h = c.freeze_hue ?? DEFAULT_HUES.freeze
    v['--freeze'] = dark ? hsl(h, 70, lightness(68, c.freeze_light)) : hsl(h, 78, lightness(60, c.freeze_light))
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
