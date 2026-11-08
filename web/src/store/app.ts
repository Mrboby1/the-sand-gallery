import { create } from 'zustand'
import { backend } from '../lib/backend'
import type { HealthState } from '../lib/backend/types'
import { isNetworkError } from '../lib/backend/supabase'
import type {
  AppUser, CostLine, Item, Media, Session, Settings, ShareLink, Snapshot, Status, TableName, Template, TemplateNode,
} from '../lib/types'
import { DEFAULT_SETTINGS } from '../lib/types'
import { t } from '../i18n'
import { makeUploadParts } from '../lib/media'

export type Phase = 'booting' | 'signedOut' | 'loading' | 'ready'

export interface Toast { id: number; text: string; tone?: 'info' | 'error'; action?: { label: string; run: () => void } }
export interface Upload { id: string; itemId: string; name: string; progress: number; error?: string }

const emptySnap = (): Snapshot => ({
  items: [], statuses: [], sessions: [], media: [], cost_lines: [], templates: [], share_links: [], settings: { ...DEFAULT_SETTINGS },
})

interface State {
  phase: Phase
  user: AppUser | null
  data: Snapshot
  health: HealthState
  wakeError: string | null
  toasts: Toast[]
  uploads: Upload[]
  urls: Record<string, string>
  /** Changes made offline that are waiting to be sent. */
  queued: number
}

const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

export const useApp = create<State>(() => ({
  phase: 'booting',
  user: null,
  data: emptySnap(),
  health: 'up',
  wakeError: null,
  toasts: [],
  uploads: [],
  urls: {},
  queued: 0,
}))

const get = useApp.getState
const set = useApp.setState

// ---------------------------------------------------------------- toasts
let toastSeq = 1
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
  const id = toastSeq++
  set((s) => ({ toasts: [...s.toasts, { id, text, tone, action }] }))
  setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : action ? 5000 : 3200)
}
export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

function isAuthError(e: unknown): boolean {
  const m = errMsg(e)
  const code = (e as { code?: string })?.code ?? ''
  return /JWT|jwt|not signed in|owner_id_fkey|401/.test(m) || code === 'PGRST301' || code === '42501'
}

/** A short, human message for an error; the raw one goes to the console. */
export function friendlyError(e: unknown): { text: string; action?: Toast['action'] } {
  console.error(e)
  if (isNetworkError(e)) return { text: t('sync.offline') }
  if (isAuthError(e)) return { text: t('error.session'), action: { label: t('error.signIn'), run: () => void signOut() } }
  return { text: t('error.save') }
}

// ---------------------------------------------------------------- local cache (offline start)
const CACHE_KEY = 'sg.cache.v1'
let cacheTimer: ReturnType<typeof setTimeout> | undefined

function readCache(): { user: AppUser; data: Snapshot } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as { user: AppUser; data: Snapshot }) : null
  } catch { return null }
}
useApp.subscribe((s, prev) => {
  if (s.phase !== 'ready' || !s.user || (s.data === prev.data && s.user === prev.user)) return
  clearTimeout(cacheTimer)
  cacheTimer = setTimeout(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ user: s.user, data: get().data })) } catch { /* quota: ignore */ }
  }, 400)
})

// ---------------------------------------------------------------- outbox (offline queue)
/** A persisted, replayable change. Everything the app writes goes through one of these. */
type Op =
  | { k: 'insert'; table: TableName; rows: unknown[] }
  | { k: 'update'; table: TableName; id: string; patch: Record<string, unknown> }
  | { k: 'remove'; table: TableName; ids: string[] }
  | { k: 'settings'; s: Settings }
  | { k: 'start'; itemId: string; sessionId: string; at: string }
  | { k: 'stop'; at: string }
  | { k: 'objects'; keys: string[] }
interface Queued { op: Op; at: number; uid: string }

const OUTBOX_KEY = 'sg.outbox.v1'
let outbox: Queued[] = (() => {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as Queued[] } catch { return [] }
})()
function saveOutbox() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)) } catch { /* ignore */ }
  set({ queued: outbox.length })
}
set({ queued: outbox.length })

let lastLocalWrite = 0
let flushing: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | undefined
let offlineNotified = false

