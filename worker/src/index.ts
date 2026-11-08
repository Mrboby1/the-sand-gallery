/**
 * The Sand Gallery API Worker.
 *
 *  POST /api/media/upload   presigned PUT URLs for a new photo/video (+ thumbnail)   [auth]
 *  POST /api/media/urls     presigned GET URLs for the caller's own keys              [auth]
 *  POST /api/media/delete   deletes the caller's own objects                          [auth]
 *  GET  /api/share/:token   public read-only gallery for a share link (presigned media)
 *  GET  /api/health         { state: 'up' | 'asleep' | 'waking' | 'unreachable' }
 *  POST /api/wake           restores a paused Supabase project (Management API)
 *  cron (daily)             keep-alive + JSON backup of all tables to B2
 *
 * Backblaze is a SHARED account: every key this Worker signs or writes starts with `sand-gallery/`.
 */
import { AwsClient } from 'aws4fetch'

export interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_REF: string
  SUPABASE_SERVICE_ROLE_KEY: string // secret
  SUPABASE_ACCESS_TOKEN: string // secret (Management API)
  B2_ENDPOINT: string // e.g. s3.eu-central-003.backblazeb2.com
  B2_REGION: string // e.g. eu-central-003
  B2_BUCKET: string
  B2_KEY_ID: string
  B2_APPLICATION_KEY: string // secret
  ALLOWED_ORIGINS: string // comma separated; "*.x.pages.dev" wildcards allowed
}

export const PREFIX = 'sand-gallery/'
const TABLES = ['statuses', 'items', 'sessions', 'media', 'cost_lines', 'templates', 'share_links', 'settings']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ------------------------------------------------------------------ helpers
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function originAllowed(env: Env, origin: string | null): boolean {
  if (!origin) return false
  return env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).some((rule) => {
    if (rule === origin) return true
    if (rule.includes('*')) {
      const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') + '$', 'i')
      return re.test(origin)
    }
    return false
  })
}

function cors(env: Env, req: Request, publicRoute = false): Record<string, string> {
  const origin = req.headers.get('Origin')
  const allow = publicRoute ? '*' : originAllowed(env, origin) ? origin! : ''
  return {
    ...(allow ? { 'Access-Control-Allow-Origin': allow } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })
}

/** Our keys only: inside the prefix, no path tricks. */
export function safeKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(PREFIX) && key.length < 512 && !key.includes('..') && !key.includes('//') && !/[\u0000-\u001f\\]/.test(key)
}

/** Keys a given user may read/delete: their own media and thumbnails. */
export function ownsKey(userId: string, key: string): boolean {
  return safeKey(key) && (key.startsWith(`${PREFIX}media/${userId}/`) || key.startsWith(`${PREFIX}thumbs/${userId}/`))
}

function b2(env: Env) {
  return new AwsClient({ accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY, service: 's3', region: env.B2_REGION })
}

function objectUrl(env: Env, key: string): URL {
  const path = key.split('/').map(encodeURIComponent).join('/')
  return new URL(`https://${env.B2_ENDPOINT}/${env.B2_BUCKET}/${path}`)
}

function amzDate(d: Date) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/**
 * Presigns a URL. GETs are signed with a date fixed to the start of the UTC day (valid 2 days), so the
 * same object gets the same URL all day long and the browser/service-worker cache can hit.
 */
export async function presign(env: Env, method: 'GET' | 'PUT', key: string, expiresSec?: number): Promise<string> {
  if (!safeKey(key)) throw new HttpError(400, 'bad key')
  const url = objectUrl(env, key)
  let datetime: string
  if (method === 'GET') {
    const day = new Date()
    day.setUTCHours(0, 0, 0, 0)
    datetime = amzDate(day)
    url.searchParams.set('X-Amz-Expires', String(expiresSec ?? 2 * 86400))
  } else {
    datetime = amzDate(new Date())
    url.searchParams.set('X-Amz-Expires', String(expiresSec ?? 3600))
  }
  const signed = await b2(env).sign(url.toString(), { method, aws: { signQuery: true, datetime, allHeaders: false } })
  return signed.url
}

