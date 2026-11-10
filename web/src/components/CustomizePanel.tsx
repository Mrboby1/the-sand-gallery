import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, RotateCcw, Sun, X } from 'lucide-react'
import { useApp, saveSettings, toast, updateItem } from '../store/app'
import { DEFAULT_HUES, applyColors, colorVars, type CustomColors } from '../lib/customColors'
import { globalColors, projectColors, subtaskOrder, type ProjectLook, type SubtaskLook } from '../lib/look'
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
const fromSettings = (s: Partial<CustomColors>): CustomColors => ({
  hg_hue: s.hg_hue ?? null, sand_hue: s.sand_hue ?? null, bg_hue: s.bg_hue ?? null, freeze_hue: s.freeze_hue ?? null,
  hg_light: s.hg_light ?? null, sand_light: s.sand_light ?? null, bg_light: s.bg_light ?? null, freeze_light: s.freeze_light ?? null,
})
const ALL_DEFAULT: CustomColors = fromSettings({})

export function ColorSliders({ projectId }: { projectId?: string } = {}) {
  const s = useApp((st) => st.data.settings)
  const project = useApp((st) => (projectId ? st.data.items.find((i) => i.id === projectId) : undefined))
  // what the sliders show: one project's colours (separate looks), else the global ones
  const source = (): CustomColors => (project ? projectColors(project, globalColors(s)) : fromSettings(s))
  const [draft, setDraft] = useState<CustomColors>(source)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(draft)
  /** The one brightness slider that is open (the sun button of a row toggles it). */
  const [openBright, setOpenBright] = useState<string | null>(null)
  // another copy of these sliders (Settings under the fullscreen panel) saved: follow it
  useEffect(() => {
    if (timer.current) return
    const next = source()
    latest.current = next
    setDraft(next)
  }, [s.hg_hue, s.sand_hue, s.bg_hue, s.freeze_hue, s.hg_light, s.sand_light, s.bg_light, s.freeze_light, JSON.stringify(project?.look ?? null)]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<CustomColors>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    applyColors(next) // live preview on every move (the sand simulation picks it up at once)
    clearTimeout(timer.current)
    // only the save is debounced; everything together so a later slider never drops an earlier one
    timer.current = setTimeout(() => {
      timer.current = undefined
      if (project) void updateItem(project.id, { look: { ...((project.look ?? {}) as object), ...latest.current } })
      else void saveSettings({ ...latest.current })
    }, 500)
  }
  const rows: { hue: 'hg_hue' | 'sand_hue' | 'bg_hue' | 'freeze_hue'; light: 'hg_light' | 'sand_light' | 'bg_light' | 'freeze_light'; label: string; def: number; sat: number; swatch: string; hint?: string }[] = [
    { hue: 'hg_hue', light: 'hg_light', label: t('colors.hourglass'), def: DEFAULT_HUES.hg, sat: 38, swatch: 'var(--glass-line)' },
    { hue: 'sand_hue', light: 'sand_light', label: t('colors.sand'), def: DEFAULT_HUES.sand, sat: 62, swatch: 'var(--sand-2)' },
    { hue: 'bg_hue', light: 'bg_light', label: t('colors.background'), def: DEFAULT_HUES.bg, sat: 42, swatch: 'var(--sg-bg)', hint: t('colors.bgBrightnessHint') },
    { hue: 'freeze_hue', light: 'freeze_light', label: t('colors.freeze'), def: DEFAULT_HUES.freeze, sat: 78, swatch: 'var(--freeze)' },
  ]
  return (
    <div className="flex flex-col gap-4">
      {rows.map((r) => {
        const h = draft[r.hue] ?? null
        const l = draft[r.light] ?? null
        const custom = h !== null || (l !== null && l !== 0)
        const track = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((x) => `hsl(${x} ${Math.max(r.sat, 45)}% 55%)`).join(', ')})`
        const hh = h ?? r.def
        const bright = `linear-gradient(to right, #000, hsl(${hh} ${Math.max(r.sat, 50)}% 50%), #fff)`
        const open = openBright === r.light
        const lit = l !== null && l !== 0
        return (
          <div key={r.hue}>
            <div className="flex items-center gap-2.5">
              <span className="w-[5.25rem] shrink-0 text-sm">{r.label}</span>
              <span className="h-6 w-6 shrink-0 rounded-full border border-line" style={{ background: r.swatch }} />
              <input
                type="range" min={0} max={359} value={hh} aria-label={r.label}
                onChange={(e) => set({ [r.hue]: Number(e.target.value) } as Partial<CustomColors>)}
                className="hue-slider h-6 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
                style={{ background: track, opacity: h === null ? 0.55 : 1 }}
              />
              <button
                onClick={() => setOpenBright(open ? null : r.light)}
                aria-expanded={open}
                aria-label={`${r.label} ${t('colors.brightness')}`}
                title={t('colors.brightness')}
                className={cx('relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition', open ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-2')}
              >
                <Sun size={16} />
                {lit && !open && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
              <button
                onClick={() => set({ [r.hue]: null, [r.light]: null } as Partial<CustomColors>)}
                disabled={!custom}
                className="h-8 shrink-0 rounded-full px-1.5 text-[12px] text-muted transition hover:bg-surface-2 disabled:opacity-35"
              >
                {t('colors.reset')}
              </button>
            </div>
            {open && <div className="sheet mt-2 flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5">
              <Sun size={14} className="shrink-0 text-muted" />
              <span className="shrink-0 text-[12px] text-muted">{t('colors.dark')}</span>
              <input
                autoFocus
                type="range" min={-50} max={50} step={1} value={l ?? 0} aria-label={`${r.label} ${t('colors.brightnessLevel')}`}
                onChange={(e) => set({ [r.light]: Number(e.target.value) } as Partial<CustomColors>)}
                onDoubleClick={() => set({ [r.light]: null } as Partial<CustomColors>)}
                className="hue-slider bright-slider h-3.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full ring-1 ring-line"
                style={{ background: bright }}
              />
              <span className="shrink-0 text-[12px] text-muted">{t('colors.light')}</span>
            </div>}
            {open && r.hint && <p className="mt-1.5 px-1 text-[12px] text-muted">{r.hint}</p>}
          </div>
        )
      })}
      <button
        onClick={() => {
          const before = { ...latest.current }
          set({ ...ALL_DEFAULT })
          toast(t('colors.resetDone'), 'info', { label: t('common.undo'), run: () => set(before) })
        }}
        disabled={Object.values(draft).every((v) => v === null || v === undefined || v === 0)}
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
export function CustomizePanel({ onClose, side = false, projectId }: { onClose?: () => void; side?: boolean; projectId?: string }) {
  const projectTitle = useApp((st) => (projectId ? st.data.items.find((i) => i.id === projectId)?.title : undefined))
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
          {projectId && <p className="-mb-1 rounded-2xl bg-accent-soft px-3 py-2 text-[13px]">{t('look.editingProject', { title: projectTitle ?? '' })}</p>}
          <ColorSliders projectId={projectId} />
          {projectId && <ProjectLookExtras projectId={projectId} />}
        </div>
      )}
    </div>
  )
}

/** Settings > Colours > Full screen: the big hourglass (sand running as a preview) with the controls beside/below. */
export function CustomizeFullscreen({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
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
      <CustomizePanel side={wide} projectId={projectId} />
    </div>,
    document.body,
  )
}

/** A project's own look: subtasks the same or a sand gradient to a second colour, and "back to the global look". */
function ProjectLookExtras({ projectId }: { projectId: string }) {
  const project = useApp((st) => st.data.items.find((i) => i.id === projectId))
  const items = useApp((st) => st.data.items)
  const settings = useApp((st) => st.data.settings)
  const look = (project?.look ?? null) as ProjectLook | null
  const sub: SubtaskLook = look?.sub ?? { mode: 'same', hue: 200, light: 0 }
  const [draft, setDraft] = useState(sub)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => { if (!timer.current) setDraft(sub) }, [JSON.stringify(look?.sub ?? null)]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!project) return null
  const save = (next: SubtaskLook) => {
    setDraft(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = undefined; void updateItem(projectId, { look: { ...((project.look ?? {}) as object), sub: next } }) }, 400)
  }
  const n = subtaskOrder(projectId, items).length
  const base = projectColors(project, globalColors(settings))
  const dark = document.documentElement.dataset.theme === 'dark'
  // preview: the sand colour of each subtask (up to 8 steps)
  const steps = Math.max(2, Math.min(8, n || 5))
  const swatches = Array.from({ length: steps + 1 }, (_, i) => {
    const tt = i / steps
    const d = ((draft.hue - (base.sand_hue ?? DEFAULT_HUES.sand) + 540) % 360) - 180
    const hue = ((base.sand_hue ?? DEFAULT_HUES.sand) + d * tt + 360) % 360
    const light = (base.sand_light ?? 0) + (draft.light - (base.sand_light ?? 0)) * tt
    return colorVars({ hg_hue: null, bg_hue: null, sand_hue: hue, sand_light: light }, dark)['--sand-2']
  })
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{t('look.subtasks')}</span>
        <Seg value={draft.mode} options={[{ v: 'same', l: t('look.subSame') }, { v: 'gradient', l: t('look.subGradient') }]} onChange={(v) => save({ ...draft, mode: v as SubtaskLook['mode'] })} />
      </div>
      {draft.mode === 'gradient' && (
        <>
          <div className="flex items-center gap-2.5">
            <span className="w-[5.25rem] shrink-0 text-sm">{t('look.gradientTo')}</span>
            <input type="range" min={0} max={359} value={draft.hue} aria-label={t('look.gradientTo')} onChange={(e) => save({ ...draft, hue: Number(e.target.value) })}
              className="hue-slider h-6 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
              style={{ background: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((x) => `hsl(${x} 62% 55%)`).join(', ')})` }} />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-[5.25rem] shrink-0 text-[12px] text-muted">{t('colors.brightness')}</span>
            <input type="range" min={-50} max={50} value={draft.light} aria-label={`${t('look.gradientTo')} ${t('colors.brightness')}`} onChange={(e) => save({ ...draft, light: Number(e.target.value) })}
              className="hue-slider bright-slider h-3.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full ring-1 ring-line"
              style={{ background: `linear-gradient(to right, #000, hsl(${draft.hue} 62% 50%), #fff)` }} />
          </div>
          <div className="flex h-6 overflow-hidden rounded-full ring-1 ring-line" aria-label={t('look.preview')}>
            {swatches.map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
          </div>
          <p className="text-[12px] text-muted">{n ? t('look.gradientHint', { n }) : t('look.gradientHintNone')}</p>
        </>
      )}
      {look && (
        <button onClick={() => void updateItem(projectId, { look: null })} className="inline-flex h-9 items-center gap-2 self-start rounded-full border border-line px-3.5 text-[13px] font-medium transition hover:bg-surface-2">
          <RotateCcw size={14} /> {t('look.useGlobal')}
        </button>
      )}
    </div>
  )
}