async function runOp(op: Op, fresh: boolean) {
  switch (op.k) {
    case 'insert': return backend.insert(op.table, op.rows as never)
    case 'update': return backend.update(op.table, op.id, op.patch as never)
    case 'remove': return backend.remove(op.table, op.ids)
    case 'settings': return backend.saveSettings(op.s)
    case 'objects': return backend.deleteMediaObjects(op.keys)
    case 'start': {
      // Fresh calls use the server clock; replayed ones keep the time the tap really happened.
      const server = await backend.startTimer(op.itemId, op.sessionId, fresh ? null : op.at)
      set((st) => ({ data: { ...st.data, sessions: st.data.sessions.map((x) => (x.id === op.sessionId ? { ...x, ...server } : x)) } }))
      return
    }
    case 'stop': {
      const closed = await backend.stopTimer(fresh ? null : op.at)
      if (closed) set((st) => ({ data: { ...st.data, sessions: st.data.sessions.map((x) => (x.id === closed.id ? { ...x, ...closed } : x)) } }))
      return
    }
  }
}

/** Sends queued changes in order. Network failure: keep them and retry later. Other failure: drop + tell. */
export function flush(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    let hadError = false
    while (outbox.length) {
      const q = outbox[0]
      const uid = get().user?.id
      if (!uid) break
      if (q.uid !== uid) { outbox.shift(); saveOutbox(); continue }
      try {
        await runOp(q.op, Date.now() - q.at < 15_000)
        outbox.shift()
        saveOutbox()
      } catch (e) {
        if (isNetworkError(e)) {
          if (get().health === 'up') set({ health: 'unreachable' })
          if (!offlineNotified) { offlineNotified = true; toast(t('sync.offline')) }
          clearTimeout(retryTimer)
          retryTimer = setTimeout(() => void resync(), 20_000)
          break
        }
        outbox.shift()
        saveOutbox()
        hadError = true
        const f = friendlyError(e)
        toast(f.text, 'error', f.action)
      }
    }
    lastLocalWrite = Date.now()
    if (hadError) await backend.loadAll().then((data) => set({ data })).catch(() => {})
  })().finally(() => { flushing = null })
  return flushing
}

/** Apply a change to the UI at once, queue it, and send it (now if online, later if not). */
function commit(local: (d: Snapshot) => Snapshot, ops: Op[]): Promise<void> {
  set((s) => ({ data: local(s.data) }))
  lastLocalWrite = Date.now()
  const uid = get().user?.id ?? ''
  for (const op of ops) outbox.push({ op, at: Date.now(), uid })
  saveOutbox()
  return flush()
}

// ---------------------------------------------------------------- boot / sync
let unsubRemote: (() => void) | null = null
let booted = false
let loading: Promise<void> | null = null

export async function boot() {
  if (booted) return
  booted = true
  backend.onAuthChange((user) => {
    const prev = get().user
    set({ user })
    if (user && (!prev || prev.id !== user.id)) void flush().then(loadData)
    if (!user && prev) {
      set({ phase: 'signedOut', data: emptySnap() })
      unsubRemote?.(); unsubRemote = null
      try { localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
    }
  })
  window.addEventListener('online', () => void resync())
  window.addEventListener('offline', () => { if (get().health === 'up') set({ health: 'unreachable' }) })

  const cached = readCache()
  const h = await backend.health()
  set({ health: h })
  if (h !== 'up') {
    // getUser may try a token refresh that cannot succeed offline: do not wait for it
    const user = (await Promise.race([backend.getUser().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2500))])) ?? cached?.user ?? null
    if (user && cached && cached.user.id === user.id) {
      // Offline (or asleep): open the last copy of the gallery; changes queue up and sync later.
      set({ user, data: cached.data, phase: 'ready' })
      return
    }
    set({ user, phase: user ? 'loading' : 'signedOut' })
    return
  }
  const user = await backend.getUser()
  set({ user })
  if (!user) { set({ phase: 'signedOut' }); return }
  if (cached && cached.user.id === user.id) set({ data: cached.data, phase: 'ready' }) // instant first paint
  await flush()
  await loadData()
}

export function loadData(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    if (get().phase !== 'ready') set({ phase: 'loading' })
    try {
      const data = await backend.loadAll()
      set({ data, phase: 'ready' })
      if (!unsubRemote) unsubRemote = backend.subscribe(() => scheduleRemoteReload())
    } catch (e) {
      const h = await backend.health()
      set({ health: h })
      const cached = readCache()
      if (get().phase !== 'ready' && cached && cached.user.id === get().user?.id) set({ data: cached.data, phase: 'ready' })
      if (h === 'up') { const f = friendlyError(e); toast(f.text, 'error', f.action) }
    }
  })().finally(() => { loading = null })
  return loading
}

