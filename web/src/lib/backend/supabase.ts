import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { Backend, HealthState, UploadPart, UploadResult } from './types'
import type { AppUser, Session, Settings, SharedGallery, Snapshot, TableName, TableRow } from '../types'
import { DEFAULT_SETTINGS } from '../types'

export interface CloudConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  workerUrl: string
}

function toAppUser(u: User | null | undefined): AppUser | null {
  if (!u) return null
  const m = (u.user_metadata ?? {}) as Record<string, string | undefined>
  return { id: u.id, email: u.email ?? null, name: m.full_name ?? m.name ?? null, avatar_url: m.avatar_url ?? m.picture ?? null }
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

/** Cloud backend: Supabase for data + auth, the Cloudflare Worker for B2 media, share pages and wake-up. */
export class SupabaseBackend implements Backend {
  readonly mode = 'cloud' as const
  readonly sb: SupabaseClient
  private urlCache = new Map<string, { url: string; exp: number }>()

  constructor(private cfg: CloudConfig) {
    this.sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  }

  // ---------- auth ----------
  async getUser() {
    const { data } = await this.sb.auth.getSession()
    return toAppUser(data.session?.user)
  }
  onAuthChange(cb: (u: AppUser | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, session) => cb(toAppUser(session?.user)))
    return () => data.subscription.unsubscribe()
  }
  async signInWithGoogle() {
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: 'select_account' } },
    })
    if (error) throw error
  }
  async signOut() {
    await this.sb.auth.signOut()
  }
  private async token(): Promise<string> {
    const { data } = await this.sb.auth.getSession()
    const t = data.session?.access_token
    if (!t) throw new Error('Not signed in')
    return t
  }

  // ---------- data ----------
  private async all<T>(table: string, order = 'created_at'): Promise<T[]> {
    const out: T[] = []
    const page = 1000
    for (let from = 0; ; from += page) {
      const { data, error } = await this.sb.from(table).select('*').order(order).order('id').range(from, from + page - 1)
      if (error) throw error
      out.push(...(data as T[]))
      if (!data || data.length < page) break
    }
    return out
  }

  async loadAll(): Promise<Snapshot> {
    await this.sb.rpc('ensure_defaults')
    const [items, statuses, sessions, media, cost_lines, templates, share_links, settingsRows] = await Promise.all([
      this.all<Snapshot['items'][number]>('items'),
      this.all<Snapshot['statuses'][number]>('statuses', 'sort_order'),
      this.all<Snapshot['sessions'][number]>('sessions', 'started_at'),
      this.all<Snapshot['media'][number]>('media'),
      this.all<Snapshot['cost_lines'][number]>('cost_lines'),
      this.all<Snapshot['templates'][number]>('templates'),
      this.all<Snapshot['share_links'][number]>('share_links'),
      this.sb.from('settings').select('*').limit(1),
    ])
    const settings = { ...DEFAULT_SETTINGS, ...((settingsRows.data?.[0] as Settings | undefined) ?? {}) }
    for (const n of ['hourly_rate', 'markup_pct'] as const) settings[n] = Number(settings[n])
    for (const c of cost_lines) { c.qty = Number(c.qty); c.unit_cost = Number(c.unit_cost) }
    return { items, statuses, sessions, media, cost_lines, templates, share_links, settings }
  }

  async insert<T extends TableName>(table: T, rows: TableRow[T][]) {
    const { error } = await this.sb.from(table).insert(rows.map((r) => strip(r)))
    // 23505 = duplicate key: a retried insert that already succeeded (inserts are one atomic statement)
    if (error && error.code !== '23505') throw error
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<TableRow[T]>) {
    const { error } = await this.sb.from(table).update(strip(patch) as never).eq('id', id)
    if (error) throw error
  }
  async remove(table: TableName, ids: string[]) {
    if (!ids.length) return
    const { error } = await this.sb.from(table).delete().in('id', ids)
    if (error) throw error
  }
  async saveSettings(s: Settings) {
    const { owner_id: _o, updated_at: _u, ...rest } = s
    const { error } = await this.sb.from('settings').upsert(rest)
    if (error) throw error
  }

  async startTimer(itemId: string, sessionId: string, at?: string | null): Promise<Session> {
    const { data, error } = await this.sb.rpc('start_timer', { p_item: itemId, p_session: sessionId, p_at: at ?? null })
    if (error) throw error
    return data as Session
  }
  async stopTimer(at?: string | null): Promise<Session | null> {
    const { data, error } = await this.sb.rpc('stop_timer', { p_at: at ?? null })
    if (error) throw error
    return (data as Session | null) ?? null
  }

  subscribe(onRemoteChange: () => void) {
    let t: ReturnType<typeof setTimeout> | undefined
    const fire = () => { clearTimeout(t); t = setTimeout(onRemoteChange, 600) }
    const ch = this.sb.channel('sg-changes')
    for (const table of ['items', 'sessions', 'media', 'statuses', 'cost_lines', 'templates', 'share_links', 'settings'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire)
    ch.subscribe()
    return () => { clearTimeout(t); void this.sb.removeChannel(ch) }
  }

  // ---------- worker calls ----------
  /** Worker call with retries on network errors and 5xx (exponential backoff). */
  private async api<T>(path: string, init: RequestInit = {}, auth = true, attempts = 3): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        const headers = new Headers(init.headers)
        if (auth) headers.set('Authorization', `Bearer ${await this.token()}`)
        if (init.body) headers.set('Content-Type', 'application/json')
        const res = await fetch(this.cfg.workerUrl.replace(/\/$/, '') + path, { ...init, headers })
        if (res.status >= 500 && i < attempts - 1) throw new RetryableError(`${path}: ${res.status}`)
        if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text().catch(() => '')}`)
        return (await res.json()) as T
      } catch (e) {
        const retry = e instanceof RetryableError || isNetworkError(e)
        if (!retry || i >= attempts - 1) throw e
        await sleep(700 * 2 ** i)
      }
    }
  }

  async uploadMedia(itemId: string, parts: UploadPart[], onProgress?: (f: number) => void): Promise<UploadResult> {
    const { parts: signed } = await this.api<{ parts: { role: string; key: string; url: string }[] }>('/api/media/upload', {
      method: 'POST',
      body: JSON.stringify({ itemId, parts: parts.map((p) => ({ role: p.role, contentType: p.contentType, ext: p.ext })) }),
    })
    const total = parts.reduce((n, p) => n + p.blob.size, 0) || 1
    let done = 0
    const result: UploadResult = { object_key: '', thumb_key: null }
    // original first: it is the part that matters
    const order = parts.map((p, i) => ({ p, s: signed[i] })).sort((a, b) => (a.p.role === 'original' ? -1 : 0) - (b.p.role === 'original' ? -1 : 0))
    for (const { p, s } of order) {
      try {
        await withRetry(() => putWithProgress(s.url, p.blob, p.contentType, (loaded) => onProgress?.((done + loaded) / total)))
      } catch (e) {
        if (p.role === 'thumb') {
          // A missing thumbnail is not worth losing the photo: the original is shown instead.
          console.warn('thumbnail upload failed, continuing without it', e)
          await this.deleteMediaObjects([s.key]).catch(() => {})
          continue
        }
        // Original failed: remove anything already stored so nothing is orphaned.
        await this.deleteMediaObjects(signed.map((x) => x.key)).catch(() => {})
        throw e
      }
      done += p.blob.size
      if (p.role === 'thumb') result.thumb_key = s.key
      else result.object_key = s.key
    }
    onProgress?.(1)
    return result
  }

  async mediaUrls(keys: string[]) {
    const now = Date.now()
    const out: Record<string, string> = {}
    const missing: string[] = []
    for (const k of keys) {
      const c = this.urlCache.get(k)
      if (c && c.exp > now) out[k] = c.url
      else missing.push(k)
    }
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200)
      const { urls } = await this.api<{ urls: Record<string, string> }>('/api/media/urls', { method: 'POST', body: JSON.stringify({ keys: chunk }) })
      for (const [k, u] of Object.entries(urls)) {
        this.urlCache.set(k, { url: u, exp: now + 6 * 3600_000 })
        out[k] = u
      }
    }
    return out
  }
  async deleteMediaObjects(keys: string[]) {
    if (!keys.length) return
    await this.api('/api/media/delete', { method: 'POST', body: JSON.stringify({ keys }) })
  }

  async fetchShared(token: string): Promise<SharedGallery | null> {
    const res = await fetch(`${this.cfg.workerUrl.replace(/\/$/, '')}/api/share/${encodeURIComponent(token)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`share: ${res.status}`)
    return (await res.json()) as SharedGallery
  }

  async pushSubscribe(sub: PushSubscriptionJSON, deviceKey: string) {
    return this.api<{ deviceId: string; deviceSecret: string }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ ...sub, userAgent: navigator.userAgent, deviceKey }) })
  }
  async pushUnsubscribe(endpoint: string) {
    await this.api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) })
  }
  async pushTest() {
    const r = await this.api<{ sent: number }>('/api/push/test', { method: 'POST' }, true, 1)
    return r.sent
  }

  async backupNow() {
    return this.api<{ ok: boolean; key?: string; counts?: Record<string, number>; reason?: string }>('/api/backup', { method: 'POST' })
  }

  // ---------- wake-up ----------
  async health(): Promise<HealthState> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'unreachable'
    try {
      // rpc/ping touches the database and is allowed for anon (no 401 on the login page)
      const res = await withTimeout(fetch(`${this.cfg.supabaseUrl}/rest/v1/rpc/ping`, {
        method: 'POST',
        headers: { apikey: this.cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: '{}',
      }), 4000)
      if (res.status < 500) return 'up'
    } catch { /* fall through to the worker */ }
    try {
      const res = await withTimeout(fetch(`${this.cfg.workerUrl.replace(/\/$/, '')}/api/health`), 8000)
      const { state } = (await res.json()) as { state: HealthState }
      return state
    } catch {
      return 'unreachable'
    }
  }
  async wake() {
    // The auth server sleeps with the DB, so send the stored token as-is (the Worker accepts a recently
    // expired one: it only proves this browser belongs to a real user of the gallery).
    const headers: Record<string, string> = {}
    const tok = storedAccessToken(this.cfg.supabaseUrl)
    if (tok) headers.Authorization = `Bearer ${tok}`
    const res = await fetch(`${this.cfg.workerUrl.replace(/\/$/, '')}/api/wake`, { method: 'POST', headers })
    if (res.status === 429) throw new Error('please wait a minute and try again')
    if (!res.ok) throw new Error(`wake: ${res.status}`)
  }
}

class RetryableError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** True for 'could not reach the server' errors (offline, DNS, CORS-less network failure). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = String((e as { message?: unknown })?.message ?? e)
  return /Failed to fetch|NetworkError|(^|[^p])Load failed|(network)|timeout/i.test(m)
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= attempts - 1) throw e
      await sleep(800 * 2 ** i)
    }
  }
}

function storedAccessToken(supabaseUrl: string): string | null {
  try {
    const ref = new URL(supabaseUrl).hostname.split('.')[0]
    const raw = localStorage.getItem(`sb-${ref}-auth-token`)
    return raw ? (JSON.parse(raw) as { access_token?: string }).access_token ?? null : null
  } catch { return null }
}

function strip<T extends object>(row: T): T {
  const copy = { ...row } as Record<string, unknown>
  delete copy.owner_id
  return copy as T
}

function putWithProgress(url: string, blob: Blob, contentType: string, onLoaded: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => onLoaded(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Upload failed (network)'))
    xhr.send(blob)
  })
}
