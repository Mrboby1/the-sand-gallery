import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react'
import { useApp, saveSettings, toast } from '../store/app'
import { applyColors, type CustomColors } from '../lib/customColors'
import { getTheme, setStyle, setTheme, useStyle, type StylePref, type ThemePref } from '../lib/theme'
import { Hourglass } from './Hourglass'
import { IconButton, cx } from './ui'
import { useMediaQuery } from '../lib/hooks'
import { t } from '../i18n'

function Seg({ value, options, onChange }: { value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={cx('h-8 rounded-full px-3 text-[13px] transition', value === o.v ? 'bg-surface font-medium shadow-sm' : 'text-muted')}>{o.l}</button>
      ))}
    </div>
  )
}

/** Hue sliders for the hourglass, the sand and the background: live preview, saved (debounced) per user. */
export function ColorSliders() {
  const s = useApp((st) => st.data.settings)
  const [draft, setDraft] = useState<CustomColors>({ hg_hue: s.hg_hue ?? null, sand_hue: s.sand_hue ?? null, bg_hue: s.bg_hue ?? null, freeze_hue: s.freeze_hue ?? null })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dark = document.documentElement.dataset.theme === 'dark'
  const latest = useRef(draft)
  // another copy of these sliders (Settings under the fullscreen panel) saved: follow it
  useEffect(() => {
    const next = { hg_hue: s.hg_hue ?? null, sand_hue: s.sand_hue ?? null, bg_hue: s.bg_hue ?? null, freeze_hue: s.freeze_hue ?? null }
    if (timer.current) return
    latest.current = next
    setDraft(next)
  }, [s.hg_hue, s.sand_hue, s.bg_hue, s.freeze_hue])
  const set = (patch: Partial<CustomColors>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    applyColors(next) // live preview on every move (the sand simulation picks it up at once)
    clearTimeout(timer.current)
    // only the save is debounced; all three together so a later slider never drops an earlier one
    timer.current = setTimeout(() => { timer.current = undefined; void saveSettings({ ...latest.current }) }, 500)
  }
  const rows: { key: keyof CustomColors; label: string; def: number; light: [number, number]; darkSL: [number, number] }[] = [
    { key: 'hg_hue', label: t('colors.hourglass'), def: 29, light: [38, 27], darkSL: [32, 72] },
    { key: 'sand_hue', label: t('colors.sand'), def: 32, light: [62, 57], darkSL: [62, 60] },
    { key: 'bg_hue', label: t('colors.background'), def: 36, light: [42, 90], darkSL: [18, 12] },
    { key: 'freeze_hue', label: t('colors.freeze'), def: 200, light: [78, 60], darkSL: [70, 68] },
  ]
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => {
        const v = draft[r.key] ?? null
        const [sat, light] = dark ? r.darkSL : r.light
        const track = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} ${Math.max(sat, 45)}% 55%)`).join(', ')})`
        return (
          <div key={r.key} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-sm">{r.label}</span>
            <span className="h-6 w-6 shrink-0 rounded-full border border-line" style={{ background: v === null ? undefined : `hsl(${v} ${sat}% ${light}%)` }} />
            <input
              type="range"
              min={0}
              max={359}
              value={v ?? r.def}
              aria-label={r.label}
              onChange={(e) => set({ [r.key]: Number(e.target.value) } as Partial<CustomColors>)}
              className="hue-slider h-6 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
              style={{ background: track, opacity: v === null ? 0.55 : 1 }}
            />
            <button
              onClick={() => set({ [r.key]: null } as Partial<CustomColors>)}
              disabled={v === null}
              className="h-8 shrink-0 rounded-full px-2.5 text-[12px] text-muted transition hover:bg-surface-2 disabled:opacity-35"
            >
              {t('colors.reset')}
            </button>
          </div>
        )
      })}
      <button
        onClick={() => {
          const before = { ...latest.current }
          set({ hg_hue: null, sand_hue: null, bg_hue: null, freeze_hue: null })
          toast(t('colors.resetDone'), 'info', { label: t('common.undo'), run: () => set(before) })
        }}
        disabled={Object.values(draft).every((v) => v === null || v === undefined)}
        className="inline-flex h-9 items-center gap-2 self-start rounded-full border border-line px-3.5 text-[13px] font-medium transition hover:bg-surface-2 disabled:opacity-40"
      >
        <RotateCcw size={14} /> {t('colors.resetAll')}
      </button>
    </div>
  )
}