async function b2Put(env: Env, key: string, body: string, contentType: string) {
  if (!safeKey(key)) throw new Error('bad key')
  const res = await b2(env).fetch(objectUrl(env, key).toString(), { method: 'PUT', body, headers: { 'Content-Type': contentType } })
  if (!res.ok) throw new Error(`B2 PUT ${res.status}: ${await res.text()}`)
}

async function b2Delete(env: Env, key: string) {
  if (!safeKey(key)) throw new Error('bad key')
  const res = await b2(env).fetch(objectUrl(env, key).toString(), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`B2 DELETE ${res.status}`)
}

// ------------------------------------------------------------------ auth
const userCache = new Map<string, { id: string; exp: number }>()

async function requireUser(env: Env, req: Request): Promise<{ id: string; token: string }> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) throw new HttpError(401, 'missing token')
  const cached = userCache.get(token)
  if (cached && cached.exp > Date.now()) return { id: cached.id, token }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY } })
  if (!res.ok) throw new HttpError(401, 'invalid token')
  const user = (await res.json()) as { id?: string }
  if (!user.id || !UUID.test(user.id)) throw new HttpError(401, 'invalid user')
  if (userCache.size > 500) userCache.clear()
  userCache.set(token, { id: user.id, exp: Date.now() + 5 * 60_000 })
  return { id: user.id, token }
}

/** PostgREST call as the user (RLS applies). */
async function asUser(env: Env, token: string, path: string) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY } })
  if (!res.ok) throw new HttpError(502, `db ${res.status}`)
  return res.json() as Promise<unknown[]>
}

function service(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

// ------------------------------------------------------------------ routes
async function mediaUpload(env: Env, req: Request) {
  const user = await requireUser(env, req)
  const body = (await req.json()) as { itemId?: string; parts?: { role: string; contentType: string; ext: string }[] }
  if (!body.itemId || !UUID.test(body.itemId)) throw new HttpError(400, 'bad itemId')
  if (!Array.isArray(body.parts) || body.parts.length < 1 || body.parts.length > 2) throw new HttpError(400, 'bad parts')
  // item must exist and belong to the caller (RLS)
  const rows = await asUser(env, user.token, `items?id=eq.${body.itemId}&select=id`)
  if (!rows.length) throw new HttpError(404, 'item not found')
  const id = crypto.randomUUID()
  const parts = await Promise.all(body.parts.map(async (p) => {
    const ext = String(p.ext ?? '').toLowerCase()
    if (!/^[a-z0-9]{1,5}$/.test(ext)) throw new HttpError(400, 'bad ext')
    if (!/^(image|video)\/[\w.+-]+$/.test(String(p.contentType))) throw new HttpError(400, 'bad content type')
    const folder = p.role === 'thumb' ? 'thumbs' : 'media'
    const key = `${PREFIX}${folder}/${user.id}/${body.itemId}/${id}.${ext}`
    return { role: p.role, key, url: await presign(env, 'PUT', key) }
  }))
  return { parts }
}

async function mediaUrls(env: Env, req: Request) {
  const user = await requireUser(env, req)
  const { keys } = (await req.json()) as { keys?: unknown[] }
  if (!Array.isArray(keys) || keys.length > 300) throw new HttpError(400, 'bad keys')
  const urls: Record<string, string> = {}
  for (const k of keys) if (typeof k === 'string' && ownsKey(user.id, k)) urls[k] = await presign(env, 'GET', k)
  return { urls }
}

async function mediaDelete(env: Env, req: Request) {
  const user = await requireUser(env, req)
  const { keys } = (await req.json()) as { keys?: unknown[] }
  if (!Array.isArray(keys) || keys.length > 500) throw new HttpError(400, 'bad keys')
  let deleted = 0
  for (const k of keys) {
    if (typeof k === 'string' && ownsKey(user.id, k)) { await b2Delete(env, k); deleted++ }
  }
  return { deleted }
}

interface SharedRaw {
  root_id: string
  items: unknown[]
  statuses: unknown[]
  media: { id: string; item_id: string; kind: string; width: number | null; height: number | null; phase: string; created_at: string; object_key: string; thumb_key: string | null }[]
}

async function share(env: Env, token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null
  const res = await service(env, 'rpc/shared_gallery', { method: 'POST', body: JSON.stringify({ p_token: token }) })
  if (!res.ok) throw new HttpError(502, `db ${res.status}`)
  const data = (await res.json()) as SharedRaw | null
  if (!data) return null
  const media = await Promise.all(data.media.map(async ({ object_key, thumb_key, ...m }) => ({
    ...m,
    url: safeKey(object_key) ? await presign(env, 'GET', object_key) : '',
    thumb_url: thumb_key && safeKey(thumb_key) ? await presign(env, 'GET', thumb_key) : null,
  })))
  return { root_id: data.root_id, items: data.items, statuses: data.statuses, media }
}

async function projectStatus(env: Env): Promise<string> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_REF}`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
  if (!res.ok) return 'UNKNOWN'
  return ((await res.json()) as { status?: string }).status ?? 'UNKNOWN'
}

async function dbAnswers(env: Env): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 6000)
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/statuses?select=id&limit=1`, { headers: { apikey: env.SUPABASE_ANON_KEY }, signal: ctl.signal })
    clearTimeout(t)
    return res.status < 500
  } catch {
    return false
  }
}

