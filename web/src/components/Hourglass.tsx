import { useId } from 'react'
import { useStyle } from '../lib/theme'

/**
 * The Sand Gallery hourglass: open at BOTH ends, so it is clearly bottomless. Sand pours in from
 * above the top rim, piles in the upper bulb, streams through the neck and falls OUT of the open
 * bottom, fading away below it, forever. While `running` is false every animation freezes in place.
 *
 * `detail="full"` draws the falling sand outside the glass (taller drawing, 120x236 units);
 * `detail="lite"` is a compact glyph for chips and icons (120x160 units).
 */
interface Grain { x: number; d: number; delay: number; r: number; dx: number; dy: number }

/** Small deterministic PRNG so the "random" grains are identical on every render (no flicker). */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

/**
 * Grains pouring in above the top opening: a nearly straight line with a little jitter, evenly spaced in
 * time (negative delays spread them along the path from the first frame).
 */
function makeIncoming(n: number, rMin: number, rMax: number, seed: number, top: number, endY = 48): Grain[] {
  const r = rng(seed)
  const d = 1.25
  return Array.from({ length: n }, (_, i) => ({
    x: 60 + (r() - 0.5) * 2.2,
    d: d * (0.92 + r() * 0.16),
    delay: -((i + r() * 0.35) / n) * d,
    r: rMin + r() * (rMax - rMin),
    dx: (r() - 0.5) * 1.2,
    dy: endY - (top + 2),
  }))
}

/** Grains leaving through the neck at the same steady rhythm, each at a slightly random angle, so they fan out below. */
function makeOutgoing(n: number, rMin: number, rMax: number, seed: number, fall: number, spread: number): Grain[] {
  const r = rng(seed)
  const d = 1.4
  return Array.from({ length: n }, (_, i) => ({
    x: 60 + (r() - 0.5) * 1.5,
    d: d * (0.9 + r() * 0.2),
    delay: -((i + r() * 0.3) / n) * d,
    r: rMin + r() * (rMax - rMin),
    dx: (r() - 0.5) * 2 * spread,
    dy: fall * (0.9 + r() * 0.1),
  }))
}

const INCOMING_FULL = makeIncoming(16, 0.7, 1.15, 7, -38)
const OUTGOING_FULL = makeOutgoing(30, 0.65, 1.1, 11, 238 - 38 - 2 - 82, 16)
const INCOMING_LITE = makeIncoming(3, 2, 2.4, 3, 0)
const OUTGOING_LITE = makeOutgoing(4, 2, 2.4, 5, 158 - 82, 5)
// 2D style: grains land on the top of the sand mound (higher than the funnel of the other styles)
const INCOMING_2D_FULL = makeIncoming(16, 0.7, 1.15, 7, -38, 42)
const INCOMING_2D_LITE = makeIncoming(3, 2, 2.4, 3, 0, 42)

interface Slider { x: number; y: number; dx: number; dy: number; d: number; delay: number; r: number }
/** Surface grains: start on the slope, slide to the crater at (60, craterY), slowly and staggered. */
function makeSliders(starts: [number, number][], craterY: number, seed: number): Slider[] {
  const r = rng(seed)
  return starts.map(([x, y], i) => ({
    x, y,
    dx: 60 + (r() - 0.5) * 2 - x,
    dy: craterY - y,
    d: 2.2 + r() * 1.4,
    delay: -((i + r() * 0.5) / starts.length) * 3,
    r: 0.75 + r() * 0.35,
  }))
}
// classic surface: y(x) = 38 + 48·t·(1−t), t = x/120 (a funnel whose lowest point, the crater, is above the neck)
const SLIDERS_CLASSIC = makeSliders([[34, 47.7], [40, 48.7], [46, 49.4], [74, 49.4], [80, 48.7], [86, 47.7], [37, 48.2], [83, 48.2]], 50.8, 21)
// 2D: a mound with a small crater on top
const SLIDERS_2D = makeSliders([[38, 37.6], [43, 37.4], [48, 38.6], [72, 38.6], [77, 37.4], [82, 37.6]], 43.2, 23)