function scheduleRemoteReload() {
  // Our own writes echo back through realtime; wait until nothing is queued or in flight.
  const wait = Math.max(0, lastLocalWrite + 1500 - Date.now())
  setTimeout(() => {
    if (outbox.length || flushing || Date.now() - lastLocalWrite < 1500) return scheduleRemoteReload()
    void backend.loadAll().then((data) => { if (!outbox.length) set({ data }) }).catch(() => {})
  }, wait)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && get().phase === 'ready') void resync()
  })
}

/** Back online (or tab visible again): check the server, send queued changes, refresh. */
export async function resync() {
  const h = await backend.health()
  set({ health: h })
  if (h !== 'up') return
  offlineNotified = false
  const hadQueue = outbox.length > 0
  await flush()
  if (!get().user) {
    const user = await backend.getUser().catch(() => null)
    if (user) set({ user })
    else { if (get().phase === 'loading') set({ phase: 'signedOut' }); return }
  }
  if (hadQueue && !outbox.length) toast(t('sync.synced'))
  if (get().phase !== 'ready') await loadData()
  else scheduleRemoteReload()
}

export async function checkHealth() {
  await resync()
  return get().health
}

export async function wakeUp() {
  set({ health: 'waking', wakeError: null })
  try {
    await backend.wake()
  } catch (e) {
    set({ wakeError: errMsg(e), health: 'asleep' })
    return
  }
  const started = Date.now()
  const poll = async (): Promise<void> => {
    const h = await backend.health()
    if (h === 'up') {
      set({ health: 'up' })
      const user = await backend.getUser()
      set({ user, phase: user ? (get().phase === 'ready' ? 'ready' : 'loading') : 'signedOut' })
      if (user) { await flush(); await loadData() }
      return
    }
    if (Date.now() - started > 8 * 60_000) { set({ health: 'asleep', wakeError: 'timeout' }); return }
    set({ health: h === 'asleep' ? 'waking' : h })
    await new Promise((r) => setTimeout(r, 5000))
    return poll()
  }
  await poll()
}

// ---------------------------------------------------------------- auth
const NEXT_KEY = 'sg.afterLogin'
export const signIn = () => {
  try { if (location.pathname !== '/') sessionStorage.setItem(NEXT_KEY, location.pathname + location.search) } catch { /* ignore */ }
  return backend.signInWithGoogle()
}
/** Where to go after the OAuth round trip (deep link that was open when signing in). */
export function takeAfterLogin(): string | null {
  try { const v = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); return v } catch { return null }
}
export const signOut = () => backend.signOut()

// ---------------------------------------------------------------- tree helpers
export function childrenOf(items: Item[], parentId: string | null): Item[] {
  return items
    .filter((i) => i.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}
export function descendantIds(items: Item[], rootId: string): Set<string> {
  const kids = new Map<string, string[]>()
  for (const i of items) if (i.parent_id) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i.id])
  const out = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    for (const k of kids.get(id) ?? []) if (!out.has(k)) { out.add(k); stack.push(k) }
  }
  return out
}
function nextSort(items: Item[], parentId: string | null) {
  const sibs = items.filter((i) => i.parent_id === parentId)
  return sibs.length ? Math.max(...sibs.map((s) => s.sort_order)) + 1 : 1
}

// ---------------------------------------------------------------- items
function newItem(parentId: string | null, title: string, sort: number, extra: Partial<Item> = {}): Item {
  const ts = now()
  return {
    id: uuid(), parent_id: parentId, title, notes: '', status_id: null, tags: [], due_date: null,
    cover_media_id: null, sort_order: sort, created_at: ts, updated_at: ts, ...extra,
  }
}

function expandTemplate(nodes: TemplateNode[], parentId: string, out: Item[]) {
  nodes.forEach((n, i) => {
    const it = newItem(parentId, n.title, i + 1, { tags: n.tags ?? [] })
    out.push(it)
    if (n.children?.length) expandTemplate(n.children, it.id, out)
  })
}

/**
 * Creates a new item. With a template: the new item gets the template's item title (unless a title is
 * typed) and tags, and the template's whole sub-item tree inside it.
 */
