import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import type { Item, Status } from '../lib/types'
import { useApp, updateItem } from '../store/app'
import { useCoverFor, useTotals } from '../lib/hooks'
import { fmtDuration, overlapMs, startOfWeek, ymd } from '../lib/time'
import { ItemRow, ItemTile, Thumb } from './Tile'
import { HourglassGlyph } from './Hourglass'
import { StatusPill } from './StatusPill'
import type { ViewMode } from './ViewSwitcher'
import { cx, IconButton } from './ui'
import { t } from '../i18n'
import { locale } from '../i18n'

export function ItemsView({ items, view, scopeIds, pathOf }: { items: Item[]; view: ViewMode; scopeIds?: Set<string>; pathOf?: (it: Item) => string }) {
  const statuses = useApp((s) => s.data.statuses)
  const showDue = useApp((s) => s.data.settings.due_dates_enabled)
  const covers = useCoverFor()
  const totals = useTotals()
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])

  if (view === 'board') return <Board items={items} statuses={statuses} />
  if (view === 'calendar') return <CalendarView items={items} scopeIds={scopeIds} />

  if (view === 'list') {
    return (
      <div className="flex flex-col gap-0.5">
        {items.map((it) => (
          <ItemRow
            key={it.id} item={it} status={it.status_id ? statusById.get(it.status_id) : null} cover={covers.cover(it)}
            total={totals.total(it.id)} ticking={totals.runningChain.has(it.id)} kids={covers.countKids(it.id)} showDue={showDue}
            path={pathOf?.(it)}
          />
        ))}
      </div>
    )
  }

  const size = view === 'grid-s' ? 's' : view === 'grid-l' ? 'l' : 'm'
  return (
    <div
      className={cx(
        'grid',
        size === 's' && 'grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5 lg:grid-cols-7',
        size === 'm' && 'grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 sm:gap-x-4 sm:gap-y-6',
        size === 'l' && 'grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 sm:gap-x-5',
      )}
    >
      {items.map((it) => (
        <ItemTile
          key={it.id} item={it} size={size} status={it.status_id ? statusById.get(it.status_id) : null} cover={covers.cover(it)}
          total={totals.total(it.id)} running={totals.runningItemId === it.id} ticking={totals.runningChain.has(it.id)}
          kids={covers.countKids(it.id)} mediaCount={covers.countMedia(it.id)} showDue={showDue}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- board
function Board({ items, statuses }: { items: Item[]; statuses: Status[] }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )
  const [dragId, setDragId] = useState<string | null>(null)
  const cols = [...statuses].sort((a, b) => a.sort_order - b.sort_order)
  const hasNone = items.some((i) => !i.status_id || !statuses.some((s) => s.id === i.status_id))
  const onEnd = (e: DragEndEvent) => {
    setDragId(null)
    const id = String(e.active.id)
    const col = e.over ? String(e.over.id) : null
    if (!col) return
    const statusId = col === '__none' ? null : col
    const it = items.find((i) => i.id === id)
    if (it && it.status_id !== statusId) void updateItem(id, { status_id: statusId })
  }
  const dragItem = items.find((i) => i.id === dragId)
  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragEnd={onEnd} onDragCancel={() => setDragId(null)}>
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {cols.map((s) => (
          <Column key={s.id} id={s.id} title={s.name} color={s.color} items={items.filter((i) => i.status_id === s.id)} />
        ))}
        {hasNone && (
          <Column id="__none" title={t('board.noStatus')} color="#a8977f" items={items.filter((i) => !i.status_id || !statuses.some((s) => s.id === i.status_id))} />
        )}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
        {dragItem ? <Card item={dragItem} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({ id, title, color, items }: { id: string; title: string; color: string; items: Item[] }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cx(
        'flex w-[76vw] max-w-[290px] shrink-0 snap-start flex-col rounded-3xl bg-surface-2/70 p-2.5 transition sm:w-[270px]',
        isOver && 'bg-accent-soft ring-2 ring-accent/40',
      )}
    >
      <div className="mb-2 flex items-center gap-2 px-1.5 pt-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="text-sm font-semibold">{title}</span>
        <span className="ml-auto rounded-full bg-surface px-2 text-xs text-muted tabular">{items.length}</span>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {items.map((it) => <DraggableCard key={it.id} item={it} />)}
        {!items.length && <div className="flex h-20 items-center justify-center rounded-2xl border-2 border-dashed border-line text-xs text-muted">{t('board.empty')}</div>}
      </div>
    </div>
  )
}

function DraggableCard({ item }: { item: Item }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: item.id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cx('touch-manipulation', isDragging && 'opacity-30')}>
      <Card item={item} />
    </div>
  )
}

function Card({ item, overlay }: { item: Item; overlay?: boolean }) {
  const covers = useCoverFor()
  const totals = useTotals()
  const showDue = useApp((s) => s.data.settings.due_dates_enabled)
  const cover = covers.cover(item)
  const ticking = totals.runningChain.has(item.id)
  const total = totals.total(item.id)
  return (
    <Link
      to={`/i/${item.id}`}
      onClick={(e) => overlay && e.preventDefault()}
      draggable={false}
      className={cx('block overflow-hidden rounded-2xl border border-line bg-surface transition', overlay && 'rotate-2 shadow-lift')}
    >
      {cover && <Thumb media={cover} className="h-28 w-full" />}
      <div className="p-3">
        <div className="line-clamp-2 text-[14px] font-medium leading-snug">{item.title}</div>
        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
          {(total > 0 || ticking) && (
            <span className={cx('inline-flex items-center gap-1 tabular', ticking && 'text-accent-strong')}>
              <HourglassGlyph size={9} running={ticking} /> {fmtDuration(total)}
            </span>
          )}
          {showDue && item.due_date && <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{item.due_date.slice(5)}</span>}
          {item.tags.slice(0, 2).map((tg) => <span key={tg}>#{tg}</span>)}
        </div>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------- calendar
function CalendarView({ items, scopeIds }: { items: Item[]; scopeIds?: Set<string> }) {
  const all = useApp((s) => s.data.items)
  const sessions = useApp((s) => s.data.sessions)
  const statuses = useApp((s) => s.data.statuses)
  const { due_dates_enabled: dueOn, week_starts_on: ws } = useApp((s) => s.data.settings)
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })
  const [sel, setSel] = useState<string>(() => ymd(new Date()))
  const now = Date.now()

  const dueItems = useMemo(() => {
    if (!dueOn) return []
    const pool = scopeIds ? all.filter((i) => scopeIds.has(i.id)) : all
    return pool.filter((i) => i.due_date)
  }, [all, scopeIds, dueOn])
  void items

  const start = startOfWeek(month, ws)
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  const worked = useMemo(() => {
    const m = new Map<string, number>()
    const scoped = scopeIds ? sessions.filter((s) => scopeIds.has(s.item_id)) : sessions
    for (const d of days) {
      const from = d.getTime(), to = from + 86400_000
      let ms = 0
      for (const s of scoped) ms += overlapMs(s, from, to, now)
      if (ms > 0) m.set(ymd(d), ms)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, scopeIds, month, ws])
  const maxWorked = Math.max(1, ...worked.values())
  const statusById = new Map(statuses.map((s) => [s.id, s]))
  const today = ymd(new Date())
  const weekdays = Array.from({ length: 7 }, (_, i) => days[i].toLocaleDateString(locale, { weekday: 'narrow' }))
  const selDue = dueItems.filter((i) => i.due_date === sel)
  const selSessions = useMemo(() => {
    const from = new Date(sel + 'T00:00:00').getTime(), to = from + 86400_000
    const byItem = new Map<string, number>()
    for (const s of sessions) {
      if (scopeIds && !scopeIds.has(s.item_id)) continue
      const ms = overlapMs(s, from, to, now)
      if (ms > 0) byItem.set(s.item_id, (byItem.get(s.item_id) ?? 0) + ms)
    }
    return [...byItem.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, sel, scopeIds])
  const byId = new Map(all.map((i) => [i.id, i]))

  return (
    <div className="rise">
      {!dueOn && <p className="mb-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">{t('cal.noDue')}</p>}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-xl font-semibold">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h3>
        <div className="flex items-center gap-1">
          <IconButton label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></IconButton>
          <button className="h-8 rounded-full px-3 text-sm hover:bg-surface-2" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonth(d); setSel(today) }}>{t('cal.today')}</button>
          <IconButton label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted">
        {weekdays.map((w, i) => <div key={i} className="py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const key = ymd(d)
          const inMonth = d.getMonth() === month.getMonth()
          const due = dueItems.filter((i) => i.due_date === key)
          const w = worked.get(key) ?? 0
          return (
            <button
              key={key}
              onClick={() => setSel(key)}
              className={cx(
                'relative flex min-h-16 flex-col items-stretch rounded-xl p-1 text-left transition sm:min-h-24 sm:p-1.5',
                inMonth ? 'bg-surface' : 'bg-transparent opacity-45',
                sel === key && 'ring-2 ring-accent',
              )}
            >
              <span className={cx('mb-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular', key === today && 'bg-accent font-semibold text-white dark:text-[#1d1813]')}>{d.getDate()}</span>
              {w > 0 && (
                <span className="mb-0.5 block h-1.5 rounded-full bg-accent" style={{ opacity: 0.25 + 0.75 * (w / maxWorked), width: `${Math.max(18, (w / maxWorked) * 100)}%` }} title={fmtDuration(w)} />
              )}
              <span className="hidden flex-col gap-0.5 sm:flex">
                {due.slice(0, 2).map((i) => {
                  const st = i.status_id ? statusById.get(i.status_id) : undefined
                  return <span key={i.id} className="truncate rounded-md px-1 text-[11px] leading-4" style={{ background: (st?.color ?? '#a8977f') + '2a' }}>{i.title}</span>
                })}
                {due.length > 2 && <span className="text-[10px] text-muted">+{due.length - 2}</span>}
              </span>
              {due.length > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger sm:hidden" />}
            </button>
          )
        })}
      </div>
      <div className="mt-4 rounded-2xl bg-surface p-4">
        <div className="mb-2 text-sm font-semibold">{new Date(sel + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        {selDue.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('cal.dueItems')}</div>
            {selDue.map((i) => (
              <Link key={i.id} to={`/i/${i.id}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                <span className="truncate">{i.title}</span>
                <StatusPill status={i.status_id ? statusById.get(i.status_id) : null} size="xs" />
              </Link>
            ))}
          </div>
        )}
        {selSessions.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('cal.worked', { time: fmtDuration(selSessions.reduce((n, [, ms]) => n + ms, 0)) })}</div>
            {selSessions.map(([id, ms]) => (
              <Link key={id} to={`/i/${id}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                <span className="truncate">{byId.get(id)?.title ?? '…'}</span>
                <span className="text-sm tabular text-muted">{fmtDuration(ms)}</span>
              </Link>
            ))}
          </div>
        ) : !selDue.length ? <div className="text-sm text-muted">—</div> : null}
      </div>
    </div>
  )
}
