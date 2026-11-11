import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { Access, AllowedEmail, Backend, HealthState, MultipartState, UploadPart, UploadResult, UploadResume } from './types'
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
    const [items, notes, day_notes, statuses, sessions, media, cost_lines, templates, share_links, settingsRows] = await Promise.all([
      this.all<Snapshot['items'][number]>('items'),
      this.all<Snapshot['notes'][number]>('notes'),
      this.all<Snapshot['day_notes'][number]>('day_notes', 'day'),
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
    return { items, notes, day_notes, statuses, sessions, media, cost_lines, templates, share_links, settings }
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
    for (const table of ['items', 'notes', 'day_notes', 'sessions', 'media', 'statuses', 'cost_lines', 'templates', 'share_links', 'settings'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire)
    ch.subscribe()
    return () => { clearTimeout(t); void this.sb.removeChannel(ch) }
  }

  // ---------- allow-list ----------
  async access(): Promise<Access> {
    const { data, error } = await this.sb.rpc('access_check')
    if (error) throw error
    const d = (data ?? {}) as Partial<Access>
    return { allowed: d.allowed === true, admin: d.admin === true, email: d.email ?? null }
  }
  async listAllowed(): Promise<AllowedEmail[]> {
    const { data, error } = await this.sb.from('allowed_emails').select('email, is_admin, added_at').order('is_admin', { ascending: false }).order('email')
    if (error) throw error
    return (data ?? []) as AllowedEmail[]
  }
  async addAllowed(email: string) {
    const { error } = await this.sb.from('allowed_emails').insert({ email: email.trim().toLowerCase() })
    if (error && error.code !== '23505') throw error // already on the list: fine
  }
  async removeAllowed(email: string) {
    const { error } = await this.sb.from('allowed_emails').delete().eq('email', email.trim().toLowerCase())
    if (error) throw error
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

  async uploadMedia(itemId: string, parts: UploadPart[], onProgress?: (f: number) => void, resume?: UploadResume): Promise<UploadResult> {
    const original = parts.find((p) => p.role === 'original')
    if (original && (resume?.state || original.blob.size > MULTIPART_MIN)) {
      return this.uploadMultipart(itemId, original, parts.find((p) => p.role === 'thumb'), onProgress, resume)
    }
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

  /**
   * Big files (long videos): a B2 multipart upload. The Worker starts and finishes it; the parts (8 MB) go straight
   * to B2, three at a time, each retried on its own. Every finished part is reported through `resume.save`, so a
   * cut connection or a closed app carries on from there.
   */
  private async uploadMultipart(itemId: string, original: UploadPart, thumb: UploadPart | undefined, onProgress?: (f: number) => void, resume?: UploadResume): Promise<UploadResult> {
    const size = original.blob.size
    let st = resume?.state
    if (!st) {
      const { parts: started } = await this.api<{ parts: { role: string; key: string; url?: string; uploadId?: string }[] }>('/api/media/upload', {
        method: 'POST',
        body: JSON.stringify({
          itemId,
          parts: [
            { role: 'original', contentType: original.contentType, ext: original.ext, multipart: true },
            ...(thumb ? [{ role: 'thumb', contentType: thumb.contentType, ext: thumb.ext }] : []),
          ],
        }),
      })
      const o = started.find((x) => x.role === 'original')
      if (!o?.uploadId) throw new Error('Upload failed: could not start')
      st = { key: o.key, uploadId: o.uploadId, thumbKey: started.find((x) => x.role === 'thumb')?.key ?? null, partSize: partSizeFor(size), done: {} }
      resume?.save(st)
    }
    const state = st
    const count = Math.max(1, Math.ceil(size / state.partSize))
    const partLen = (n: number) => Math.min(size, n * state.partSize) - (n - 1) * state.partSize
    const total = size + (thumb?.blob.size ?? 0) || 1
    const inflight = new Map<number, number>()
    const report = () => {
      let b = 0
      for (const k of Object.keys(state.done)) b += partLen(Number(k))
      for (const v of inflight.values()) b += v
      onProgress?.(Math.min(0.99, b / total))
    }
    report()
    const todo: number[] = []
    for (let n = 1; n <= count; n++) if (!state.done[n]) todo.push(n)
    const urls = new Map<number, string>()
    let signing: Promise<void> | null = null
    const urlFor = async (n: number) => {
      while (!urls.has(n)) {
        if (!signing) {
          const batch = todo.filter((x) => x >= n && !urls.has(x)).slice(0, 100)
          signing = this.api<{ urls: Record<string, string> }>('/api/media/sign', { method: 'POST', body: JSON.stringify({ key: state.key, uploadId: state.uploadId, partNumbers: batch }) })
            .then(({ urls: u }) => { for (const [k, v] of Object.entries(u)) urls.set(Number(k), v) })
            .finally(() => { signing = null })
        }
        await signing
      }
      return urls.get(n)!
    }
    let next = 0
    const lane = async () => {
      while (next < todo.length) {
        const n = todo[next++]
        const from = (n - 1) * state.partSize
        const blob = original.blob.slice(from, from + partLen(n))
        const etag = await withRetry(async () => {
          inflight.set(n, 0)
          return putWithProgress(await urlFor(n), blob, null, (loaded) => { inflight.set(n, loaded); report() })
        }, 5)
        inflight.delete(n)
        if (!etag) throw new Error('Upload failed: no ETag from storage')
        state.done[n] = etag
        resume?.save(state)
        report()
      }
    }
    await Promise.all([lane(), lane(), lane()])
    await this.api('/api/media/multipart/complete', {
      method: 'POST',
      body: JSON.stringify({ key: state.key, uploadId: state.uploadId, parts: Object.entries(state.done).map(([n, etag]) => ({ partNumber: Number(n), etag })) }),
    })
    const result: UploadResult = { object_key: state.key, thumb_key: null }
    if (thumb && state.thumbKey) {
      try {
        const { url } = await this.api<{ url: string }>('/api/media/sign', { method: 'POST', body: JSON.stringify({ key: state.thumbKey }) })
        await withRetry(() => putWithProgress(url, thumb.blob, thumb.contentType, () => {}))
        result.thumb_key = state.thumbKey
      } catch (e) {
        console.warn('thumbnail upload failed, continuing without it', e)
        await this.deleteMediaObjects([state.thumbKey]).catch(() => {})
      }
    }
    onProgress?.(1)
    return result
  }

  async abortUpload(state: MultipartState) {
    await this.api('/api/media/multipart/abort', { method: 'POST', body: JSON.stringify({ key: state.key, uploadId: state.uploadId }) }).catch(() => {})
    if (state.thumbKey) await this.deleteMediaObjects([state.thumbKey]).catch(() => {})
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

/** Files above this go up as a multipart upload (B2 parts: 5 MB minimum, 10,000 at most). */
export const MULTIPART_MIN = 32 * 1048576
function partSizeFor(size: number): number {
  const MB = 1048576
  return Math.max(8 * MB, Math.ceil(size / 9000 / MB) * MB)
}

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

/** PUT with upload progress; resolves with the ETag B2 returns (needed for multipart parts). */
function putWithProgress(url: string, blob: Blob, contentType: string | null, onLoaded: (n: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    if (contentType) xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => onLoaded(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader('ETag') ?? '') : reject(new Error(`Upload failed: ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Upload failed (network)'))
    xhr.send(blob)
  })
}
