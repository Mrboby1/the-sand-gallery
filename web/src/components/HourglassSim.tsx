import { useEffect, useId, useRef, useState } from 'react'
import { SandSim, type SimShape } from '../lib/sandSim'
import type { StylePref } from '../lib/theme'

const CLASSIC_INTERIOR = 'M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 L 94 142 C 94 108 64 94 63.5 80 C 64 66 94 52 94 18 Z'
const LINE_INTERIOR = 'M 30 14 L 30 44 C 30 64 55 69 56.5 80 C 55 91 30 96 30 116 L 30 146 L 90 146 L 90 116 C 90 96 65 91 63.5 80 C 65 69 90 64 90 44 L 90 14 Z'
const TOP = -38
const HEIGHT = 238

const SHAPES: Record<'classic' | 'line', SimShape> = {
  classic: { interior: CLASSIC_INTERIOR, top: TOP, height: HEIGHT, glassTop: 18, glassBottom: 142, neckY: 80, level: 36 },
  line: { interior: LINE_INTERIOR, top: TOP, height: HEIGHT, glassTop: 14, glassBottom: 146, neckY: 80, level: 38 },
}
const STEP_MS = 1000 / 30

/**
 * The big hourglass with real moving grains (see lib/sandSim.ts): glass behind, a canvas of grains in the
 * middle, outlines in front. Runs only while the timer runs AND the hourglass is on screen; frozen otherwise;
 * a still picture with prefers-reduced-motion.
 */
