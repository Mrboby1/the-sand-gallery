import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ImageIcon, Sparkles } from 'lucide-react'
import { useApp, setDayNote } from '../store/app'
import { useIsFinished, useNow, useRunning } from '../lib/hooks'
import { fmtDuration, overlapMs, ymd } from '../lib/time'
import type { Item } from '../lib/types'
import { TopBar } from '../components/Shell'
import { Thumb } from '../components/Tile'
import { HourglassGlyph } from '../components/Hourglass'
import { IconButton, cx } from '../components/ui'
import { t, tn, locale } from '../i18n'

/** Local midnight of a YYYY-MM-DD, and of the next day (DST-safe). */
function dayRange(day: string): [number, number] {
  const [y, m, d] = day.split('-').map(Number)
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()]
}
const shift = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)) }
const inDay = (iso: string | null | undefined, [a, b]: [number, number]) => { if (!iso) return false; const x = Date.parse(iso); return x >= a && x < b }

/**
 * Daily review: one day at a time (local time). Time worked (sessions split at midnight, a running timer up to now),
 * time per project, photos/videos added, projects started and finished, and a "How did the day go" note (autosaved).
 */
export function DayPage() {
  const [params, setParams] = useSearchParams()
  const today = ymd(new Date())
  const asked = params.get('d')
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today
  const go = (d: string) => setParams(d === today ? {} : { d }, { replace: true })
  const items = useApp((s) => s.data.items)
  const sessions = useApp((s) => s.data.sessions)
  const media = useApp((s) => s.data.media)
  const note = useApp((s) => s.data.day_notes.find((n) => n.day === day))
  const running = useRunning()
  const now = useNow(!!running && day === today, 15000)
  const isFinished = useIsFinished()
  const dateInput = useRef<HTMLInputElement>(null)

  const data = useMemo(() => {
    const range = dayRange(day)
    const byId = new Map(items.map((i) => [i.id, i]))
    // the project a session belongs to: walk up to the item at the top level or directly in a folder
    const projectOf = (id: string): Item | undefined => {
      let it = byId.get(id)
      for (let n = 0; it && n < 50; n++) {
        const parent = it.parent_id ? byId.get(it.parent_id) : undefined
        if (!parent || parent.kind === 'folder') return it
        it = parent
      }
      return it
    }
    const per = new Map<string, number>()
    let total = 0
    for (const s of sessions) {
      const ms = overlapMs(s, range[0], range[1], now) // a session over midnight counts on both days
      if (ms <= 0) continue
      total += ms
      const p = projectOf(s.item_id)
      if (p) per.set(p.id, (per.get(p.id) ?? 0) + ms)
    }
    const perProject = [...per.entries()].map(([id, ms]) => ({ item: byId.get(id)!, ms })).filter((x) => x.item).sort((a, b) => b.ms - a.ms)
    const added = media.filter((m) => inDay(m.created_at, range)).sort((a, b) => a.created_at.localeCompare(b.created_at))
    const isProject = (i: Item) => i.kind !== 'folder' && (!i.parent_id || byId.get(i.parent_id)?.kind === 'folder')
    const started = items.filter((i) => isProject(i) && inDay(i.created_at, range))
    const finished = items.filter((i) => isProject(i) && isFinished(i.id) && inDay(i.finished_at, range))
    return { total, perProject, added, started, finished }
  }, [day, items, sessions, media, now, isFinished])

  const empty = !data.total && !data.added.length && !data.started.length && !data.finished.length && !note?.body
  const max = data.perProject[0]?.ms ?? 1
  const label = new Date(dayRange(day)[0]).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: day.slice(0, 4) !== today.slice(0, 4) ? 'numeric' : undefined })

  return (
    <div className="min-h-full pb-24">
      <TopBar back="/" />
      <main className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <h1 className="font-display text-[32px] font-semibold leading-tight sm:text-4xl">{t('day.title')}</h1>

        {/* day navigation: previous / date picker / next (never into the future) */}
        <div className="mt-3 flex items-center gap-2">
          <IconButton label={t('day.prev')} onClick={() => go(shift(day, -1))}><ChevronLeft size={20} /></IconButton>
          <button onClick={() => dateInput.current?.showPicker?.()} className="relative inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 text-[15px] font-medium">
            <CalendarDays size={16} className="shrink-0 text-muted" />
            <span className="truncate">{day === today ? `${t('day.today')} · ${label}` : label}</span>
            <input ref={dateInput} type="date" max={today} value={day} onChange={(e) => e.target.value && go(e.target.value)} aria-label={t('day.pick')} className="absolute inset-0 cursor-pointer opacity-0" />
          </button>
          <IconButton label={t('day.next')} onClick={() => go(shift(day, 1))} disabled={day >= today}><ChevronRight size={20} /></IconButton>
        </div>
        {day !== today && <button onClick={() => go(today)} className="mt-2 text-[13px] font-medium text-accent-strong underline-offset-2 hover:underline">{t('day.backToToday')}</button>}

        {empty && (
          <div className="mt-8 flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-line px-6 py-10 text-center">
            <Sparkles size={22} className="text-accent" />
            <p className="font-medium">{day === today ? t('day.emptyToday') : t('day.empty')}</p>
            <p className="text-[13px] text-muted">{t('day.emptyHint')}</p>
          </div>
        )}

        {!empty && (
          <>
            <section className="mt-6 flex items-center gap-4 rounded-3xl bg-accent-soft px-5 py-5">
              <HourglassGlyph size={26} running={!!running && day === today} />
              <div>
                <div className="font-display text-4xl font-semibold tabular">{fmtDuration(data.total)}</div>
                <div className="text-[13px] text-muted">{t('day.worked')}{running && day === today ? ` · ${t('day.runningNow')}` : ''}</div>
              </div>
            </section>

            {data.perProject.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 font-display text-xl font-semibold">{t('day.perProject')}</h2>
                <ul className="flex flex-col gap-1">
                  {data.perProject.map(({ item, ms }) => (
                    <li key={item.id}>
                      <Link to={`/i/${item.id}`} className="block rounded-2xl px-2 py-2 transition hover:bg-surface-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <span dir="auto" className="min-w-0 truncate font-medium">{item.title}</span>
                          <span className="shrink-0 tabular text-[14px] text-muted">{fmtDuration(ms)}</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (ms / max) * 100)}%` }} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.added.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 flex items-center gap-2 font-display text-xl font-semibold"><ImageIcon size={18} className="text-muted" /> {tn('day.mediaAdded', data.added.length)}</h2>
                <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                  {data.added.map((m) => (
                    <Link key={m.id} to={`/i/${m.item_id}`} className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                      <Thumb media={m} className="h-full w-full" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {(data.started.length > 0 || data.finished.length > 0) && (
              <section className="mt-6 grid gap-4 sm:grid-cols-2">
                {data.started.length > 0 && <ProjectList title={tn('day.started', data.started.length)} items={data.started} icon={<Sparkles size={16} className="text-accent" />} />}
                {data.finished.length > 0 && <ProjectList title={tn('day.finished', data.finished.length)} items={data.finished} icon={<CheckCircle2 size={16} className="text-[#5f9e6e]" />} />}
              </section>
            )}
          </>
        )}

        <DayNoteBox key={day} day={day} initial={note?.body ?? ''} />
      </main>
    </div>
  )
}

function ProjectList({ title, items, icon }: { title: string; items: Item[]; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4">
      <h3 className="mb-2 flex items-center gap-2 font-medium">{icon} {title}</h3>
      <ul className="flex flex-col">
        {items.map((i) => <li key={i.id}><Link to={`/i/${i.id}`} dir="auto" className="block truncate rounded-xl px-2 py-1.5 text-[15px] hover:bg-surface-2">{i.title}</Link></li>)}
      </ul>
    </div>
  )
}

/** "How did the day go": saved while typing (debounced) and when leaving the page. */
function DayNoteBox({ day, initial }: { day: string; initial: string }) {
  const [v, setV] = useState(initial)
  const [saved, setSaved] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(initial)
  const flush = () => { clearTimeout(timer.current); if (latest.current !== initial || !saved) { void setDayNote(day, latest.current); setSaved(true) } }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => flushRef.current(), [])
  useEffect(() => { if (saved) { setV(initial); latest.current = initial } }, [initial]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold">{t('day.noteTitle')}</h2>
        <span className={cx('text-[12px] text-muted transition', saved ? 'opacity-70' : 'opacity-0')}>{v ? t('day.saved') : ''}</span>
      </div>
      <textarea
        value={v}
        dir="auto"
        rows={5}
        placeholder={t('day.notePlaceholder')}
        onChange={(e) => {
          setV(e.target.value)
          latest.current = e.target.value
          setSaved(false)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => { void setDayNote(day, latest.current); setSaved(true) }, 700)
        }}
        onBlur={() => flushRef.current()}
        className="w-full resize-y rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-accent"
      />
    </section>
  )
}
