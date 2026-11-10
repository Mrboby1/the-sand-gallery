import { create } from 'zustand'
import { backend } from '../lib/backend'
import type { Access } from '../lib/backend/types'
import type { HealthState } from '../lib/backend/types'
import { isNetworkError } from '../lib/backend/supabase'
import type {
  AppUser, CostLine, Item, Media, Note, Session, Settings, ShareLink, Snapshot, Status, TableName, Template, TemplateNode,
} from '../lib/types'
import { DEFAULT_SETTINGS } from '../lib/types'
import { t } from '../i18n'
import { makeUploadParts } from '../lib/media'
import type { UploadPart } from '../lib/backend/types'
import { allJobs, askPersist, deleteJob, freeBytes, mb, putJob, type UploadJob } from '../lib/uploadQueue'

/** notAllowed: signed in to the online version with an account that is not on the allow-list. */
export type Phase = 'booting' | 'signedOut' | 'loading' | 'ready' | 'notAllowed'

export interface Toast { id: number; text: string; tone?: 'info' | 'error'; action?: { label: string; run: () => void } }
export interface PendingUpload {
  id: string; itemId: string; name: string; kind: 'photo' | 'video'; created_at: string; width: number | null; height: number | null
  /** stored on this device (survives closing the app) */
  persisted: boolean
  status: 'waiting' | 'uploading' | 'error'; progress: number; error?: string
}

const emptySnap = (): Snapshot => ({
  items: [],
  notes: [], statuses: [], sessions: [], media: [], cost_lines: [], templates: [], share_links: [], settings: { ...DEFAULT_SETTINGS },
})

interface State {
  phase: Phase
  user: AppUser | null
  data: Snapshot
  health: HealthState
  wakeError: string | null
  toasts: Toast[]
  /** Photos/videos waiting to upload (shown from the local copy). */
  pending: PendingUpload[]
  urls: Record<string, string>
  /** Changes made offline that are waiting to be sent. */
  queued: number
  /** Allow-list answer for the signed-in person (online version). */
  access: Access | null
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
  pending: [],
  urls: {},
  queued: 0,
  access: readAccess(),
}))

const get = useApp.getState
const set = useApp.setState

// ---------------------------------------------------------------- toasts
let toastSeq = 1
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ms?: number) {
  const id = toastSeq++
  set((s) => ({ toasts: [...s.toasts, { id, text, tone, action }] }))
  setTimeout(() => dismissToast(id), ms ?? (tone === 'error' ? 7000 : action ? 5000 : 3200))
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

// ---------------------------------------------------------------- allow-list answer (kept for offline starts)
const ACCESS_KEY = 'sg.access'
function readAccess(): Access | null {
  try { const raw = localStorage.getItem(ACCESS_KEY); return raw ? (JSON.parse(raw) as Access) : null } catch { return null }
}

// ---------------------------------------------------------------- local cache (offline start)
const CACHE_KEY = 'sg.cache.v1'
let cacheTimer: ReturnType<typeof setTimeout> | undefined

function readCache(): { user: AppUser; data: Snapshot } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as { user: AppUser; data: Snapshot }
    c.data.notes ??= [] // caches from before notes were a list
    return c
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
        await runOp(q.op, Date.now() - q.at < 2_000)
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
    if (user && (!prev || prev.id !== user.id)) void flush().then(loadData).then(restoreUploads)
    if (!user && prev) {
      set({ phase: 'signedOut', data: emptySnap() })
      unsubRemote?.(); unsubRemote = null
      try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(ACCESS_KEY) } catch { /* ignore */ }
      set({ access: null })
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
      void restoreUploads()
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
  await restoreUploads()
}

