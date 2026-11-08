import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { Item, Session } from '../lib/types'
import {
  useApp, addCost, addSession, deleteCost, deleteSession, descendantIds, updateCost, updateItem, updateSession,
} from '../store/app'
import { useNow, useRunning, useWeekTotal } from '../lib/hooks'
import { fmtDuration, MS_HOUR, sessionMs, toLocalInput } from '../lib/time'
import { Button, Field, IconButton, Input, Sheet, Switch, confirmDialog, cx } from './ui'
import { HourglassGlyph } from './Hourglass'
import { t, locale } from '../i18n'

// ---------------------------------------------------------------- notes
export function NotesTab({ item }: { item: Item }) {
  const [text, setText] = useState(item.notes)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setText(item.notes); latest.current = item.notes }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.max(240, el.scrollHeight) + 'px' }
  }, [text])
  // flush on unmount
  useEffect(() => () => {
    clearTimeout(timer.current)
    if (latest.current !== useApp.getState().data.items.find((i) => i.id === item.id)?.notes) void updateItem(item.id, { notes: latest.current })
  }, [item.id])
  const onChange = (v: string) => {
    setText(v)
    latest.current = v
    setState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      await updateItem(item.id, { notes: v })
      setState('saved')
    }, 700)
  }
  return (
    <div className="rise">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('notes.placeholder')}
        dir="auto"
        className="block w-full resize-none rounded-3xl border border-line bg-surface p-5 text-[16px] leading-relaxed text-ink outline-none transition placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <div className="mt-2 h-4 text-right text-xs text-muted">{state === 'saving' ? t('notes.saving') : state === 'saved' ? t('notes.saved') : ''}</div>
    </div>
  )
}

