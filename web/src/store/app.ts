import { create } from 'zustand'
import { backend } from '../lib/backend'
import type { HealthState } from '../lib/backend/types'
import type {
  AppUser, CostLine, Item, Media, Session, Settings, ShareLink, Snapshot, Status, Template, TemplateNode,
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
}))

const get = useApp.getState
const set = useApp.setState

// ---------------------------------------------------------------- toasts
let toastSeq = 1
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
  const id = toastSeq++
  set((s) => ({ toasts: [...s.toasts, { id, text, tone, action }] }))
  setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 3200)
}
export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}

// ---------------------------------------------------------------- boot / sync
let pending = 0
let lastLocalWrite = 0
let unsubRemote: (() => void) | null = null

export async function boot() {
  backend.onAuthChange((user) => {
    const prev = get().user
    set({ user })
    if (user && (!prev || prev.id !== user.id)) void loadData()
    if (!user) { set({ phase: 'signedOut', data: emptySnap() }); unsubRemote?.(); unsubRemote = null }
  })
  const h = await backend.health()
  set({ health: h })
  if (h !== 'up') {
    // Keep the shell usable; the wake banner takes over.
    const user = await backend.getUser().catch(() => null)
    set({ user, phase: user ? 'loading' : 'signedOut' })
    return
  }
  const user = await backend.getUser()
  set({ user })
  if (!user) { set({ phase: 'signedOut' }); return }
  await loadData()
}

export async function loadData() {
  if (get().phase !== 'ready') set({ phase: 'loading' })
  try {
    const data = await backend.loadAll()
    set({ data, phase: 'ready' })
    if (!unsubRemote) unsubRemote = backend.subscribe(() => scheduleRemoteReload())
  } catch (e) {
    const h = await backend.health()
    set({ health: h })
    if (h === 'up') toast(t('common.error', { error: errMsg(e) }), 'error')
  }
}

function scheduleRemoteReload() {
  // Our own writes echo back through realtime; skip them while writes are in flight.
  const wait = Math.max(0, lastLocalWrite + 1500 - Date.now())
  setTimeout(() => {
    if (pending > 0 || Date.now() - lastLocalWrite < 1500) return scheduleRemoteReload()
    void backend.loadAll().then((data) => set({ data })).catch(() => {})
  }, wait)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && get().phase === 'ready') scheduleRemoteReload()
  })
}

export async function checkHealth() {
  const h = await backend.health()
  set({ health: h })
  return h
}

export async function wakeUp() {
  set({ health: 'waking', wakeError: null })
  try {
    await backend.wake()
  } catch (e) {
    set({ wakeError: errMsg(e) })
  }
  const started = Date.now()
  const poll = async (): Promise<void> => {
    const h = await backend.health()
    if (h === 'up') {
      set({ health: 'up' })
      const user = await backend.getUser()
      set({ user, phase: user ? 'loading' : 'signedOut' })
      if (user) await loadData()
      return
    }
    if (Date.now() - started > 8 * 60_000) { set({ health: 'asleep', wakeError: 'timeout' }); return }
    set({ health: h === 'asleep' ? 'waking' : h })
    await new Promise((r) => setTimeout(r, 5000))
    return poll()
  }
  await poll()
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/** Apply a local change immediately, then persist; on failure reload from the server and toast. */
async function commit(local: (d: Snapshot) => Snapshot, remote: () => Promise<unknown>) {
  set((s) => ({ data: local(s.data) }))
  pending++
  lastLocalWrite = Date.now()
  try {
    await remote()
  } catch (e) {
    toast(t('common.error', { error: errMsg(e) }), 'error')
    try { set({ data: await backend.loadAll() }) } catch { /* ignore */ }
    throw e
  } finally {
    pending--
    lastLocalWrite = Date.now()
  }
}
const quiet = (p: Promise<unknown>) => p.catch(() => {})

// ---------------------------------------------------------------- auth
export const signIn = () => backend.signInWithGoogle()
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

export async function createItem(parentId: string | null, title: string, templateId?: string): Promise<string> {
  const d = get().data
  const tpl = templateId ? d.templates.find((x) => x.id === templateId) : undefined
  const defaultStatus = d.statuses[0]?.id ?? null
  const root = newItem(parentId, title || tpl?.item_title || tpl?.name || t('item.untitled'), nextSort(d.items, parentId), {
    tags: tpl?.tags ?? [], status_id: defaultStatus,
  })
  const rows = [root]
  if (tpl) expandTemplate(tpl.tree, root.id, rows)
  for (const r of rows.slice(1)) r.status_id = defaultStatus
  await commit((s) => ({ ...s, items: [...s.items, ...rows] }), () => backend.insert('items', rows))
  return root.id
}

export async function applyTemplate(itemId: string, templateId: string) {
  const tpl = get().data.templates.find((x) => x.id === templateId)
  if (!tpl) return
  const rows: Item[] = []
  expandTemplate(tpl.tree, itemId, rows)
  const base = nextSort(get().data.items, itemId)
  const defaultStatus = get().data.statuses[0]?.id ?? null
  for (const r of rows) { if (r.parent_id === itemId) r.sort_order += base; r.status_id = defaultStatus }
  await commit((s) => ({ ...s, items: [...s.items, ...rows] }), () => backend.insert('items', rows))
}

export function updateItem(id: string, patch: Partial<Item>) {
  return quiet(commit(
    (s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch, updated_at: now() } : i)) }),
    () => backend.update('items', id, patch),
  ))
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
  await commit(
    (s) => ({
      ...s,
      items: s.items.filter((i) => !ids.has(i.id)),
      sessions: s.sessions.filter((x) => !ids.has(x.item_id)),
      media: s.media.filter((m) => !ids.has(m.item_id)),
      cost_lines: s.cost_lines.filter((c) => !ids.has(c.item_id)),
      share_links: s.share_links.filter((l) => !ids.has(l.item_id)),
    }),
    async () => {
      await backend.remove('items', [id])
      await backend.deleteMediaObjects(media.flatMap((m) => [m.object_key, m.thumb_key].filter(Boolean) as string[])).catch(() => {})
    },
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
  await commit((s) => ({ ...s, items: [...s.items, ...rows] }), () => backend.insert('items', rows))
  return rows[0].id
}

