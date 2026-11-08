import type { Backend, HealthState, UploadPart, UploadResult } from './types'
import type { AppUser, Session, Settings, SharedGallery, Snapshot, TableName, TableRow } from '../types'
import { DEFAULT_SETTINGS, DEFAULT_STATUSES } from '../types'

/**
 * Local development backend: data in localStorage, media blobs in IndexedDB.
 * Behaves like the cloud backend (single running timer, share links, wake-up flow) so the UI
 * can be built and tested without any cloud account.
 */
const KEY = 'sg.local.db.v1'
const USER_KEY = 'sg.local.user'
const LOCAL_USER: AppUser = { id: '00000000-0000-4000-8000-000000000001', email: 'local@sand.gallery', name: 'Local Maker', avatar_url: null }

type DB = Omit<Snapshot, 'settings'> & { settings: Settings }

function emptyDB(): DB {
  const now = new Date().toISOString()
  return {
    items: [],
    statuses: DEFAULT_STATUSES.map((s, i) => ({ id: crypto.randomUUID(), name: s.name, color: s.color, is_finished: s.is_finished, sort_order: i, created_at: now })),
    sessions: [],
    media: [],
    cost_lines: [],
    templates: [],
    share_links: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

function read(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DB
  } catch { /* ignore */ }
  const db = emptyDB()
  write(db)
  return db
}
function write(db: DB) {
  localStorage.setItem(KEY, JSON.stringify(db))
  channel?.postMessage('changed')
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sg-local') : null

// ---------- IndexedDB blob store ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sg-local-media', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('blobs')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function putBlob(key: string, blob: Blob) {
  const db = await idb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite')
    tx.objectStore('blobs').put(blob, key)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}
async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await idb()
  return new Promise((res, rej) => {
    const req = db.transaction('blobs').objectStore('blobs').get(key)
    req.onsuccess = () => res(req.result as Blob | undefined)
    req.onerror = () => rej(req.error)
  })
}
async function delBlob(key: string) {
  const db = await idb()
  await new Promise<void>((res) => {
    const tx = db.transaction('blobs', 'readwrite')
    tx.objectStore('blobs').delete(key)
    tx.oncomplete = () => res()
    tx.onerror = () => res()
  })
}