function SurfaceSliders({ list, fill }: { list: Slider[]; fill: string }) {
  return (
    <>
      {list.map((g, i) => (
        <circle key={i} className="slide" cx={g.x} cy={g.y} r={g.r} fill={fill}
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dx' as string]: `${g.dx}px`, ['--dy' as string]: `${g.dy}px` }} />
      ))}
    </>
  )
}

/**
 * "2D" style (Gabi's sketch): just two walls that pinch at the neck, no top or bottom cap, a flat sand
 * mound in the upper half, darker muted colours. Same grains: fading in above, fading out below.
 */
function Hourglass2D({ running, size, className, title, detail }: { running: boolean; size: number; className: string; title?: string; detail: 'full' | 'lite' }) {
  const uid = useId().replace(/[:«»]/g, '')
  const clip = `hg2-clip-${uid}`
  const full = detail === 'full'
  const top = full ? -38 : 0
  const height = full ? 238 : 160
  const incoming = full ? INCOMING_2D_FULL : INCOMING_2D_LITE
  const outgoing = full ? OUTGOING_FULL : OUTGOING_LITE
  const leftWall = 'M 30 14 L 30 44 C 30 64 55 69 56.5 80 C 55 91 30 96 30 116 L 30 146'
  const rightWall = 'M 90 14 L 90 44 C 90 64 65 69 63.5 80 C 65 91 90 96 90 116 L 90 146'
  const inside = 'M 30 14 L 30 44 C 30 64 55 69 56.5 80 C 55 91 30 96 30 116 L 30 146 L 90 146 L 90 116 C 90 96 65 91 63.5 80 C 65 69 90 64 90 44 L 90 14 Z'
  const sw = full ? 3.6 : 6
  return (
    <svg
      viewBox={`0 ${top} 120 ${height}`}
      width={size}
      height={(size * height) / 120}
      className={`hg ${running ? 'running' : 'paused'} ${className}`}
      role="img"
      aria-label={title ?? (running ? 'Timer running' : 'Timer paused')}
      overflow="visible"
    >
      <defs><clipPath id={clip}><path d={inside} /></clipPath></defs>
      {/* the sand mound in the upper half, flat colour */}
      <g clipPath={`url(#${clip})`}>
        <path d="M 0 54 C 20 38 40 34 52 40 Q 60 46 68 40 C 80 34 100 38 120 54 L 120 84 L 0 84 Z" fill="var(--hg2-sand)" />
        {/* the crater where the sand drains into the neck */}
        <ellipse cx="60" cy="43.4" rx="4.2" ry="1.3" fill="#000" opacity="0.14" />
        {full && <SurfaceSliders list={SLIDERS_2D} fill="rgba(0,0,0,0.26)" />}
      </g>
      {incoming.map((g, i) => (
        <circle key={`i${i}`} className="grain in" cx={g.x} cy={top + 2} r={g.r} fill="var(--hg2-sand)"
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${g.dy}px`, ['--dx' as string]: `${g.dx}px` }} />
      ))}
      {outgoing.map((g, i) => (
        <circle key={`o${i}`} className="grain" cx={g.x} cy={82} r={g.r} fill="var(--hg2-sand)"
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${g.dy}px`, ['--dx' as string]: `${g.dx}px` }} />
      ))}
      {/* two bare walls: open at the top and at the bottom */}
      <path d={leftWall} fill="none" stroke="var(--hg2-wall)" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <path d={rightWall} fill="none" stroke="var(--hg2-wall)" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Hourglass({
  running = false,
  size = 48,
  className = '',
  title,
  detail = 'full',
}: {
  running?: boolean
  /** Width in px; the height follows the drawing's aspect ratio. */
  size?: number
  className?: string
  title?: string
  detail?: 'full' | 'lite'
}) {
  const style = useStyle()
  if (style === 'line') return <Hourglass2D running={running} size={size} className={className} title={title} detail={detail} />
  return <HourglassClassic running={running} size={size} className={className} title={title} detail={detail} />
}

