import { useId } from 'react'

/**
 * The Sand Gallery hourglass: open at BOTH ends, so it is clearly bottomless. Sand pours in from
 * above the top rim, piles in the upper bulb, streams through the neck and falls OUT of the open
 * bottom, fading away below it, forever. While `running` is false every animation freezes in place.
 *
 * `detail="full"` draws the falling sand outside the glass (taller drawing, 120x236 units);
 * `detail="lite"` is a compact glyph for chips and icons (120x160 units).
 */
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
  const fadeIn = `hg-fin-${uid}`
  const fadeOut = `hg-fout-${uid}`
  const sand = `hg-sand-${uid}`
  const glass = `hg-glass-${uid}`
  const glow = `hg-glowg-${uid}`
  const full = detail === 'full'
  const top = full ? -38 : 0
  const height = full ? 238 : 160
  const bottom = top + height

  // Grains pouring in from above the open top, down to the sand surface (~y 48).
  const incoming = full
    ? [
        { x: 60, d: 1.2, delay: 0, r: 1.9, dx: 0 },
        { x: 58.4, d: 1.35, delay: -0.4, r: 1.5, dx: 0.6 },
        { x: 61.6, d: 1.15, delay: -0.8, r: 1.6, dx: -0.5 },
        { x: 59.3, d: 1.45, delay: -0.2, r: 1.3, dx: 0.3 },
        { x: 60.8, d: 1.25, delay: -0.65, r: 1.4, dx: -0.2 },
        { x: 60.2, d: 1.3, delay: -1.0, r: 1.7, dx: 0 },
      ]
    : [
        { x: 60, d: 1.0, delay: 0, r: 2.4, dx: 0 },
        { x: 60, d: 1.0, delay: -0.5, r: 2.4, dx: 0 },
      ]
  // Grains falling from the neck, out through the open bottom and away below it, spreading a little.
  const outgoing = full
    ? [
        { x: 60, d: 1.25, delay: 0, r: 1.9, dx: 0 },
        { x: 59.2, d: 1.4, delay: -0.3, r: 1.5, dx: -5 },
        { x: 60.8, d: 1.3, delay: -0.6, r: 1.6, dx: 6 },
        { x: 59.6, d: 1.5, delay: -0.9, r: 1.3, dx: -9 },
        { x: 60.4, d: 1.2, delay: -0.45, r: 1.7, dx: 3 },
        { x: 59.9, d: 1.55, delay: -1.15, r: 1.2, dx: 10 },
        { x: 60.1, d: 1.35, delay: -0.15, r: 1.4, dx: -2 },
        { x: 60.3, d: 1.45, delay: -0.75, r: 1.1, dx: -12 },
        { x: 59.7, d: 1.3, delay: -1.05, r: 1.2, dx: 13 },
      ]
    : [
        { x: 60, d: 0.9, delay: 0, r: 2.4, dx: 0 },
        { x: 60, d: 0.9, delay: -0.45, r: 2.4, dx: 0 },
      ]
  const inStart = top + 2
  const inEnd = 48
  const outStart = 82
  const outEnd = bottom - 2

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
        <linearGradient id={fadeIn} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2={inEnd}>
          <stop offset="0" stopColor="var(--sand-2)" stopOpacity="0" />
          <stop offset="0.35" stopColor="var(--sand-2)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--sand-2)" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={fadeOut} gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2={bottom}>
          <stop offset="0" stopColor="var(--sand-2)" stopOpacity="1" />
          <stop offset={full ? '0.55' : '0.8'} stopColor="var(--sand-2)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--sand-2)" stopOpacity="0" />
        </linearGradient>
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

      {/* streams: pouring in from above, and from the neck out of the bottom and away */}
      <line className="stream" x1="60" y1={top} x2="60" y2={inEnd} stroke={`url(#${fadeIn})`} strokeWidth={full ? 2.3 : 3} strokeLinecap="round" strokeDasharray="3 3.5" />
      <line className="stream" x1="60" y1="60" x2="60" y2={bottom} stroke={`url(#${fadeOut})`} strokeWidth={full ? 2.3 : 3} strokeLinecap="round" strokeDasharray="3 3.5" />

      {incoming.map((g, i) => (
        <circle
          key={`i${i}`}
          className="grain"
          cx={g.x}
          cy={inStart}
          r={g.r}
          fill="var(--sand-2)"
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${inEnd - inStart}px`, ['--dx' as string]: `${g.dx}px` }}
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
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${outEnd - outStart}px`, ['--dx' as string]: `${g.dx}px` }}
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
