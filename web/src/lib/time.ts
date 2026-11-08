import type { Item, Session } from './types'

export const MS_MIN = 60_000
export const MS_HOUR = 3_600_000

export function sessionMs(s: Session, now: number): number {
  const start = Date.parse(s.started_at)
  const end = s.ended_at ? Date.parse(s.ended_at) : now
  return Math.max(0, end - start)
}

/** "2h 05m", "14m", "45s" */
export function fmtDuration(ms: number, opts: { seconds?: boolean } = {}): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (opts.seconds) {
    if (h) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
    if (m) return `${m}m ${String(s).padStart(2, '0')}s`
    return `${s}s`
  }
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m`
  return totalSec > 0 ? `${s}s` : '0m'
}

/** "1:02:03" style clock. */
export function fmtClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtHours(ms: number): string {
  const h = ms / MS_HOUR
  if (h >= 10) return `${Math.round(h)}h`
  return `${(Math.round(h * 10) / 10).toString()}h`
}

export function startOfWeek(d: Date, weekStartsOn: number): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const diff = (x.getDay() - weekStartsOn + 7) % 7
  x.setDate(x.getDate() - diff)
  return x
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Milliseconds of a session that fall inside [from, to). */
export function overlapMs(s: Session, from: number, to: number, now: number): number {
  const a = Math.max(Date.parse(s.started_at), from)
  const b = Math.min(s.ended_at ? Date.parse(s.ended_at) : now, to)
  return Math.max(0, b - a)
}

export interface Totals {
  /** Own time of the item (its sessions only). */
  own: Map<string, number>
  /** Own + all descendants. */
  total: Map<string, number>
}

/**
 * Closed-session totals per item, rolled up the tree. Computed once per data change; the
 * running session is added on top every tick by liveTotals() so parents tick live.
 */
export function closedTotals(items: Item[], sessions: Session[]): Totals {
  const own = new Map<string, number>()
  for (const s of sessions) {
    if (!s.ended_at) continue
    own.set(s.item_id, (own.get(s.item_id) ?? 0) + sessionMs(s, 0))
  }
  const total = new Map<string, number>()
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const [id, ms] of own) {
    let cur: Item | undefined = byId.get(id)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      total.set(cur.id, (total.get(cur.id) ?? 0) + ms)
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
    }
  }
  return { own, total }
}

/** Ancestor chain of an item, from the item itself up to the root. */
export function chainUp(itemId: string, byId: Map<string, Item>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cur = byId.get(itemId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.push(cur.id)
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return out
}

export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