export function HourglassSim({ style, running, size, className = '', title, fill = 1 }: { style: StylePref; running: boolean; size: number; className?: string; title?: string; fill?: number }) {
  const uid = useId().replace(/[:«»]/g, '')
  const canvas = useRef<HTMLCanvasElement>(null)
  const sim = useRef<SandSim | null>(null)
  const fillRef = useRef(fill)
  fillRef.current = fill
  const [visible, setVisible] = useState(true)
  const kind = style === 'line' ? 'line' : 'classic'
  const shape = SHAPES[kind]
  const h = (size * HEIGHT) / 120

  const frost = useRef(running ? 0 : 1)
  const paint = (s: SandSim) => {
    const cs = getComputedStyle(document.documentElement)
    s.setColor(cs.getPropertyValue(kind === 'line' ? '--hg2-sand' : '--sand-2').trim() || '#d99a4e', cs.getPropertyValue('--freeze').trim() || '#5ab4e6', frost.current)
  }

  // build the simulation for this size/style and draw the first (settled) frame
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ppu = size / 120 // CSS px per viewBox unit
    c.width = Math.round(size * dpr)
    c.height = Math.round(h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(ppu * dpr, 0, 0, ppu * dpr, 0, -TOP * ppu * dpr)
    // grains about 2 CSS px wide, whatever the size of the hourglass
    const cell = Math.min(3.6, Math.max(1.1, 2.2 / ppu))
    const s = new SandSim(shape, cell, 7 + size, fillRef.current)
    s.prewarm(220)
    paint(s)
    s.draw(ctx)
    sim.current = s
  }, [size, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // the pile follows the item's total time
  useEffect(() => { sim.current?.setTarget(fill) }, [fill])

  // colours follow the sliders / theme at once (no restart, the pile stays as it is)
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const mo = new MutationObserver(() => { if (sim.current) { paint(sim.current); sim.current.draw(ctx) } })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'data-style'] })
    return () => mo.disconnect()
  }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // freezing / thawing: the grains blend toward the freeze colour over ~0.8 s (a few frames, then nothing runs)
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const from = frost.current, to = running ? 0 : 1
    if (from === to) return
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 800)
      frost.current = from + (to - from) * k
      if (sim.current) { paint(sim.current); if (!running) sim.current.draw(ctx) }
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  // pause when scrolled out of view
  useEffect(() => {
    const c = canvas.current
    if (!c || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting))
    io.observe(c)
    return () => io.disconnect()
  }, [])

  // the loop: fixed 30 steps per second, only while running and visible
  useEffect(() => {
    const c = canvas.current
    if (!c || !running || !visible) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = c.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let acc = 0
    const hidden = () => document.body.dataset.fsTimer === '1' && !c.closest('[data-fullscreen-timer]') // covered by the fullscreen timer
    const frame = (now: number) => {
      acc += Math.min(now - last, 250)
      last = now
      let stepped = false
      if (hidden()) { acc = 0; raf = requestAnimationFrame(frame); return }
      for (let n = 0; acc >= STEP_MS && n < 3; n++) { sim.current?.step(); acc -= STEP_MS; stepped = true }
      if (stepped) sim.current?.draw(ctx)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running, visible, size, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const outline = kind === 'classic'
    ? 'M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 M 94 18 C 94 52 64 66 63.5 80 C 64 94 94 108 94 142'
    : null
  return (
    <span className={`hg relative inline-block ${running ? 'running' : 'frozen'} ${className}`} style={{ width: size, height: h }} role="img" aria-label={title ?? (running ? 'Timer running' : 'Timer paused')}>
      {/* behind: the glass */}
      <svg viewBox={`0 ${TOP} 120 ${HEIGHT}`} width={size} height={h} className="absolute inset-0" aria-hidden overflow="visible">
        {kind === 'classic' && (
          <>
            <defs>
              <linearGradient id={`hgs-glass-${uid}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--glass-1)" /><stop offset="0.5" stopColor="var(--glass-2)" /><stop offset="1" stopColor="var(--glass-1)" />
              </linearGradient>
              <radialGradient id={`hgs-glow-${uid}`} cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="var(--sand-1)" stopOpacity="0.9" /><stop offset="1" stopColor="var(--sand-1)" stopOpacity="0" />
              </radialGradient>
            </defs>
            {running && <ellipse className="glow gloss-only" cx="60" cy="80" rx="48" ry="70" fill={`url(#hgs-glow-${uid})`} />}
            <path className="flat-only" d={CLASSIC_INTERIOR} fill="var(--glass-fill)" />
            <path className="gloss-only" d={CLASSIC_INTERIOR} fill={`url(#hgs-glass-${uid})`} />
          </>
        )}
      </svg>
      {/* the grains */}
      <canvas ref={canvas} className="absolute inset-0" style={{ width: size, height: h }} />
      {/* frost (only visible when paused): an icy tint over glass and sand, frosted edges, a few crystals */}
      <Frost uid={uid} interior={kind === 'classic' ? CLASSIC_INTERIOR : LINE_INTERIOR} kind={kind} size={size} h={h} />
      {/* in front: outline, rims, shine */}
      <svg viewBox={`0 ${TOP} 120 ${HEIGHT}`} width={size} height={h} className="absolute inset-0" aria-hidden overflow="visible">
        {outline ? (
          <>
            <path d={outline} fill="none" stroke="var(--hg-line-eff)" strokeWidth="2.2" strokeLinecap="round" />
            <g className="gloss-only">
              <path d="M 33 26 C 33 46 44 58 51 66" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
              <path d="M 33 134 C 33 116 42 104 49 97" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />
            </g>
            <ellipse cx="60" cy="18" rx="35" ry="6" fill="none" stroke="var(--hg-rim-eff)" strokeWidth="3.2" />
            <ellipse cx="60" cy="142" rx="35" ry="6" fill="none" stroke="var(--hg-rim-eff)" strokeWidth="3.2" />
          </>
        ) : (
          <>
            <path d="M 30 14 L 30 44 C 30 64 55 69 56.5 80 C 55 91 30 96 30 116 L 30 146" fill="none" stroke="var(--hg2-wall-eff)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 90 14 L 90 44 C 90 64 65 69 63.5 80 C 65 91 90 96 90 116 L 90 146" fill="none" stroke="var(--hg2-wall-eff)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </span>
  )
}

// crystals near the inner walls (x, y, size) for each glass shape
const CRYSTALS: Record<'classic' | 'line', [number, number, number][]> = {
  classic: [[30, 26, 3], [33, 44, 2.4], [43, 58, 2], [52, 70, 1.6], [52, 92, 1.6], [42, 104, 2], [33, 118, 2.4], [30, 134, 3], [90, 30, 2.6], [86, 46, 2.2], [76, 60, 1.8], [68, 72, 1.5], [68, 90, 1.5], [78, 102, 1.9], [87, 118, 2.3], [90, 132, 2.8]],
  line: [[34, 22, 3], [34, 40, 2.4], [44, 60, 2], [52, 72, 1.6], [52, 90, 1.6], [42, 100, 2], [34, 120, 2.4], [34, 138, 3], [86, 26, 2.6], [86, 42, 2.2], [76, 62, 1.8], [68, 73, 1.5], [68, 89, 1.5], [78, 99, 1.9], [86, 122, 2.3], [86, 136, 2.8]],
}

/** The frozen look: static SVG, faded in/out with a CSS opacity transition (no animation while frozen). */
function Frost({ uid, interior, kind, size, h }: { uid: string; interior: string; kind: 'classic' | 'line'; size: number; h: number }) {
  return (
    <svg viewBox={`0 ${TOP} 120 ${HEIGHT}`} width={size} height={h} className="frost absolute inset-0" aria-hidden overflow="visible">
      <defs>
        <clipPath id={`frost-clip-${uid}`}><path d={interior} /></clipPath>
        <linearGradient id={`frost-sheen-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.2" stopColor="#fff" stopOpacity="0" /><stop offset="0.45" stopColor="#fff" stopOpacity="0.28" /><stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* icy tint over the glass (the grains themselves are recoloured in the simulation) */}
      <path d={interior} fill="var(--freeze)" fillOpacity="0.16" />
      <g clipPath={`url(#frost-clip-${uid})`}>
        {/* frosted inner edges */}
        <path d={interior} fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="7" />
        <path d={interior} fill="none" stroke="var(--freeze)" strokeOpacity="0.35" strokeWidth="3" />
        <rect x="0" y={TOP} width="120" height={HEIGHT} fill={`url(#frost-sheen-${uid})`} />
        {/* a few ice crystals */}
        <g stroke="#fff" strokeOpacity="0.85" strokeWidth="0.55" strokeLinecap="round">
          {CRYSTALS[kind].map(([x, y, r], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${(i * 23) % 60})`}>
              <line x1={-r} y1="0" x2={r} y2="0" /><line x1={-r / 2} y1={-r * 0.87} x2={r / 2} y2={r * 0.87} /><line x1={-r / 2} y1={r * 0.87} x2={r / 2} y2={-r * 0.87} />
            </g>
          ))}
        </g>
      </g>
    </svg>
  )
}
