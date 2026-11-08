import { useEffect, useMemo, useState } from 'react'
import { useApp, ensureUrls } from '../store/app'
import { chainUp, closedTotals, overlapMs, sessionMs, startOfWeek } from './time'
import type { Item, Media } from './types'

/** Current time, re-rendering every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) { setNow(Date.now()); return }
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return now
}

export function useRunning() {
  const sessions = useApp((s) => s.data.sessions)
  return useMemo(() => sessions.find((s) => !s.ended_at), [sessions])
}

export function useItemsMap() {
  const items = useApp((s) => s.data.items)
  return useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
}

/** Live totals: closed sessions are memoized, the running session is added on every tick. */
export function useTotals() {
  const items = useApp((s) => s.data.items)
  const sessions = useApp((s) => s.data.sessions)
  const running = useRunning()
  const now = useNow(!!running)
  const byId = useItemsMap()
  const closed = useMemo(() => closedTotals(items, sessions), [items, sessions])
  const live = useMemo(() => {
    if (!running) return null
    return { ms: sessionMs(running, now), chain: new Set(chainUp(running.item_id, byId)), item: running.item_id }
  }, [running, now, byId])
  return useMemo(() => ({
    total: (id: string) => (closed.total.get(id) ?? 0) + (live && live.chain.has(id) ? live.ms : 0),
    own: (id: string) => (closed.own.get(id) ?? 0) + (live && live.item === id ? live.ms : 0),
    runningItemId: running?.item_id ?? null,
    runningChain: live?.chain ?? new Set<string>(),
    now,
  }), [closed, live, running, now])
}

/** Time worked this week, optionally limited to a set of item ids. */
export function useWeekTotal(itemIds?: Set<string>) {
  const sessions = useApp((s) => s.data.sessions)
  const weekStart = useApp((s) => s.data.settings.week_starts_on)
  const running = useRunning()
  const now = useNow(!!running, 15000)
  return useMemo(() => {
    const from = startOfWeek(new Date(now), weekStart).getTime()
    const to = from + 7 * 86400_000
    let ms = 0
    for (const s of sessions) if (!itemIds || itemIds.has(s.item_id)) ms += overlapMs(s, from, to, now)
    return ms
  }, [sessions, weekStart, now, itemIds])
}

/** Picks the media to show on an item's tile: its cover, else its newest photo, else a descendant's. */
export function useCoverFor() {
  const items = useApp((s) => s.data.items)
  const media = useApp((s) => s.data.media)
  return useMemo(() => {
    const byItem = new Map<string, Media[]>()
    for (const m of media) byItem.set(m.item_id, [...(byItem.get(m.item_id) ?? []), m])
    const mediaById = new Map(media.map((m) => [m.id, m]))
    const kids = new Map<string, Item[]>()
    for (const i of items) if (i.parent_id) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i])
    const memo = new Map<string, Media | null>()
    const pick = (it: Item, depth = 0): Media | null => {
      if (memo.has(it.id)) return memo.get(it.id)!
      let m: Media | null = null
      if (it.cover_media_id) m = mediaById.get(it.cover_media_id) ?? null
      if (!m) {
        const own = byItem.get(it.id) ?? []
        m = [...own].sort((a, b) => (a.phase === 'finished' ? -1 : 0) - (b.phase === 'finished' ? -1 : 0) || b.created_at.localeCompare(a.created_at))[0] ?? null
      }
      if (!m && depth < 6) for (const k of kids.get(it.id) ?? []) { m = pick(k, depth + 1); if (m) break }
      memo.set(it.id, m)
      return m
    }
    return { cover: (it: Item) => pick(it), countMedia: (id: string) => byItem.get(id)?.length ?? 0, countKids: (id: string) => kids.get(id)?.length ?? 0 }
  }, [items, media])
}

/** Returns a displayable URL for a storage key (loads it lazily). */
export function useMediaUrl(key: string | null | undefined): string | undefined {
  const url = useApp((s) => (key ? s.urls[key] : undefined))
  useEffect(() => {
    if (key && !url) void ensureUrls([key])
  }, [key, url])
  return url
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}

export function useLocalPref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { return (localStorage.getItem(key) as T) || initial } catch { return initial }
  })
  return [v, (nv: T) => { setV(nv); try { localStorage.setItem(key, nv) } catch { /* ignore */ } }]
}