// ---------------------------------------------------------------- time log
export function TimeLogTab({ item, hasChildren }: { item: Item; hasChildren: boolean }) {
  const items = useApp((s) => s.data.items)
  const sessions = useApp((s) => s.data.sessions)
  const [includeSub, setIncludeSub] = useState(hasChildren)
  const [editing, setEditing] = useState<Session | 'new' | null>(null)
  const running = useRunning()
  const now = useNow(!!running)
  const scope = useMemo(() => {
    const ids = new Set([item.id])
    if (includeSub) for (const d of descendantIds(items, item.id)) ids.add(d)
    return ids
  }, [items, item.id, includeSub])
  const week = useWeekTotal(scope)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const list = sessions.filter((s) => scope.has(s.item_id)).sort((a, b) => b.started_at.localeCompare(a.started_at))
  const allTime = list.reduce((n, s) => n + sessionMs(s, now), 0)
  const groups = useMemo(() => {
    const g = new Map<string, Session[]>()
    for (const s of list) {
      const k = new Date(s.started_at).toDateString()
      g.set(k, [...(g.get(k) ?? []), s])
    }
    return [...g.entries()]
  }, [list])
  const timeFmt = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="rise">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-3xl bg-accent-soft px-5 py-4">
        <HourglassGlyph size={22} running={!!running && scope.has(running.item_id)} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-semibold">{t('log.week', { time: fmtDuration(week) })}</div>
          <div className="text-[13px] text-muted">{t('log.total')}: {fmtDuration(allTime)}</div>
        </div>
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus size={16} /> {t('log.add')}</Button>
      </div>
      {hasChildren && (
        <label className="mb-3 flex items-center justify-between gap-3 px-1 text-sm">
          <span>{t('log.includeSub')}</span>
          <Switch checked={includeSub} onChange={setIncludeSub} label={t('log.includeSub')} />
        </label>
      )}
      {!list.length && <p className="px-1 py-8 text-center text-sm text-muted">{t('log.empty')}</p>}
      <div className="flex flex-col gap-4">
        {groups.map(([day, ss]) => (
          <div key={day}>
            <div className="mb-1.5 flex items-baseline justify-between px-1">
              <span className="text-[13px] font-semibold">{new Date(day).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(day).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}</span>
              <span className="text-xs tabular text-muted">{fmtDuration(ss.reduce((n, s) => n + sessionMs(s, now), 0))}</span>
            </div>
            <div className="overflow-hidden rounded-2xl bg-surface border border-line">
              {ss.map((s) => (
                <div key={s.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm tabular">
                      {timeFmt(s.started_at)} – {s.ended_at ? timeFmt(s.ended_at) : <span className="font-medium text-accent-strong">{t('log.running')}</span>}
                    </div>
                    {includeSub && s.item_id !== item.id && (
                      <Link to={`/i/${s.item_id}`} className="block truncate text-xs text-muted hover:text-accent-strong">{byId.get(s.item_id)?.title}</Link>
                    )}
                  </div>
                  <span className={cx('text-sm font-medium tabular', !s.ended_at && 'text-accent-strong')}>{fmtDuration(sessionMs(s, now), { seconds: !s.ended_at })}</span>
                  {s.ended_at && (
                    <div className="flex">
                      <IconButton label={t('common.edit')} onClick={() => setEditing(s)} className="h-8 w-8"><Pencil size={15} /></IconButton>
                      <IconButton
                        label={t('common.delete')}
                        className="h-8 w-8"
                        onClick={async () => { if (await confirmDialog(t('log.deleteConfirm'), { danger: true, okLabel: t('common.delete') })) void deleteSession(s.id) }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {editing && <SessionSheet itemId={item.id} session={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SessionSheet({ itemId, session, onClose }: { itemId: string; session: Session | null; onClose: () => void }) {
  const all = useApp((s) => s.data.sessions)
  const byId = useApp((s) => s.data.items)
  const runningNow = all.find((x) => !x.ended_at)
  const defEnd = new Date()
  defEnd.setSeconds(0, 0)
  // A new manual session ends where a running timer started, so they do not overlap.
  if (!session && runningNow && Date.parse(runningNow.started_at) < defEnd.getTime()) defEnd.setTime(Date.parse(runningNow.started_at))
  const defStart = new Date(defEnd.getTime() - MS_HOUR)
  const [start, setStart] = useState(toLocalInput(session?.started_at ?? defStart.toISOString()))
  const [end, setEnd] = useState(toLocalInput(session?.ended_at ?? defEnd.toISOString()))
  const ordered = !!start && !!end && new Date(end).getTime() > new Date(start).getTime()
  const a = ordered ? new Date(start).getTime() : 0
  const b = ordered ? new Date(end).getTime() : 0
  const clash = ordered ? all.find((x) => x.id !== session?.id && Date.parse(x.started_at) < b && (x.ended_at ? Date.parse(x.ended_at) : Date.now()) > a) : undefined
  const valid = ordered && !clash
  const dur = ordered ? b - a : 0
  return (
    <Sheet open onClose={onClose} title={session ? t('log.edit') : t('log.add')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          const s = new Date(start).toISOString(), en = new Date(end).toISOString()
          if (session) void updateSession(session.id, { started_at: s, ended_at: en })
          else void addSession(itemId, s, en)
          onClose()
        }}
      >
        <Field label={t('log.start')}><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
        <Field label={t('log.end')}><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
        <div className={cx('text-sm', valid ? 'text-muted' : 'text-danger')}>
          {!ordered ? t('log.invalid') : clash ? t('log.overlap', { title: byId.find((i) => i.id === clash.item_id)?.title ?? '…', range: `${new Date(clash.started_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}–${clash.ended_at ? new Date(clash.ended_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : t('log.running')}` }) : fmtDuration(dur)}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!valid}>{t('common.save')}</Button>
        </div>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------- costs
export function useMoney() {
  const currency = useApp((s) => s.data.settings.currency)
  return useMemo(() => {
    let f: Intl.NumberFormat
    try { f = new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'ILS', maximumFractionDigits: 2 }) } catch { f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }) }
    return (n: number) => f.format(Number.isFinite(n) ? n : 0)
  }, [currency])
}

export function CostsTab({ item, totalMs }: { item: Item; totalMs: number }) {
  const items = useApp((s) => s.data.items)
  const lines = useApp((s) => s.data.cost_lines)
  const { hourly_rate, markup_pct } = useApp((s) => s.data.settings)
  const money = useMoney()
  const desc = useMemo(() => descendantIds(items, item.id), [items, item.id])
  const own = lines.filter((l) => l.item_id === item.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const ownSum = own.reduce((n, l) => n + l.qty * l.unit_cost, 0)
  const subSum = lines.filter((l) => desc.has(l.item_id)).reduce((n, l) => n + l.qty * l.unit_cost, 0)
  const hours = totalMs / MS_HOUR
  const timeCost = hours * hourly_rate
  const base = ownSum + subSum + timeCost
  const price = base * (1 + markup_pct / 100)
  const [focusId, setFocusId] = useState<string | null>(null)

  return (
    <div className="rise flex flex-col gap-4">
      <div className="overflow-hidden rounded-3xl bg-surface border border-line">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h3 className="font-display text-lg font-semibold">{t('costs.materials')}</h3>
          <Button size="sm" variant="soft" onClick={() => setFocusId(addCost(item.id, ''))}><Plus size={15} /> {t('costs.add')}</Button>
        </div>
        {!own.length && <p className="px-5 pb-5 text-sm text-muted">{t('costs.empty')}</p>}
        {own.length > 0 && (
          <div className="px-3 pb-3">
            <div className="grid grid-cols-[1fr_56px_88px_32px] gap-2 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
              <span>{t('costs.label')}</span><span>{t('costs.qty')}</span><span>{t('costs.unit')}</span><span />
            </div>
            {own.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_56px_88px_32px] items-center gap-2 px-1 py-1">
                <CostInput autoFocus={focusId === l.id} value={l.label} placeholder={t('costs.newLabel')} onCommit={(v) => updateCost(l.id, { label: v })} />
                <CostInput numeric value={String(l.qty)} onCommit={(v) => updateCost(l.id, { qty: Number(v) || 0 })} />
                <CostInput numeric value={String(l.unit_cost)} onCommit={(v) => updateCost(l.id, { unit_cost: Number(v) || 0 })} />
                <IconButton label={t('common.delete')} className="h-8 w-8" onClick={() => deleteCost(l.id)}><Trash2 size={15} /></IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl bg-surface p-5 border border-line">
        <Row label={t('costs.ownMaterials')} value={money(ownSum)} />
        {desc.size > 0 && <Row label={t('costs.subMaterials')} value={money(subSum)} />}
        <Row
          label={<>{t('costs.time')} <span className="text-muted">· {fmtDuration(totalMs)} × {money(hourly_rate)}/h</span></>}
          value={money(timeCost)}
        />
        {markup_pct !== 0 && <Row label={`${t('costs.markup')} ${markup_pct}%`} value={money(price - base)} />}
        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="font-display text-lg font-semibold">{t('costs.suggested')}</span>
          <span className="font-display text-3xl font-semibold text-accent-strong tabular">{money(price)}</span>
        </div>
        {!hourly_rate && <p className="mt-3 text-[13px] text-muted"><Link to="/settings" className="underline decoration-accent/50 underline-offset-2">{t('costs.noRate')}</Link></p>}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[15px]">
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular">{value}</span>
    </div>
  )
}

function CostInput({ value, onCommit, numeric, placeholder, autoFocus }: { value: string; onCommit: (v: string) => void; numeric?: boolean; placeholder?: string; autoFocus?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      value={v}
      dir={numeric ? undefined : 'auto'}
      autoFocus={autoFocus}
      placeholder={placeholder}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => setV(numeric ? e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.') : e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cx('h-9 w-full min-w-0 rounded-lg border border-transparent bg-surface-2/60 px-2 text-sm outline-none transition focus:border-accent focus:bg-surface', numeric && 'text-right tabular')}
    />
  )
}
