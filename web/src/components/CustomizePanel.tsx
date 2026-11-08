import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useApp, saveSettings } from '../store/app'
import { applyColors, type CustomColors } from '../lib/customColors'
import { getTheme, setStyle, setTheme, useStyle, type StylePref, type ThemePref } from '../lib/theme'
import { Hourglass } from './Hourglass'
import { IconButton, cx } from './ui'
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
  const set = (patch: Partial<CustomColors>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    applyColors(next) // live preview on every move (the sand simulation picks it up at once)
    clearTimeout(timer.current)
    // only the save is debounced; all three together so a later slider never drops an earlier one
    timer.current = setTimeout(() => void saveSettings({ ...latest.current }), 500)
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

/** A collapsible bottom panel with all the look controls, over a fullscreen hourglass. */
export function CustomizePanel({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="sheet absolute inset-x-0 bottom-0 z-10 mx-auto max-w-xl rounded-t-3xl border border-line bg-surface/95 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 shadow-lift backdrop-blur">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-2 py-2 text-left font-display text-lg font-semibold" aria-expanded={open}>
          {t('colors.customize')} {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        {onClose && <IconButton label={t('common.close')} onClick={onClose}><X size={18} /></IconButton>}
      </div>
      {open && (
        <div className="flex max-h-[45vh] flex-col gap-4 overflow-y-auto pb-1 pt-1">
          <StyleThemeControls />
          <ColorSliders />
        </div>
      )}
    </div>
  )
}

/** Settings > Colours > Full screen: the big hourglass (sand running as a preview) with the controls below. */
export function CustomizeFullscreen({ onClose }: { onClose: () => void }) {
  const [frozen, setFrozen] = useState(false)
  // hourglasses behind this view pause their sand; Escape closes
  useEffect(() => {
    document.body.dataset.fsTimer = '1'
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => { delete document.body.dataset.fsTimer; window.removeEventListener('keydown', k) }
  }, [onClose])
  return createPortal(
    <div data-fullscreen-timer className="fade fixed inset-0 z-[60] flex flex-col items-center bg-bg safe-top">
      <IconButton label={t('common.close')} onClick={onClose} className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] z-20"><X size={22} /></IconButton>
      <div className="flex min-h-0 flex-1 items-center justify-center pb-[40vh]">
        <Hourglass running={!frozen} size={Math.min(window.innerWidth * 0.42, 210)} />
      </div>
      <div className="absolute left-4 top-[calc(1rem+env(safe-area-inset-top))] z-20">
        <Seg value={frozen ? 'f' : 'r'} options={[{ v: 'r', l: t('colors.previewRunning') }, { v: 'f', l: t('colors.previewFrozen') }]} onChange={(v) => setFrozen(v === 'f')} />
      </div>
      <CustomizePanel />
    </div>,
    document.body,
  )
}