// ---------------------------------------------------------------- timer
export async function startTimer(itemId: string) {
  const sid = uuid()
  const ts = now()
  await quiet(commit(
    (s) => ({
      ...s,
      sessions: [...s.sessions.map((x) => (x.ended_at ? x : { ...x, ended_at: ts })), { id: sid, item_id: itemId, started_at: ts, ended_at: null }],
    }),
    async () => {
      const server = await backend.startTimer(itemId, sid)
      // Adopt the server's clock for the new session and the one it closed.
      set((st) => ({ data: { ...st.data, sessions: st.data.sessions.map((x) => (x.id === sid ? { ...x, ...server } : x)) } }))
    },
  ))
}

export async function stopTimer() {
  const ts = now()
  await quiet(commit(
    (s) => ({ ...s, sessions: s.sessions.map((x) => (x.ended_at ? x : { ...x, ended_at: ts })) }),
    async () => {
      const closed = await backend.stopTimer()
      if (closed) set((st) => ({ data: { ...st.data, sessions: st.data.sessions.map((x) => (x.id === closed.id ? { ...x, ...closed } : x)) } }))
    },
  ))
}

export function addSession(itemId: string, startedAt: string, endedAt: string) {
  const row: Session = { id: uuid(), item_id: itemId, started_at: startedAt, ended_at: endedAt }
  return quiet(commit((s) => ({ ...s, sessions: [...s.sessions, row] }), () => backend.insert('sessions', [row])))
}
export function updateSession(id: string, patch: Partial<Session>) {
  return quiet(commit(
    (s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
    () => backend.update('sessions', id, patch),
  ))
}
export function deleteSession(id: string) {
  return quiet(commit((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id) }), () => backend.remove('sessions', [id])))
}

// ---------------------------------------------------------------- media
export async function uploadFiles(itemId: string, files: File[]) {
  const accepted = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
  await Promise.all(accepted.map(async (file) => {
    const uid = uuid()
    set((s) => ({ uploads: [...s.uploads, { id: uid, itemId, name: file.name, progress: 0 }] }))
    const setProgress = (p: number) => set((s) => ({ uploads: s.uploads.map((u) => (u.id === uid ? { ...u, progress: p } : u)) }))
    try {
      const prep = await makeUploadParts(file)
      const res = await backend.uploadMedia(itemId, prep.parts, setProgress)
      const row: Media = {
        id: uuid(), item_id: itemId, object_key: res.object_key, thumb_key: res.thumb_key, kind: prep.kind,
        mime: file.type, size_bytes: file.size, width: prep.width, height: prep.height, duration_s: prep.duration,
        phase: 'process', created_at: now(),
      }
      await commit((s) => ({ ...s, media: [...s.media, row] }), () => backend.insert('media', [row]))
      // First photo becomes the cover automatically.
      const it = get().data.items.find((i) => i.id === itemId)
      if (it && !it.cover_media_id) void updateItem(itemId, { cover_media_id: row.id })
      set((s) => ({ uploads: s.uploads.filter((u) => u.id !== uid) }))
    } catch (e) {
      set((s) => ({ uploads: s.uploads.map((u) => (u.id === uid ? { ...u, error: errMsg(e) } : u)) }))
      toast(`${file.name}: ${errMsg(e)}`, 'error')
      setTimeout(() => set((s) => ({ uploads: s.uploads.filter((u) => u.id !== uid) })), 6000)
    }
  }))
}