/** Theme + hourglass style, the same controls as Settings > Appearance. */
export function StyleThemeControls() {
  const style = useStyle()
  const [theme, setThemeState] = useState<ThemePref>(getTheme())
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{t('settings.theme')}</span>
        <Seg value={theme} options={(['system', 'light', 'dark'] as ThemePref[]).map((v) => ({ v, l: t(`settings.theme.${v}`) }))} onChange={(v) => { setTheme(v as ThemePref); setThemeState(v as ThemePref) }} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{t('settings.style')}</span>
        <Seg value={style} options={(['flat', 'glossy', 'line'] as StylePref[]).map((v) => ({ v, l: t(`settings.style.${v}`) }))} onChange={(v) => setStyle(v as StylePref)} />
      </div>
    </div>
  )
}

/** Size of an element, kept up to date (ResizeObserver). */
export function useBox(ref: React.RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return box
}

/** On wide screens the customise panel sits beside the hourglass instead of under it. */
export const WIDE_QUERY = '(min-width: 900px), (orientation: landscape) and (max-height: 560px) and (min-width: 640px)'

/**
 * Fits the fullscreen timer (hourglass + clock, grains, title and the Start/Pause button) into the free space, so the
 * button is always visible: stacked when there is height, side by side on short wide screens (landscape, laptops),
 * compact (clock + button only) when space is very tight. Sizes are rounded so resizing does not restart the sand
 * on every pixel.
 */
export function fitTimer(w: number, h: number): { mode: 'col' | 'row' | 'compact'; size: number } {
  const HG = 1.98 // hourglass height / width (including the falling stream above and below the glass)
  const round = (x: number) => Math.max(28, Math.floor(x / 8) * 8)
  const col = Math.min((h - 300) / HG, w * 0.45, 256)
  const row = w >= 560 ? Math.min((h - 24) / HG, (w - 340) * 0.6, 256) : 0
  if (row > col * 1.15 && row >= 72) return { mode: 'row', size: round(row) }
  if (col >= 72) return { mode: 'col', size: round(col) }
  return { mode: 'compact', size: round(Math.min((h - 150) / HG, w * 0.45, 256)) }
}

/** The look controls: a collapsible bottom sheet on phones, a side panel on wide screens. Never covers the timer. */
export function CustomizePanel({ onClose, side = false }: { onClose?: () => void; side?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <div className={cx('relative z-10 shrink-0 border-line bg-surface/95 shadow-lift backdrop-blur', side ? 'flex h-full w-[min(360px,45vw)] flex-col border-l px-5 pt-[calc(0.75rem+env(safe-area-inset-top))]' : 'sheet mx-auto w-full max-w-xl rounded-t-3xl border px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2')}>
      <div className="flex items-center justify-between">
        {side ? (
          <div className="flex-1 py-2 font-display text-lg font-semibold">{t('colors.customize')}</div>
        ) : (
          <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-2 py-2 text-left font-display text-lg font-semibold" aria-expanded={open}>
            {t('colors.customize')} {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        )}
        {onClose && <IconButton label={t('colors.closePanel')} onClick={onClose}><X size={18} /></IconButton>}
      </div>
      {(open || side) && (
        <div className={cx('flex flex-col gap-4 overflow-y-auto pb-2 pt-1', side ? 'min-h-0 flex-1' : 'max-h-[38vh]')}>
          <StyleThemeControls />
          <ColorSliders />
        </div>
      )}
    </div>
  )
}

/** Settings > Colours > Full screen: the big hourglass (sand running as a preview) with the controls beside/below. */
export function CustomizeFullscreen({ onClose }: { onClose: () => void }) {
  const [frozen, setFrozen] = useState(false)
  const wide = useMediaQuery(WIDE_QUERY)
  const stage = useRef<HTMLDivElement>(null)
  const box = useBox(stage)
  const size = Math.max(28, Math.floor(Math.min((box.h - 24) / 1.98, box.w * 0.5, 256) / 8) * 8)
  // hourglasses behind this view pause their sand; Escape closes, Space toggles the preview
  useEffect(() => {
    document.body.dataset.fsTimer = '1'
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement)) { e.preventDefault(); setFrozen((f) => !f) }
    }
    window.addEventListener('keydown', k)
    return () => { delete document.body.dataset.fsTimer; window.removeEventListener('keydown', k) }
  }, [onClose])
  return createPortal(
    <div data-fullscreen-timer className={cx('fade fixed inset-0 z-[60] flex bg-bg', wide ? 'flex-row' : 'flex-col')}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col safe-top safe-bottom">
        <div className="flex shrink-0 items-center justify-between px-4 pt-4">
          <Seg value={frozen ? 'f' : 'r'} options={[{ v: 'r', l: t('colors.previewRunning') }, { v: 'f', l: t('colors.previewFrozen') }]} onChange={(v) => setFrozen(v === 'f')} />
          <IconButton label={t('common.close')} onClick={onClose}><X size={22} /></IconButton>
        </div>
        <div ref={stage} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <Hourglass running={!frozen} size={size} />
        </div>
      </div>
      <CustomizePanel side={wide} />
    </div>,
    document.body,
  )
}