export async function createItem(parentId: string | null, title: string, templateId?: string): Promise<string> {
  const d = get().data
  const tpl = templateId ? d.templates.find((x) => x.id === templateId) : undefined
  const defaultStatus = [...d.statuses].sort((a, b) => a.sort_order - b.sort_order)[0]?.id ?? null
  const root = newItem(parentId, title.trim() || tpl?.item_title || tpl?.name || t('item.untitled'), nextSort(d.items, parentId), {
    tags: [...(tpl?.tags ?? [])], status_id: defaultStatus,
  })
  const rows = [root]
  if (tpl) expandTemplate(tpl.tree, root.id, rows)
  for (const r of rows.slice(1)) r.status_id = defaultStatus
  await commit((s) => ({ ...s, items: [...s.items, ...rows] }), [{ k: 'insert', table: 'items', rows }])
  return root.id
}

export function updateItem(id: string, patch: Partial<Item>) {
  return commit(
    (s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch, updated_at: now() } : i)) }),
    [{ k: 'update', table: 'items', id, patch }],
  )
}

export function moveItem(id: string, newParent: string | null) {
  const d = get().data
  if (newParent && (newParent === id || descendantIds(d.items, id).has(newParent))) return
  return updateItem(id, { parent_id: newParent, sort_order: nextSort(d.items, newParent) })
}

export async function deleteItem(id: string) {
  const d = get().data
  const ids = new Set([id, ...descendantIds(d.items, id)])
  const media = d.media.filter((m) => ids.has(m.item_id))
  const running = d.sessions.find((s) => !s.ended_at && ids.has(s.item_id))
  if (running) await stopTimer()
  const keys = media.flatMap((m) => [m.object_key, m.thumb_key].filter(Boolean) as string[])
  await commit(
    (s) => ({
      ...s,
      items: s.items.filter((i) => !ids.has(i.id)),
      sessions: s.sessions.filter((x) => !ids.has(x.item_id)),
      media: s.media.filter((m) => !ids.has(m.item_id)),
      cost_lines: s.cost_lines.filter((c) => !ids.has(c.item_id)),
      share_links: s.share_links.filter((l) => !ids.has(l.item_id)),
    }),
    [{ k: 'remove', table: 'items', ids: [id] }, ...(keys.length ? [{ k: 'objects', keys } as Op] : [])],
  )
}

export async function duplicateItem(id: string): Promise<string | null> {
  const d = get().data
  const src = d.items.find((i) => i.id === id)
  if (!src) return null
  const rows: Item[] = []
  const copy = (it: Item, parent: string | null, sort: number, suffix: string) => {
    const c = newItem(parent, it.title + suffix, sort, { tags: [...it.tags], status_id: it.status_id, notes: it.notes, due_date: it.due_date })
    rows.push(c)
    childrenOf(d.items, it.id).forEach((k, i) => copy(k, c.id, i + 1, ''))
  }
  copy(src, src.parent_id, nextSort(d.items, src.parent_id), ' (copy)')
  await commit((s) => ({ ...s, items: [...s.items, ...rows] }), [{ k: 'insert', table: 'items', rows }])
  return rows[0].id
}

// ---------------------------------------------------------------- timer
export function startTimer(itemId: string) {
  const sid = uuid()
  const ts = now()
  return commit(
    (s) => ({
      ...s,
      sessions: [...s.sessions.map((x) => (x.ended_at ? x : { ...x, ended_at: ts })), { id: sid, item_id: itemId, started_at: ts, ended_at: null }],
    }),
    [{ k: 'start', itemId, sessionId: sid, at: ts }],
  )
}

export function stopTimer() {
  const ts = now()
  return commit(
    (s) => ({ ...s, sessions: s.sessions.map((x) => (x.ended_at ? x : { ...x, ended_at: ts })) }),
    [{ k: 'stop', at: ts }],
  )
}

export function addSession(itemId: string, startedAt: string, endedAt: string) {
  const row: Session = { id: uuid(), item_id: itemId, started_at: startedAt, ended_at: endedAt }
  return commit((s) => ({ ...s, sessions: [...s.sessions, row] }), [{ k: 'insert', table: 'sessions', rows: [row] }])
}
export function updateSession(id: string, patch: Partial<Session>) {
  return commit(
    (s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
    [{ k: 'update', table: 'sessions', id, patch }],
  )
}
export function deleteSession(id: string) {
  return commit((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id) }), [{ k: 'remove', table: 'sessions', ids: [id] }])
}

// ---------------------------------------------------------------- media
const uploadFilesById = new Map<string, File>()

