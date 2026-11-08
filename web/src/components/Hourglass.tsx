import { useId } from 'react'

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
function makeIncoming(n: number, rMin: number, rMax: number, seed: number, top: number): Grain[] {
  const r = rng(seed)
  const d = 1.25
  return Array.from({ length: n }, (_, i) => ({
    x: 60 + (r() - 0.5) * 2.2,
    d: d * (0.92 + r() * 0.16),
    delay: -((i + r() * 0.35) / n) * d,
    r: rMin + r() * (rMax - rMin),
    dx: (r() - 0.5) * 1.2,
    dy: 48 - (top + 2),
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
        <path className="surface flat-only" d="M 0 38 Q 60 62 120 38 L 120 84 L 0 84 Z" fill="var(--sand-2)" />
        <g className="gloss-only">
          <path className="surface" d="M 0 38 Q 60 62 120 38 L 120 84 L 0 84 Z" fill={`url(#${sand})`} />
          <path d="M 30 44 Q 60 58 90 44" fill="none" stroke="var(--sand-1)" strokeOpacity="0.7" strokeWidth="1.2" />
        </g>
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