async function health(env: Env) {
  if (await dbAnswers(env)) return { state: 'up' }
  const status = await projectStatus(env)
  if (status === 'INACTIVE' || status === 'PAUSED') return { state: 'asleep', status }
  if (status === 'ACTIVE_HEALTHY' || status === 'RESTORING' || status === 'COMING_UP' || status === 'UPGRADING' || status === 'RESTARTING') return { state: 'waking', status }
  return { state: 'unreachable', status }
}

async function wake(env: Env) {
  const status = await projectStatus(env)
  if (status !== 'INACTIVE' && status !== 'PAUSED') return { ok: true, status, note: 'not paused' }
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_REF}/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new HttpError(502, `restore failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return { ok: true, status: 'RESTORING' }
}

// ------------------------------------------------------------------ cron: keep-alive + backup
export async function backup(env: Env) {
  if (!(await dbAnswers(env))) {
    // The project fell asleep anyway: wake it so tomorrow's run (and Gabi) find it up.
    await wake(env).catch(() => {})
    return { ok: false, reason: 'db asleep, restore requested' }
  }
  const tables: Record<string, unknown[]> = {}
  for (const t of TABLES) {
    const rows: unknown[] = []
    for (let from = 0; ; from += 1000) {
      const res = await service(env, `${t}?select=*`, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } })
      if (!res.ok) throw new Error(`backup ${t}: ${res.status}`)
      const page = (await res.json()) as unknown[]
      rows.push(...page)
      if (page.length < 1000) break
    }
    tables[t] = rows
  }
  const day = new Date().toISOString().slice(0, 10)
  const key = `${PREFIX}backups/${day}.json`
  await b2Put(env, key, JSON.stringify({ app: 'the-sand-gallery', exported_at: new Date().toISOString(), tables }), 'application/json')
  return { ok: true, key, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) }
}

// ------------------------------------------------------------------ entry
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const isPublic = path.startsWith('/api/share/') || path === '/api/health' || path === '/api/wake'
    const h = cors(env, req, isPublic)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
    try {
      if (req.method === 'POST' && path === '/api/media/upload') return json(await mediaUpload(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/media/urls') return json(await mediaUrls(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/media/delete') return json(await mediaDelete(env, req), 200, h)
      if (req.method === 'GET' && path.startsWith('/api/share/')) {
        const data = await share(env, decodeURIComponent(path.slice('/api/share/'.length)))
        return data ? json(data, 200, h) : json({ error: 'not found' }, 404, h)
      }
      if (req.method === 'GET' && path === '/api/health') return json(await health(env), 200, h)
      if (req.method === 'POST' && path === '/api/wake') return json(await wake(env), 200, h)
      if (path === '/' || path === '/api') return json({ name: 'sand-gallery-api', ok: true }, 200, h)
      return json({ error: 'not found' }, 404, h)
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      return json({ error: e instanceof Error ? e.message : 'error' }, status, h)
    }
  },

  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(backup(env).then((r) => console.log('backup', JSON.stringify(r))).catch((e) => console.error('backup failed', String(e))))
  },
} satisfies ExportedHandler<Env>