export function loadData(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    if (get().phase !== 'ready') set({ phase: 'loading' })
    try {
      if (backend.mode === 'cloud') {
        const a = await backend.access()
        set({ access: a })
        try { localStorage.setItem(ACCESS_KEY, JSON.stringify(a)) } catch { /* ignore */ }
        if (!a.allowed) { set({ phase: 'notAllowed' }); return }
      }
      const data = withoutPendingDeletes(await backend.loadAll())
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
    void backend.loadAll().then((data) => { if (!outbox.length) set({ data: withoutPendingDeletes(data) }) }).catch(() => {})
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
  void processUploads()
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
    cover_media_id: null, sort_order: sort, created_at: ts, updated_at: ts, kind: 'item', ...extra,
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

/** A folder: at the top level or inside another folder (never inside a project). */
export async function createFolder(parentId: string | null, title: string): Promise<string> {
  const d = get().data
  if (parentId && d.items.find((i) => i.id === parentId)?.kind !== 'folder') parentId = null
  const f = newItem(parentId, title.trim() || t('folder.untitled'), nextSort(d.items, parentId), { kind: 'folder' })
  await commit((s) => ({ ...s, items: [...s.items, f] }), [{ k: 'insert', table: 'items', rows: [f] }])
  return f.id
}

export function updateItem(id: string, patch: Partial<Item>) {
  // finished_at is kept by the database; mirror it locally so the gallery view switches at once
  const fin = (sid: string | null | undefined) => !!get().data.statuses.find((x) => x.id === sid)?.is_finished
  const local = (i: Item): Item => {
    const next = { ...i, ...patch, updated_at: now() }
    if ('status_id' in patch) next.finished_at = fin(patch.status_id) ? (fin(i.status_id) ? i.finished_at ?? now() : now()) : null
    return next
  }
  return commit(
    (s) => ({ ...s, items: s.items.map((i) => (i.id === id ? local(i) : i)) }),
    [{ k: 'update', table: 'items', id, patch }],
  )
}

export function moveItem(id: string, newParent: string | null) {
  const d = get().data
  if (newParent && (newParent === id || descendantIds(d.items, id).has(newParent))) return
  // a folder can only go to the top level or into another folder
  if (newParent && d.items.find((i) => i.id === id)?.kind === 'folder' && d.items.find((i) => i.id === newParent)?.kind !== 'folder') return
  return updateItem(id, { parent_id: newParent, sort_order: nextSort(d.items, newParent) })
}

export async function deleteItem(id: string, d: Snapshot = get().data) {
  const ids = new Set([id, ...descendantIds(d.items, id)])
  const media = d.media.filter((m) => ids.has(m.item_id))
  const running = d.sessions.find((s) => !s.ended_at && ids.has(s.item_id))
  if (running) await stopTimer()
  const keys = media.flatMap((m) => [m.object_key, m.thumb_key].filter(Boolean) as string[])
  for (const pu of get().pending) if (ids.has(pu.itemId)) void dropJob(pu.id)
  await commit(
    (s) => ({
      ...s,
      items: s.items.filter((i) => !ids.has(i.id)),
      sessions: s.sessions.filter((x) => !ids.has(x.item_id)),
      media: s.media.filter((m) => !ids.has(m.item_id)),
      cost_lines: s.cost_lines.filter((c) => !ids.has(c.item_id)),
      share_links: s.share_links.filter((l) => !ids.has(l.item_id)),
      notes: s.notes.filter((n) => !ids.has(n.item_id)),
    }),
    [{ k: 'remove', table: 'items', ids: [id] }, ...(keys.length ? [{ k: 'objects', keys } as Op] : [])],
  )
}

/** Items hidden by a delete that can still be undone (kept out of server reloads meanwhile). */
const pendingDeletes = new Set<string>()
export const withoutPendingDeletes = (data: Snapshot): Snapshot =>
  pendingDeletes.size ? { ...data, items: data.items.filter((i) => !pendingDeletes.has(i.id)) } : data

/** Hides the item (and its subtasks) at once and offers Undo for a few seconds before really deleting. */
export function deleteWithUndo(id: string) {
  const d0 = get().data
  const it = d0.items.find((i) => i.id === id)
  if (!it) return
  const ids = new Set([id, ...descendantIds(d0.items, id)])
  if (d0.sessions.some((s) => !s.ended_at && ids.has(s.item_id))) void stopTimer()
  const snapshot = get().data
  ids.forEach((x) => pendingDeletes.add(x))
  set((s) => ({ data: withoutPendingDeletes(s.data) }))
  let undone = false
  toast(t('item.deleted', { title: it.title }), 'info', {
    label: t('common.undo'),
    run: () => {
      undone = true
      ids.forEach((x) => pendingDeletes.delete(x))
      set((s) => ({ data: { ...s.data, items: [...s.data.items, ...snapshot.items.filter((i) => ids.has(i.id) && !s.data.items.some((x) => x.id === i.id))] } }))
    },
  })
  setTimeout(() => {
    if (undone) return
    void deleteItem(id, snapshot).finally(() => ids.forEach((x) => pendingDeletes.delete(x)))
  }, 5500)
}

export async function duplicateItem(id: string): Promise<string | null> {
  const d = get().data
  const src = d.items.find((i) => i.id === id)
  if (!src) return null
  const rows: Item[] = []
  const copy = (it: Item, parent: string | null, sort: number, suffix: string) => {
    const c = newItem(parent, it.title + suffix, sort, { tags: [...it.tags], status_id: it.status_id, notes: it.notes, due_date: it.due_date, kind: it.kind ?? 'item' })
    rows.push(c)
    childrenOf(d.items, it.id).forEach((k, i) => copy(k, c.id, i + 1, ''))
  }
  copy(src, src.parent_id, nextSort(d.items, src.parent_id), ' (copy)')
  // notes come along, attached to the copies
  const map = new Map<string, string>()
  const walk = (orig: Item, cp: Item) => { map.set(orig.id, cp.id); const ok = childrenOf(d.items, orig.id); const ck = rows.filter((r) => r.parent_id === cp.id); ok.forEach((o, i) => ck[i] && walk(o, ck[i])) }
  walk(src, rows[0])
  const ts = now()
  const noteRows: Note[] = d.notes.filter((n) => map.has(n.item_id)).map((n) => ({ id: uuid(), item_id: map.get(n.item_id)!, body: n.body, pinned: n.pinned, created_at: ts, updated_at: ts }))
  await commit(
    (s) => ({ ...s, items: [...s.items, ...rows], notes: [...s.notes, ...noteRows] }),
    [{ k: 'insert', table: 'items', rows }, ...(noteRows.length ? [{ k: 'insert', table: 'notes', rows: noteRows } as Op] : [])],
  )
  return rows[0].id
}

// ---------------------------------------------------------------- timer
let onTimerStart: (() => void) | null = null
/** Lets the notification module ask for permission the first time a timer is started (inside the tap). */
export function setTimerStartHook(fn: () => void) { onTimerStart = fn }

export function startTimer(itemId: string) {
  onTimerStart?.()
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

/** Stops the running timer (at `at` when it was pressed earlier, e.g. in the notification). */
export function stopTimer(at?: string) {
  const ts = at ?? now()
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

// ---------------------------------------------------------------- media (offline-capable upload queue)
/**
 * Every picked photo/video becomes an upload job: original + thumbnail are stored in IndexedDB at once
 * and shown from the local copy. Jobs upload one by one whenever we are online (now, on reconnect, on
 * app open, every 30 s), then the media row is saved and the local copy is dropped.
 */
const jobBlobs = new Map<string, UploadJob>() // jobs of this session (also the in-memory fallback)
let processing: Promise<void> | null = null
let uploadTimer: ReturnType<typeof setInterval> | undefined

function localKeys(id: string) { return { object_key: `local:${id}`, thumb_key: `local:${id}:t` } }

function addPending(job: UploadJob, persisted: boolean, status: PendingUpload['status'] = 'waiting', error?: string) {
  const keys = localKeys(job.id)
  const urls: Record<string, string> = { [keys.object_key]: URL.createObjectURL(job.original) }
  if (job.thumb) urls[keys.thumb_key] = URL.createObjectURL(job.thumb)
  jobBlobs.set(job.id, job)
  set((s) => ({
    urls: { ...s.urls, ...urls },
    pending: [...s.pending.filter((x) => x.id !== job.id), {
      id: job.id, itemId: job.itemId, name: job.name, kind: job.kind, created_at: job.created_at,
      width: job.width, height: job.height, persisted, status, progress: 0, error,
    }],
  }))
}
const setPending = (id: string, patch: Partial<PendingUpload>) => set((s) => ({ pending: s.pending.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))

/** Media-like rows for pending uploads (so tiles and covers can show them from the local copy). */
export function pendingAsMedia(p: PendingUpload): Media {
  const keys = localKeys(p.id)
  return {
    id: p.id, item_id: p.itemId, object_key: keys.object_key, thumb_key: jobBlobs.get(p.id)?.thumb ? keys.thumb_key : null, kind: p.kind,
    mime: '', size_bytes: 0, width: p.width, height: p.height, duration_s: null, phase: 'process', created_at: p.created_at,
  }
}

export async function uploadFiles(itemId: string, files: File[]) {
  askPersist()
  const accepted = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
  for (const file of accepted) {
    const prep = await makeUploadParts(file)
    const thumb = prep.parts.find((x) => x.role === 'thumb')
    const job: UploadJob = {
      id: uuid(), uid: get().user?.id ?? '', itemId, name: file.name, mime: file.type || 'application/octet-stream', size: file.size,
      kind: prep.kind, ext: prep.parts[0].ext, thumbType: thumb?.contentType ?? null, thumbExt: thumb?.ext ?? null,
      width: prep.width, height: prep.height, duration: prep.duration, created_at: now(), original: file, thumb: thumb?.blob ?? null,
    }
    // Keep a copy on the device so it survives closing the app; check there is room first.
    const need = file.size + (thumb?.blob.size ?? 0) + 2 * 1048576
    const free = await freeBytes()
    let persisted = false
    if (free === null || free > need) {
      try { await putJob(job); persisted = true } catch (e) { console.warn('could not store upload offline', e) }
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    if (!persisted && offline) {
      addPending(job, false, 'error', t('upload.noSpace', { need: mb(need), free: free === null ? '?' : mb(free) }))
    } else {
      addPending(job, persisted)
      if (!persisted) toast(t('upload.notKept', { name: file.name }), 'info')
    }
  }
  void processUploads()
}

async function uploadOne(id: string) {
  const job = jobBlobs.get(id)
  if (!job) return
  const item = get().data.items.find((i) => i.id === job.itemId)
  if (!item) { await dropJob(id); return } // its item was deleted meanwhile
  setPending(id, { status: 'uploading', progress: 0, error: undefined })
  try {
    if (!job.object_key) {
      const parts: UploadPart[] = [{ role: 'original', blob: job.original, contentType: job.mime, ext: job.ext }]
      if (job.thumb && job.thumbType && job.thumbExt) parts.push({ role: 'thumb', blob: job.thumb, contentType: job.thumbType, ext: job.thumbExt })
      const res = await backend.uploadMedia(job.itemId, parts, (pr) => setPending(id, { progress: pr }))
      job.object_key = res.object_key
      job.thumb_key = res.thumb_key
      await putJob(job).catch(() => {}) // remember the stored keys: a retry then only saves the row
    }
    const row: Media = {
      id: job.id, item_id: job.itemId, object_key: job.object_key, thumb_key: job.thumb_key ?? null, kind: job.kind,
      mime: job.mime, size_bytes: job.size, width: job.width, height: job.height, duration_s: job.duration,
      phase: 'process', created_at: job.created_at, file_name: job.name.slice(0, 255) || null,
    }
    await backend.insert('media', [row])
    // Swap to the stored copy; reuse the local blob URLs so the picture does not flicker.
    const keys = localKeys(id)
    set((s) => ({
      data: { ...s.data, media: [...s.data.media.filter((m) => m.id !== id), row] },
      pending: s.pending.filter((x) => x.id !== id),
      urls: { ...s.urls, [row.object_key]: s.urls[keys.object_key], ...(row.thumb_key && s.urls[keys.thumb_key] ? { [row.thumb_key]: s.urls[keys.thumb_key] } : {}) },
    }))
    lastLocalWrite = Date.now()
    await deleteJob(id)
    jobBlobs.delete(id)
    const it = get().data.items.find((i) => i.id === job.itemId)
    if (it && !it.cover_media_id) void updateItem(job.itemId, { cover_media_id: row.id })
  } catch (e) {
    if (isNetworkError(e)) { setPending(id, { status: 'waiting', progress: 0 }); throw e }
    console.error('upload failed', e)
    if (job.object_key) { // stored but the row was refused (e.g. item gone): remove the files
      await backend.deleteMediaObjects([job.object_key, job.thumb_key].filter(Boolean) as string[]).catch(() => {})
      job.object_key = undefined; job.thumb_key = undefined
      await putJob(job).catch(() => {})
    }
    setPending(id, { status: 'error', error: t('upload.failed') })
  }
}

/** Uploads waiting jobs in order. Stops at the first network failure (tried again later). */
export function processUploads(): Promise<void> {
  if (processing) return processing
  processing = (async () => {
    for (;;) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break
      const next = [...get().pending].sort((a, b) => a.created_at.localeCompare(b.created_at)).find((x) => x.status === 'waiting')
      if (!next || !get().user) break
      try { await uploadOne(next.id) } catch { if (get().health === 'up') set({ health: 'unreachable' }); break }
    }
  })().finally(() => { processing = null })
  if (!uploadTimer) uploadTimer = setInterval(() => { if (get().pending.some((x) => x.status === 'waiting')) void processUploads() }, 30_000)
  return processing
}

/** On app open: bring back jobs saved on this device for the signed-in user. */
export async function restoreUploads() {
  const uid = get().user?.id
  if (!uid) return
  const jobs = await allJobs()
  for (const j of jobs) if (j.uid === uid && !jobBlobs.has(j.id)) addPending(j, true)
  if (jobs.length) void processUploads()
}

async function dropJob(id: string) {
  const keys = localKeys(id)
  const u = get().urls
  for (const k of [keys.object_key, keys.thumb_key]) if (u[k]) URL.revokeObjectURL(u[k])
  jobBlobs.delete(id)
  set((s) => ({ pending: s.pending.filter((x) => x.id !== id) }))
  await deleteJob(id)
}

export function retryUpload(id: string) {
  setPending(id, { status: 'waiting', error: undefined })
  void processUploads()
}
export function dismissUpload(id: string) {
  void dropJob(id)
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
  const need = [...new Set(keys)].filter((k) => k && !k.startsWith('local:') && !have[k] && !inflight.has(k))
  if (!need.length) return
  need.forEach((k) => inflight.add(k))
  try {
    const urls = await backend.mediaUrls(need)
    set((s) => ({ urls: { ...s.urls, ...urls } }))
  } catch { /* shown as placeholders */ } finally {
    need.forEach((k) => inflight.delete(k))
  }
}

// ---------------------------------------------------------------- notes
export function addNote(itemId: string, body = ''): string {
  const ts = now()
  const row: Note = { id: uuid(), item_id: itemId, body, pinned: false, created_at: ts, updated_at: ts }
  void commit((s) => ({ ...s, notes: [...s.notes, row] }), [{ k: 'insert', table: 'notes', rows: [row] }])
  return row.id
}
export function updateNote(id: string, patch: Partial<Note>) {
  const ts = now()
  return commit(
    (s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updated_at: patch.body !== undefined ? ts : n.updated_at } : n)) }),
    [{ k: 'update', table: 'notes', id, patch }],
  )
}
export function deleteNote(id: string) {
  return commit((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }), [{ k: 'remove', table: 'notes', ids: [id] }])
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
/** Is this item itself finished (its own status counts as finished)? */
export function ownFinished(item: Item, statuses: Status[] = get().data.statuses): boolean {
  return !!item.status_id && !!statuses.find((s) => s.id === item.status_id)?.is_finished
}

/** Moves a project to Finished: gives it the first "finished" status (creating "Done" if there is none). Undo-able. */
export async function markFinished(id: string) {
  const d = get().data
  const it = d.items.find((i) => i.id === id)
  if (!it) return
  let fin = [...d.statuses].sort((a, b) => a.sort_order - b.sort_order).find((s) => s.is_finished)
  if (!fin) {
    const row: Status = { id: uuid(), name: t('finished.doneStatus'), color: '#5f9e6e', is_finished: true, sort_order: d.statuses.length ? Math.max(...d.statuses.map((s) => s.sort_order)) + 1 : 0 }
    await commit((s) => ({ ...s, statuses: [...s.statuses, row] }), [{ k: 'insert', table: 'statuses', rows: [row] }])
    fin = row
  }
  if (d.sessions.some((s) => !s.ended_at && (s.item_id === id || descendantIds(d.items, id).has(s.item_id)))) await stopTimer()
  const before = it.status_id
  await updateItem(id, { status_id: fin.id })
  toast(t('finished.moved', { title: it.title }), 'info', { label: t('common.undo'), run: () => void updateItem(id, { status_id: before }) })
}

/** Back to work: the "In progress" status if there is one, else the first status that is not finished. Undo-able. */
export async function reopenItem(id: string) {
  const d = get().data
  const it = d.items.find((i) => i.id === id)
  if (!it) return
  const open = [...d.statuses].sort((a, b) => a.sort_order - b.sort_order).filter((s) => !s.is_finished)
  const to = open.find((s) => /in progress/i.test(s.name)) ?? open[0] ?? null
  const before = it.status_id
  await updateItem(id, { status_id: to?.id ?? null })
  toast(t('finished.reopened', { title: it.title }), 'info', { label: t('common.undo'), run: () => void updateItem(id, { status_id: before }) })
}

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
