import { useId } from 'react'

/**
 * The Sand Gallery hourglass: open at BOTH ends, so sand pours in at the top, piles in the
 * upper bulb, streams through the neck and falls out of the bottom forever. While `running`
 * is false every animation freezes in place (animation-play-state: paused).
 */
export function Hourglass({
  running = false,
  size = 48,
  className = '',
  title,
  detail = 'full',
}: {
  running?: boolean
  size?: number
  className?: string
  title?: string
  /** 'full' for big displays, 'lite' drops some grains for tiny sizes. */
  detail?: 'full' | 'lite'
}) {
  const uid = useId().replace(/[:«»]/g, '')
  const clip = `hg-clip-${uid}`
  const sand = `hg-sand-${uid}`
  const glass = `hg-glass-${uid}`
  const fade = `hg-fade-${uid}`
  const glow = `hg-glowg-${uid}`

  // Incoming grains (above the top opening down to the sand surface).
  const incoming = detail === 'full'
    ? [
        { x: 60, d: 1.0, delay: 0, dy: 50, r: 1.5 },
        { x: 58.2, d: 1.15, delay: -0.35, dy: 48, r: 1.2 },
        { x: 61.8, d: 0.95, delay: -0.7, dy: 49, r: 1.3 },
        { x: 59.2, d: 1.25, delay: -0.15, dy: 50, r: 1.0 },
        { x: 60.9, d: 1.05, delay: -0.55, dy: 47, r: 1.1 },
      ]
    : [
        { x: 60, d: 1.0, delay: 0, dy: 50, r: 2 },
        { x: 60, d: 1.0, delay: -0.5, dy: 50, r: 2 },
      ]
  // Outgoing grains (from the neck out through the bottom opening).
  const outgoing = detail === 'full'
    ? [
        { x: 60, d: 0.9, delay: 0, dy: 74, r: 1.4 },
        { x: 58.6, d: 1.05, delay: -0.3, dy: 76, r: 1.1 },
        { x: 61.4, d: 0.95, delay: -0.6, dy: 75, r: 1.2 },
        { x: 59.4, d: 1.1, delay: -0.8, dy: 77, r: 1.0 },
        { x: 60.7, d: 0.85, delay: -0.45, dy: 74, r: 1.3 },
        { x: 57.9, d: 1.2, delay: -0.1, dy: 78, r: 0.9 },
        { x: 62.1, d: 1.2, delay: -0.95, dy: 78, r: 0.9 },
      ]
    : [
        { x: 60, d: 0.9, delay: 0, dy: 74, r: 2 },
        { x: 60, d: 0.9, delay: -0.45, dy: 74, r: 2 },
      ]

  const interior =
    'M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 L 94 142 C 94 108 64 94 63.5 80 C 64 66 94 52 94 18 Z'

  return (
    <svg
      viewBox="0 0 120 160"
      width={size}
      height={(size * 160) / 120}
      className={`hg ${running ? 'running' : 'paused'} ${className}`}
      role="img"
      aria-label={title ?? (running ? 'Timer running' : 'Timer paused')}
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
        <linearGradient id={fade} gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="158">
          <stop offset="0" stopColor="var(--sand-2)" stopOpacity="1" />
          <stop offset="0.75" stopColor="var(--sand-2)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--sand-2)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--sand-1)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--sand-1)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {running && <ellipse className="glow" cx="60" cy="80" rx="46" ry="62" fill={`url(#${glow})`} />}

      {/* glass body */}
      <path d={interior} fill={`url(#${glass})`} />

      {/* sand inside the glass */}
      <g clipPath={`url(#${clip})`}>
        <path className="surface" d="M 0 38 Q 60 62 120 38 L 120 84 L 0 84 Z" fill={`url(#${sand})`} />
        <path d="M 30 44 Q 60 58 90 44" fill="none" stroke="var(--sand-1)" strokeOpacity="0.7" strokeWidth="1.2" />
      </g>

      {/* the stream through the neck and out of the bottom */}
      <line
        className="stream"
        x1="60" y1="60" x2="60" y2="156"
        stroke={`url(#${fade})`}
        strokeWidth={detail === 'full' ? 1.6 : 3}
        strokeLinecap="round"
        strokeDasharray="3 3"
      />

      {/* falling grains */}
      {incoming.map((g, i) => (
        <circle
          key={`i${i}`}
          className="grain"
          cx={g.x}
          cy={2}
          r={g.r}
          fill="var(--sand-2)"
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${g.dy}px` }}
        />
      ))}
      {outgoing.map((g, i) => (
        <circle
          key={`o${i}`}
          className="grain"
          cx={g.x}
          cy={82}
          r={g.r}
          fill="var(--sand-2)"
          style={{ ['--d' as string]: `${g.d}s`, ['--delay' as string]: `${g.delay}s`, ['--dy' as string]: `${g.dy}px` }}
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
      {/* shine */}
      <path d="M 33 26 C 33 46 44 58 51 66" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M 33 134 C 33 116 42 104 49 97" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />

      {/* open rims, top and bottom */}
      <ellipse cx="60" cy="18" rx="35" ry="6" fill="none" stroke="var(--rim)" strokeWidth="3.2" />
      <ellipse cx="60" cy="142" rx="35" ry="6" fill="none" stroke="var(--rim)" strokeWidth="3.2" />
    </svg>
  )
}

/** Tiny static glyph for chips and labels. */
export function HourglassGlyph({ size = 14, running = false, className = '' }: { size?: number; running?: boolean; className?: string }) {
  return <Hourglass size={size} running={running} detail="lite" className={className} />
}