async function runUpload(uid: string, itemId: string, file: File) {
  const setU = (patch: Partial<Upload>) => set((s) => ({ uploads: s.uploads.map((u) => (u.id === uid ? { ...u, ...patch } : u)) }))
  setU({ progress: 0, error: undefined })
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setU({ error: t('upload.offline') }); return }
  let res: Awaited<ReturnType<typeof backend.uploadMedia>> | null = null
  try {
    const prep = await makeUploadParts(file)
    res = await backend.uploadMedia(itemId, prep.parts, (p) => setU({ progress: p }))
    const row: Media = {
      id: uuid(), item_id: itemId, object_key: res.object_key, thumb_key: res.thumb_key, kind: prep.kind,
      mime: file.type, size_bytes: file.size, width: prep.width, height: prep.height, duration_s: prep.duration,
      phase: 'process', created_at: now(),
    }
    try {
      await backend.insert('media', [row])
    } catch (e) {
      if (!isNetworkError(e)) throw e
      outbox.push({ op: { k: 'insert', table: 'media', rows: [row] }, at: Date.now(), uid: get().user?.id ?? '' }) // stored; row syncs later
      saveOutbox()
    }
    set((s) => ({ data: { ...s.data, media: [...s.data.media, row] }, uploads: s.uploads.filter((u) => u.id !== uid) }))
    uploadFilesById.delete(uid)
    lastLocalWrite = Date.now()
    // First photo becomes the cover automatically.
    const it = get().data.items.find((i) => i.id === itemId)
    if (it && !it.cover_media_id) void updateItem(itemId, { cover_media_id: row.id })
  } catch (e) {
    // Final failure: nothing may stay behind in storage without a row pointing at it.
    if (res) await backend.deleteMediaObjects([res.object_key, res.thumb_key].filter(Boolean) as string[]).catch(() => {})
    console.error('upload failed', e)
    setU({ error: isNetworkError(e) ? t('upload.offline') : t('upload.failed') })
  }
}

export async function uploadFiles(itemId: string, files: File[]) {
  const accepted = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
  await Promise.all(accepted.map((file) => {
    const uid = uuid()
    uploadFilesById.set(uid, file)
    set((s) => ({ uploads: [...s.uploads, { id: uid, itemId, name: file.name, progress: 0 }] }))
    return runUpload(uid, itemId, file)
  }))
}
export function retryUpload(uid: string) {
  const u = get().uploads.find((x) => x.id === uid)
  const f = uploadFilesById.get(uid)
  if (u && f) void runUpload(uid, u.itemId, f)
}
export function dismissUpload(uid: string) {
  uploadFilesById.delete(uid)
  set((s) => ({ uploads: s.uploads.filter((u) => u.id !== uid) }))
}