export function updateMedia(id: string, patch: Partial<Media>) {
  return quiet(commit(
    (s) => ({ ...s, media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
    () => backend.update('media', id, patch),
  ))
}

export async function deleteMedia(id: string) {
  const m = get().data.media.find((x) => x.id === id)
  if (!m) return
  await quiet(commit(
    (s) => ({
      ...s,
      media: s.media.filter((x) => x.id !== id),
      items: s.items.map((i) => (i.cover_media_id === id ? { ...i, cover_media_id: null } : i)),
    }),
    async () => {
      await backend.remove('media', [id])
      await backend.deleteMediaObjects([m.object_key, m.thumb_key].filter(Boolean) as string[]).catch(() => {})
    },
  ))
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
  void quiet(commit((s) => ({ ...s, cost_lines: [...s.cost_lines, row] }), () => backend.insert('cost_lines', [row])))
  return row.id
}
export function updateCost(id: string, patch: Partial<CostLine>) {
  return quiet(commit(
    (s) => ({ ...s, cost_lines: s.cost_lines.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
    () => backend.update('cost_lines', id, patch),
  ))
}
export function deleteCost(id: string) {
  return quiet(commit((s) => ({ ...s, cost_lines: s.cost_lines.filter((c) => c.id !== id) }), () => backend.remove('cost_lines', [id])))
}

// ---------------------------------------------------------------- statuses
export function addStatus(name: string, color: string) {
  const d = get().data
  const row: Status = { id: uuid(), name, color, sort_order: d.statuses.length ? Math.max(...d.statuses.map((s) => s.sort_order)) + 1 : 0 }
  return quiet(commit((s) => ({ ...s, statuses: [...s.statuses, row] }), () => backend.insert('statuses', [row])))
}
export function updateStatus(id: string, patch: Partial<Status>) {
  return quiet(commit(
    (s) => ({ ...s, statuses: s.statuses.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
    () => backend.update('statuses', id, patch),
  ))
}
export function deleteStatus(id: string) {
  return quiet(commit(
    (s) => ({ ...s, statuses: s.statuses.filter((x) => x.id !== id), items: s.items.map((i) => (i.status_id === id ? { ...i, status_id: null } : i)) }),
    () => backend.remove('statuses', [id]),
  ))
}
export async function moveStatus(id: string, dir: -1 | 1) {
  const list = [...get().data.statuses].sort((a, b) => a.sort_order - b.sort_order)
  const i = list.findIndex((s) => s.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  const renum = list.map((s, k) => ({ ...s, sort_order: k }))
  const changed = renum.filter((s) => get().data.statuses.find((o) => o.id === s.id)?.sort_order !== s.sort_order)
  await quiet(commit(
    (s) => ({ ...s, statuses: renum }),
    () => Promise.all(changed.map((c) => backend.update('statuses', c.id, { sort_order: c.sort_order }))),
  ))
}

// ---------------------------------------------------------------- templates
function toTree(items: Item[], parentId: string): TemplateNode[] {
  return childrenOf(items, parentId).map((c) => {
    const kids = toTree(items, c.id)
    return { title: c.title, ...(c.tags.length ? { tags: c.tags } : {}), ...(kids.length ? { children: kids } : {}) }
  })
}
export async function saveAsTemplate(itemId: string) {
  const d = get().data
  const it = d.items.find((i) => i.id === itemId)
  if (!it) return
  const row: Template = { id: uuid(), name: it.title, item_title: it.title, tags: it.tags, tree: toTree(d.items, itemId), created_at: now() }
  await quiet(commit((s) => ({ ...s, templates: [...s.templates, row] }), () => backend.insert('templates', [row])))
  toast(t('item.templateSaved', { name: row.name }))
}
export function addTemplate(tpl: Omit<Template, 'id' | 'created_at'>) {
  const row: Template = { ...tpl, id: uuid(), created_at: now() }
  return quiet(commit((s) => ({ ...s, templates: [...s.templates, row] }), () => backend.insert('templates', [row])))
}
export function updateTemplate(id: string, patch: Partial<Template>) {
  return quiet(commit(
    (s) => ({ ...s, templates: s.templates.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
    () => backend.update('templates', id, patch),
  ))
}
export function deleteTemplate(id: string) {
  return quiet(commit((s) => ({ ...s, templates: s.templates.filter((x) => x.id !== id) }), () => backend.remove('templates', [id])))
}

// ---------------------------------------------------------------- share links
function token(): string {
  const b = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export async function createShare(itemId: string): Promise<ShareLink> {
  const row: ShareLink = { id: uuid(), item_id: itemId, token: token(), created_at: now(), revoked_at: null }
  await commit((s) => ({ ...s, share_links: [...s.share_links, row] }), () => backend.insert('share_links', [row]))
  return row
}
export function revokeShare(id: string) {
  const ts = now()
  return quiet(commit(
    (s) => ({ ...s, share_links: s.share_links.map((l) => (l.id === id ? { ...l, revoked_at: ts } : l)) }),
    () => backend.update('share_links', id, { revoked_at: ts }),
  ))
}
export const shareUrl = (l: ShareLink) => `${window.location.origin}/s/${l.token}`

// ---------------------------------------------------------------- settings
export function saveSettings(patch: Partial<Settings>) {
  const next = { ...get().data.settings, ...patch }
  return quiet(commit((s) => ({ ...s, settings: next }), () => backend.saveSettings(next)))
}

export { backend }