function HourglassClassic({ running, size, className, title, detail }: { running: boolean; size: number; className: string; title?: string; detail: 'full' | 'lite' }) {
  const uid = useId().replace(/[:«»]/g, '')
  const clip = `hg-clip-${uid}`
  const sand = `hg-sand-${uid}`
  const glass = `hg-glass-${uid}`
  const glow = `hg-glowg-${uid}`
  const full = detail === 'full'
  const top = full ? -38 : 0
  const height = full ? 238 : 160
  const bottom = top + height
  void bottom

  const incoming = full ? INCOMING_FULL : INCOMING_LITE
  const outgoing = full ? OUTGOING_FULL : OUTGOING_LITE
  const inStart = top + 2
  const outStart = 82

  const interior =
    'M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 L 94 142 C 94 108 64 94 63.5 80 C 64 66 94 52 94 18 Z'

  return (
    <svg
      viewBox={`0 ${top} 120 ${height}`}
      width={size}
      height={(size * height) / 120}
      className={`hg ${running ? 'running' : 'paused'} ${className}`}
      role="img"
      aria-label={title ?? (running ? 'Timer running' : 'Timer paused')}
      overflow="visible"
    >
      <defs>
        <clipPath id={clip}>
          <path d={interior} />
        </clipPath>
        <linearGradient id={sand} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sand-1)" />
          <stop offset="0.55" stopColor="var(--sand-2)" />
          <stop offset="1" stopColor="var(--sand-3)" />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--glass-1)" />
          <stop offset="0.5" stopColor="var(--glass-2)" />
          <stop offset="1" stopColor="var(--glass-1)" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--sand-1)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--sand-1)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* glossy style only: warm glow while running */}
      {running && <ellipse className="glow gloss-only" cx="60" cy="80" rx="48" ry="70" fill={`url(#${glow})`} />}

      {/* glass body: flat fill, or a glassy gradient in the glossy style */}
      <path className="flat-only" d={interior} fill="var(--glass-fill)" />
      <path className="gloss-only" d={interior} fill={`url(#${glass})`} />

      {/* the pile in the upper bulb */}
      <g clipPath={`url(#${clip})`}>
        <path className="flat-only" d="M 0 38 Q 60 62 120 38 L 120 84 L 0 84 Z" fill="var(--sand-2)" />
        <g className="gloss-only">
          <path d="M 0 38 Q 60 62 120 38 L 120 84 L 0 84 Z" fill={`url(#${sand})`} />
          <path d="M 30 44 Q 60 58 90 44" fill="none" stroke="var(--sand-1)" strokeOpacity="0.7" strokeWidth="1.2" />
        </g>
        {/* the crater above the neck, and grains sliding into it */}
        <ellipse cx="60" cy="50.9" rx="5" ry="1.4" fill="#000" opacity="0.13" />
        {full && <SurfaceSliders list={SLIDERS_CLASSIC} fill="var(--sand-3)" />}
      </g>

      {incoming.map((g, i) => (
        <circle
          key={`i${i}`}
          className="grain in"
          cx={g.x}
          cy={inStart}
          r={g.r}
          fill="var(--sand-2)"
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${g.dy}px`, ['--dx' as string]: `${g.dx}px` }}
        />
      ))}
      {outgoing.map((g, i) => (
        <circle
          key={`o${i}`}
          className="grain"
          cx={g.x}
          cy={outStart}
          r={g.r}
          fill="var(--sand-2)"
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${g.dy}px`, ['--dx' as string]: `${g.dx}px` }}
        />
      ))}

      {/* glass outline */}
      <path
        d="M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 M 94 18 C 94 52 64 66 63.5 80 C 64 94 94 108 94 142"
        fill="none"
        stroke="var(--glass-line)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* glossy style only: shine on the glass */}
      <g className="gloss-only">
        <path d="M 33 26 C 33 46 44 58 51 66" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
        <path d="M 33 134 C 33 116 42 104 49 97" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />
      </g>

      {/* open rims, top and bottom */}
      <ellipse cx="60" cy="18" rx="35" ry="6" fill="none" stroke="var(--rim)" strokeWidth="3.2" />
      <ellipse cx="60" cy="142" rx="35" ry="6" fill="none" stroke="var(--rim)" strokeWidth="3.2" />
    </svg>
  )
}

/** Tiny glyph for chips and labels. */
export function HourglassGlyph({ size = 14, running = false, className = '' }: { size?: number; running?: boolean; className?: string }) {
  return <Hourglass size={size} running={running} detail="lite" className={className} />
}