export function updateMedia(id: string, patch: Partial<Media>) {
  return commit(
    (s) => ({ ...s, media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
    [{ k: 'update', table: 'media', id, patch }],
  )
}

export async function deleteMedia(id: string) {
  const m = get().data.media.find((x) => x.id === id)
  if (!m) return
  await commit(
    (s) => ({
      ...s,
      media: s.media.filter((x) => x.id !== id),
      items: s.items.map((i) => (i.cover_media_id === id ? { ...i, cover_media_id: null } : i)),
    }),
    [{ k: 'remove', table: 'media', ids: [id] }, { k: 'objects', keys: [m.object_key, m.thumb_key].filter(Boolean) as string[] }],
  )
}

const inflight = new Set<string>()
/** Ensures URLs for the given storage keys are in the store (batched). */
export async function ensureUrls(keys: string[]) {
  const have = get().urls
  const need = [...new Set(keys)].filter((k) => k && !have[k] && !inflight.has(k))
  if (!need.length) return
  need.forEach((k) => inflight.add(k))
  try {
    const urls = await backend.mediaUrls(need)
    set((s) => ({ urls: { ...s.urls, ...urls } }))
  } catch { /* shown as placeholders */ } finally {
    need.forEach((k) => inflight.delete(k))
  }
}

// ---------------------------------------------------------------- costs
export function addCost(itemId: string, label: string) {
  const row: CostLine = { id: uuid(), item_id: itemId, label, qty: 1, unit_cost: 0, created_at: now() }
  void commit((s) => ({ ...s, cost_lines: [...s.cost_lines, row] }), [{ k: 'insert', table: 'cost_lines', rows: [row] }])
  return row.id
}
export function updateCost(id: string, patch: Partial<CostLine>) {
  return commit(
    (s) => ({ ...s, cost_lines: s.cost_lines.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
    [{ k: 'update', table: 'cost_lines', id, patch }],
  )
}
export function deleteCost(id: string) {
  return commit((s) => ({ ...s, cost_lines: s.cost_lines.filter((c) => c.id !== id) }), [{ k: 'remove', table: 'cost_lines', ids: [id] }])
}

// ---------------------------------------------------------------- statuses
export function addStatus(name: string, color: string) {
  const d = get().data
  const row: Status = { id: uuid(), name, color, sort_order: d.statuses.length ? Math.max(...d.statuses.map((s) => s.sort_order)) + 1 : 0 }
  return commit((s) => ({ ...s, statuses: [...s.statuses, row] }), [{ k: 'insert', table: 'statuses', rows: [row] }])
}
export function updateStatus(id: string, patch: Partial<Status>) {
  return commit(
    (s) => ({ ...s, statuses: s.statuses.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
    [{ k: 'update', table: 'statuses', id, patch }],
  )
}
export function deleteStatus(id: string) {
  return commit(
    (s) => ({ ...s, statuses: s.statuses.filter((x) => x.id !== id), items: s.items.map((i) => (i.status_id === id ? { ...i, status_id: null } : i)) }),
    [{ k: 'remove', table: 'statuses', ids: [id] }],
  )
}
export async function moveStatus(id: string, dir: -1 | 1) {
  const list = [...get().data.statuses].sort((a, b) => a.sort_order - b.sort_order)
  const i = list.findIndex((s) => s.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  const renum = list.map((s, k) => ({ ...s, sort_order: k }))
  const changed = renum.filter((s) => get().data.statuses.find((o) => o.id === s.id)?.sort_order !== s.sort_order)
  await commit((s) => ({ ...s, statuses: renum }), changed.map((c) => ({ k: 'update', table: 'statuses', id: c.id, patch: { sort_order: c.sort_order } }) as Op))
}

// ---------------------------------------------------------------- templates
function toTree(items: Item[], parentId: string): TemplateNode[] {
  return childrenOf(items, parentId).map((c) => {
    const kids = toTree(items, c.id)
    return { title: c.title, ...(c.tags.length ? { tags: c.tags } : {}), ...(kids.length ? { children: kids } : {}) }
  })
}
export function findTemplateByName(name: string): Template | undefined {
  const n = name.trim().toLowerCase()
  return get().data.templates.find((x) => x.name.trim().toLowerCase() === n)
}
/** Saves an item (its title, tags and whole sub-item tree) as a template. Replaces a template of the same name. */
export async function saveAsTemplate(itemId: string, name: string) {
  const d = get().data
  const it = d.items.find((i) => i.id === itemId)
  if (!it || !name.trim()) return
  const body = { name: name.trim(), item_title: it.title, tags: [...it.tags], tree: toTree(d.items, itemId) }
  const existing = findTemplateByName(name)
  if (existing) await updateTemplate(existing.id, body)
  else await addTemplate(body)
  toast(t('item.templateSaved', { name: body.name }))
}
export function addTemplate(tpl: Omit<Template, 'id' | 'created_at'>) {
  const row: Template = { ...tpl, id: uuid(), created_at: now() }
  return commit((s) => ({ ...s, templates: [...s.templates, row] }), [{ k: 'insert', table: 'templates', rows: [row] }])
}
export function updateTemplate(id: string, patch: Partial<Template>) {
  return commit(
    (s) => ({ ...s, templates: s.templates.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
    [{ k: 'update', table: 'templates', id, patch }],
  )
}
export function deleteTemplate(id: string) {
  return commit((s) => ({ ...s, templates: s.templates.filter((x) => x.id !== id) }), [{ k: 'remove', table: 'templates', ids: [id] }])
}

// ---------------------------------------------------------------- share links
function token(): string {
  const b = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export async function createShare(itemId: string): Promise<ShareLink> {
  const row: ShareLink = { id: uuid(), item_id: itemId, token: token(), created_at: now(), revoked_at: null }
  await commit((s) => ({ ...s, share_links: [...s.share_links, row] }), [{ k: 'insert', table: 'share_links', rows: [row] }])
  return row
}
export function revokeShare(id: string) {
  const ts = now()
  return commit(
    (s) => ({ ...s, share_links: s.share_links.map((l) => (l.id === id ? { ...l, revoked_at: ts } : l)) }),
    [{ k: 'update', table: 'share_links', id, patch: { revoked_at: ts } }],
  )
}
export const shareUrl = (l: ShareLink) => `${window.location.origin}/s/${l.token}`

// ---------------------------------------------------------------- settings
export function saveSettings(patch: Partial<Settings>) {
  const next = { ...get().data.settings, ...patch }
  return commit((s) => ({ ...s, settings: next }), [{ k: 'settings', s: next }])
}

export { backend }