const urlCache = new Map<string, string>()
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class LocalBackend implements Backend {
  readonly mode = 'local' as const
  private listeners = new Set<(u: AppUser | null) => void>()

  async getUser() {
    return localStorage.getItem(USER_KEY) ? LOCAL_USER : null
  }
  onAuthChange(cb: (u: AppUser | null) => void) {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  async signInWithGoogle() {
    localStorage.setItem(USER_KEY, '1')
    this.listeners.forEach((l) => l(LOCAL_USER))
  }
  async signOut() {
    localStorage.removeItem(USER_KEY)
    this.listeners.forEach((l) => l(null))
  }

  async loadAll(): Promise<Snapshot> {
    await delay(60)
    return structuredClone(read())
  }

  async insert<T extends TableName>(table: T, rows: TableRow[T][]) {
    const db = read()
    const list = db[table] as unknown as TableRow[T][]
    for (const r of rows) list.push({ ...r, owner_id: LOCAL_USER.id })
    if (table === 'sessions') this.assertSingleRunning(db)
    write(db)
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<TableRow[T]>) {
    const db = read()
    const list = db[table] as unknown as (TableRow[T] & { id: string })[]
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) throw new Error(`Not found: ${table}/${id}`)
    list[i] = { ...list[i], ...patch }
    if (table === 'items') (list[i] as unknown as { updated_at: string }).updated_at = new Date().toISOString()
    write(db)
  }
  async remove(table: TableName, ids: string[]) {
    const db = read()
    const set = new Set(ids)
    if (table === 'items') {
      // emulate ON DELETE CASCADE
      let grew = true
      while (grew) {
        grew = false
        for (const it of db.items) if (it.parent_id && set.has(it.parent_id) && !set.has(it.id)) { set.add(it.id); grew = true }
      }
      db.sessions = db.sessions.filter((s) => !set.has(s.item_id))
      db.media = db.media.filter((m) => !set.has(m.item_id))
      db.cost_lines = db.cost_lines.filter((c) => !set.has(c.item_id))
      db.share_links = db.share_links.filter((l) => !set.has(l.item_id))
    }
    if (table === 'media') for (const it of db.items) if (it.cover_media_id && set.has(it.cover_media_id)) it.cover_media_id = null
    if (table === 'statuses') for (const it of db.items) if (it.status_id && set.has(it.status_id)) it.status_id = null
    ;(db as unknown as Record<string, { id: string }[]>)[table] = (db[table] as { id: string }[]).filter((r) => !set.has(r.id))
    write(db)
  }
  async saveSettings(s: Settings) {
    const db = read()
    db.settings = { ...s }
    write(db)
  }

  async startTimer(itemId: string, sessionId: string, at?: string | null): Promise<Session> {
    const db = read()
    const existing = db.sessions.find((s) => s.id === sessionId)
    if (existing) return existing
    const now = at && at < new Date().toISOString() ? at : new Date().toISOString()
    for (const s of db.sessions) if (!s.ended_at) s.ended_at = now
    const s: Session = { id: sessionId, item_id: itemId, started_at: now, ended_at: null, owner_id: LOCAL_USER.id }
    db.sessions.push(s)
    write(db)
    return s
  }
  async stopTimer(at?: string | null): Promise<Session | null> {
    const db = read()
    const open = db.sessions.find((s) => !s.ended_at)
    if (!open) return null
    const now = new Date().toISOString()
    const when = at && at < now ? at : now
    open.ended_at = when > open.started_at ? when : open.started_at
    write(db)
    return open
  }
  private assertSingleRunning(db: DB) {
    if (db.sessions.filter((s) => !s.ended_at).length > 1) throw new Error('Only one timer can run at a time')
  }

  subscribe(onRemoteChange: () => void) {
    if (!channel) return () => {}
    const h = () => onRemoteChange()
    // BroadcastChannel does not deliver to the sender, so this only fires for other tabs.
    channel.addEventListener('message', h)
    return () => channel.removeEventListener('message', h)
  }

  async uploadMedia(itemId: string, parts: UploadPart[], onProgress?: (f: number) => void): Promise<UploadResult> {
    const id = crypto.randomUUID()
    let object_key = ''
    let thumb_key: string | null = null
    for (const p of parts) {
      const key = p.role === 'thumb' ? `sand-gallery/thumbs/${LOCAL_USER.id}/${itemId}/${id}.${p.ext}` : `sand-gallery/media/${LOCAL_USER.id}/${itemId}/${id}.${p.ext}`
      await putBlob(key, p.blob)
      if (p.role === 'thumb') thumb_key = key
      else object_key = key
    }
    for (let f = 0.2; f <= 1; f += 0.2) { onProgress?.(f); await delay(40) }
    return { object_key, thumb_key }
  }
  async mediaUrls(keys: string[]) {
    const out: Record<string, string> = {}
    for (const k of keys) {
      let u = urlCache.get(k)
      if (!u) {
        const b = await getBlob(k)
        if (!b) continue
        u = URL.createObjectURL(b)
        urlCache.set(k, u)
      }
      out[k] = u
    }
    return out
  }
  async deleteMediaObjects(keys: string[]) {
    for (const k of keys) await delBlob(k)
  }

  async fetchShared(token: string): Promise<SharedGallery | null> {
    const db = read()
    const link = db.share_links.find((l) => l.token === token && !l.revoked_at)
    if (!link) return null
    const ids = new Set([link.item_id])
    let grew = true
    while (grew) {
      grew = false
      for (const it of db.items) if (it.parent_id && ids.has(it.parent_id) && !ids.has(it.id)) { ids.add(it.id); grew = true }
    }
    const media = db.media.filter((m) => ids.has(m.item_id))
    const urls = await this.mediaUrls(media.flatMap((m) => [m.object_key, m.thumb_key].filter(Boolean) as string[]))
    return {
      root_id: link.item_id,
      items: db.items.filter((i) => ids.has(i.id)).map(({ id, parent_id, title, status_id, cover_media_id, sort_order }) => ({ id, parent_id, title, status_id, cover_media_id, sort_order })),
      statuses: db.statuses.map(({ id, name, color }) => ({ id, name, color })),
      media: media.map((m) => ({ id: m.id, item_id: m.item_id, kind: m.kind, width: m.width, height: m.height, phase: m.phase, created_at: m.created_at, note: m.note ?? null, url: urls[m.object_key], thumb_url: m.thumb_key ? urls[m.thumb_key] : null })),
    }
  }

  async backupNow() {
    return { ok: true, key: '(local mode: data lives in this browser)' }
  }

  private wakeAt = 0
  async health(): Promise<HealthState> {
    if (localStorage.getItem('sg.local.asleep') !== '1') return 'up'
    if (this.wakeAt && Date.now() > this.wakeAt) {
      localStorage.removeItem('sg.local.asleep')
      this.wakeAt = 0
      return 'up'
    }
    return this.wakeAt ? 'waking' : 'asleep'
  }
  async wake() {
    this.wakeAt = Date.now() + 6000
  }
  isNetworkError() {
    return false
  }
}
