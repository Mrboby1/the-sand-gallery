import { useEffect, useRef } from 'react'
import { locale, t } from '../i18n'

/**
 * How many grains of sand a real hourglass would have let through in the time worked.
 *
 * Derivation (fine quartz sand, as used in hourglasses):
 *  - grain diameter d ≈ 0.15 mm → volume = π/6·d³ = 0.5236 × (0.015 cm)³ ≈ 1.77e-6 cm³
 *  - quartz density ρ = 2.65 g/cm³ → mass per grain ≈ 4.7e-6 g (4.7 µg)
 *  - a 1-hour glass holds ≈ 100 g → mass flow ≈ 100 g / 3600 s ≈ 0.028 g/s
 *  - grains per second ≈ 0.028 / 4.7e-6 ≈ 5,900
 * Cross-check with Beverloo's law for granular flow through an orifice,
 *   W = C·ρ_bulk·√g·(D − k·d)^2.5, C ≈ 0.58, ρ_bulk ≈ 1600 kg/m³, k ≈ 1.5:
 *   a neck of D ≈ 0.9 mm gives W ≈ 3.4e-5 kg/s ≈ 0.034 g/s ≈ 7,300 grains/s (≈ 120 g per hour).
 * Both land around 6,000–7,000 grains per second; we use one round constant.
 */
export const GRAINS_PER_SECOND = 6000

/** Full number with thousands separators while it stays readable (up to hundreds of trillions), compact after. */
export function formatGrains(n: number): string {
  const v = Math.floor(n)
  if (v < 1e15) return new Intl.NumberFormat(locale).format(v)
  const units: [number, string][] = [[1e21, 'Sx'], [1e18, 'Qi'], [1e15, 'Q']]
  for (const [size, suffix] of units) if (v >= size) return `${(v / size).toLocaleString(locale, { maximumFractionDigits: 1 })} ${suffix}`
  return String(v)
}

/**
 * "which are / N grains of sand", counting smoothly (every animation frame) while the timer runs.
 * `totalMs` is the clock's value at `asOf` (ms epoch); while `running` the count keeps moving from there.
 */
export function GrainCount({ totalMs, asOf, running }: { totalMs: number; asOf: number; running: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const paint = () => {
      const ms = totalMs + (running ? Math.max(0, Date.now() - asOf) : 0)
      if (ref.current) ref.current.textContent = formatGrains((ms / 1000) * GRAINS_PER_SECOND)
    }
    paint()
    if (!running) return
    let raf = 0
    const loop = () => { paint(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [totalMs, asOf, running])
  return (
    <div className="mt-2 flex flex-col items-center text-center">
      <span className="text-[13px] text-muted">{t('timer.whichAre')}</span>
      <span className="mt-0.5 max-w-[92vw] text-[17px] text-ink/80 sm:text-lg">
        <span ref={ref} className="font-semibold tabular" /> {t('timer.grains')}
      </span>
    </div>
  )
}
