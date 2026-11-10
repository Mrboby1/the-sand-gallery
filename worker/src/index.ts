/**
 * The Sand Gallery API Worker.
 *
 *  POST /api/media/upload   presigned PUT URLs for a new photo/video (+ thumbnail)   [auth]
 *  POST /api/media/urls     presigned GET URLs for the caller's own keys              [auth]
 *  POST /api/media/delete   deletes the caller's own objects                          [auth]
 *  GET  /api/share/:token   public read-only gallery for a share link (presigned media)
 *  GET  /api/health         { state: 'up' | 'asleep' | 'waking' | 'unreachable' }
 *  POST /api/wake           restores a paused Supabase project (Management API). Needs a Supabase JWT
 *                           (verified locally against the JWKS, so it works while the DB sleeps) and is
 *                           rate-limited; without a token only one call per 30 minutes is allowed.
 *  POST /api/backup         run the backup now (signed-in user; Settings > Back up now)
 *  GET  /api/push/key       public VAPID key
 *  POST /api/push/subscribe  register this device for Web Push [auth] -> { deviceId, deviceSecret }
 *  POST /api/push/unsubscribe                                     [auth]
 *  POST /api/push/test       test notification to all of the user's devices [auth]
 *  POST /api/timer/stop      "Stop" from a notification: { deviceId, deviceSecret } (no sign-in token needed)
 *  POST /api/hooks/session   called by the database (pg_net) when a timer starts/stops -> push to devices
 *  cron (daily)             keep-alive + JSON backup of all tables to B2
 *  cron (every 15 min)      "still working on X?" reminders, every N minutes (Settings) while a timer runs
 *
 * Backblaze is a SHARED account: every key this Worker signs or writes starts with `sand-gallery/`.
 */
import { AwsClient } from 'aws4fetch'
import { b64urlEncode, sendPush, type PushSubscriptionRow, type VapidKeys } from './webpush'

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
  SUPABASE_JWKS: string // public keys, JSON
  RATE: KVNamespace
  VAPID_PUBLIC: string
  VAPID_PRIVATE_JWK: string // secret
  HOOK_SECRET: string // secret, shared with the database hook
}

export const PREFIX = 'sand-gallery/'
const TABLES = ['statuses', 'items', 'notes', 'day_notes', 'sessions', 'media', 'cost_lines', 'templates', 'share_links', 'settings']
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
export async function presign(env: Env, method: 'GET' | 'PUT', key: string, expiresSec?: number, window: 'day' | 'hour' = 'day'): Promise<string> {
  if (!safeKey(key)) throw new HttpError(400, 'bad key')
  const url = objectUrl(env, key)
  let datetime: string
  if (method === 'GET') {
    const start = new Date()
    if (window === 'day') start.setUTCHours(0, 0, 0, 0)
    else start.setUTCMinutes(0, 0, 0)
    datetime = amzDate(start)
    url.searchParams.set('X-Amz-Expires', String(expiresSec ?? (window === 'day' ? 2 * 86400 : 2 * 3600)))
  } else {
    datetime = amzDate(new Date())
    url.searchParams.set('X-Amz-Expires', String(expiresSec ?? 3600))
  }
  const signed = await b2(env).sign(url.toString(), { method, aws: { signQuery: true, datetime, allHeaders: false } })
  return signed.url
}

// ------------------------------------------------------------------ media links through the Worker
/*
 * The browser never downloads from B2 directly (B2 egress is billable; B2 -> Cloudflare is free under the
 * Bandwidth Alliance). /api/media/urls and share pages hand out links to this Worker:
 *   /f/<key>?e=<expiry, unix s>&s=<HMAC-SHA256(key \n expiry), base64url>
 * The expiry is aligned to the UTC day (or hour for share pages), so a link stays the same all day and the browser /
 * service-worker caches hit. The HMAC key is derived from the B2 application key (no extra secret to manage).
 */
let linkKeyPromise: Promise<CryptoKey> | null = null
function linkKey(env: Env): Promise<CryptoKey> {
  linkKeyPromise ??= (async () => {
    const enc = new TextEncoder()
    const root = await crypto.subtle.importKey('raw', enc.encode(env.B2_APPLICATION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const derived = await crypto.subtle.sign('HMAC', root, enc.encode('sand-gallery media links v1'))
    return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  })()
  return linkKeyPromise
}

async function linkSig(env: Env, key: string, exp: number): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await linkKey(env), new TextEncoder().encode(`${key}\n${exp}`))
  return b64urlEncode(new Uint8Array(mac))
}

const LINK_MAX_AGE = 3 * 86400

/** A Worker link for one of our objects, valid 1-2 days ('day') or 1-2 hours ('hour'). */
export async function mediaLink(env: Env, origin: string, key: string, window: 'day' | 'hour' = 'day'): Promise<string> {
  if (!safeKey(key)) throw new HttpError(400, 'bad key')
  const unit = window === 'day' ? 86400 : 3600
  const exp = (Math.floor(Date.now() / 1000 / unit) + 2) * unit
  const path = key.split('/').map(encodeURIComponent).join('/')
  return `${origin}/f/${path}?e=${exp}&s=${await linkSig(env, key, exp)}`
}

/** Checks a /f/ link; returns the object key or throws (400 bad key, 403 expired / bad signature). */
export async function checkMediaLink(env: Env, url: URL, nowSec = Date.now() / 1000): Promise<string> {
  let key: string
  try { key = url.pathname.slice('/f/'.length).split('/').map(decodeURIComponent).join('/') } catch { throw new HttpError(400, 'bad key') }
  if (!safeKey(key)) throw new HttpError(400, 'bad key')
  const exp = Number(url.searchParams.get('e'))
  const sig = url.searchParams.get('s') ?? ''
  if (!Number.isInteger(exp) || exp < nowSec || exp > nowSec + LINK_MAX_AGE) throw new HttpError(403, 'link expired')
  if (!sameString(sig, await linkSig(env, key, exp))) throw new HttpError(403, 'bad signature')
  return key
}

const SAFE_TYPE = /^(image|video)\/[\w.+-]+$/i

/** GET/HEAD /f/<key>: streams the object from B2 (Range for video seeking), cacheable by the browser. */
async function serveMedia(env: Env, req: Request, url: URL): Promise<Response> {
  const base = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' }
  let key: string
  try { key = await checkMediaLink(env, url) } catch (e) {
    const st = e instanceof HttpError ? e.status : 400
    return new Response(e instanceof Error ? e.message : 'bad link', { status: st, headers: { ...base, 'Cache-Control': 'no-store' } })
  }
  const fwd = new Headers()
  for (const h of ['Range', 'If-None-Match', 'If-Modified-Since', 'If-Range']) { const v = req.headers.get(h); if (v) fwd.set(h, v) }
  const res = await b2(env).fetch(objectUrl(env, key).toString(), { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: fwd })
  if (res.status === 404) return new Response('not found', { status: 404, headers: { ...base, 'Cache-Control': 'no-store' } })
  if (!(res.ok || res.status === 304 || res.status === 416)) {
    // e.g. B2 refusing downloads (daily cap): say so without leaking B2 details, never cache it
    console.error('B2 GET failed', res.status, (await res.text().catch(() => '')).slice(0, 300))
    return new Response('storage unavailable', { status: 502, headers: { ...base, 'Cache-Control': 'no-store', 'X-Storage-Status': String(res.status) } })
  }
  const out = new Headers(base)
  for (const h of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) { const v = res.headers.get(h); if (v) out.set(h, v) }
  const type = res.headers.get('Content-Type') ?? ''
  out.set('Content-Type', SAFE_TYPE.test(type) ? type : 'application/octet-stream')
  if (url.searchParams.get('dl') === '1') {
    // download with a clean file name; ASCII fallback + RFC 5987 UTF-8 version
    const raw = (url.searchParams.get('name') ?? key.split('/').pop() ?? 'file').replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, '_').slice(0, 150) || 'file'
    const ascii = raw.replace(/[^\x20-\x7e]/g, '_')
    out.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`)
  } else out.set('Content-Disposition', 'inline')
  if (!out.has('Accept-Ranges')) out.set('Accept-Ranges', 'bytes')
  // object keys contain random ids and never change: the browser may keep them for a week
  out.set('Cache-Control', 'private, max-age=604800, immutable')
  return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, headers: out })
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

/**
 * The online version is private (migration 0011): the caller's e-mail must be on public.allowed_emails.
 * Answer cached per user for 5 minutes in memory; if the database cannot be reached (asleep), a "yes" from the last
 * 7 days (KV) still lets media through, so photos keep showing while the project wakes up.
 */
const accessCache = new Map<string, { ok: boolean; exp: number }>()
async function requireAllowed(env: Env, user: { id: string; token: string }) {
  const c = accessCache.get(user.id)
  if (c && c.exp > Date.now()) { if (!c.ok) throw new HttpError(403, 'not_allowed'); return }
  let ok: boolean | null = null
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_allowed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (res.ok) ok = (await res.json()) === true
  } catch { /* unreachable */ }
  const kvKey = `allowed:${user.id}`
  if (ok === null) {
    // database unreachable: trust a recent yes
    if ((await env.RATE.get(kvKey)) === '1') return
    throw new HttpError(503, 'cannot check access right now')
  }
  if (accessCache.size > 500) accessCache.clear()
  accessCache.set(user.id, { ok, exp: Date.now() + 5 * 60_000 })
  if (!ok) { await env.RATE.delete(kvKey).catch(() => {}); throw new HttpError(403, 'not_allowed') }
  // remember the yes (written at most once a day per user: KV writes are limited)
  const stamp = `allowed-at:${user.id}`
  if (!(await env.RATE.get(stamp))) {
    await env.RATE.put(kvKey, '1', { expirationTtl: 7 * 86400 }).catch(() => {})
    await env.RATE.put(stamp, '1', { expirationTtl: 86400 }).catch(() => {})
  }
}

async function requireUser(env: Env, req: Request): Promise<{ id: string; token: string }> {
  const user = await requireSignedIn(env, req)
  await requireAllowed(env, user)
  return user
}

async function requireSignedIn(env: Env, req: Request): Promise<{ id: string; token: string }> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) throw new HttpError(401, 'missing token')
  const cached = userCache.get(token)
  if (cached && cached.exp > Date.now()) return { id: cached.id, token }
  const local = await verifyJwt(env, token)
  if (local) return { id: local.sub, token }
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
  const origin = new URL(req.url).origin
  for (const k of keys) if (typeof k === 'string' && ownsKey(user.id, k)) urls[k] = await mediaLink(env, origin, k, 'day')
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

async function share(env: Env, token: string, origin: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null
  const res = await service(env, 'rpc/shared_gallery', { method: 'POST', body: JSON.stringify({ p_token: token }) })
  if (!res.ok) throw new HttpError(502, `db ${res.status}`)
  const data = (await res.json()) as SharedRaw | null
  if (!data) return null
  const media = await Promise.all(data.media.map(async ({ object_key, thumb_key, ...m }) => ({
    ...m,
    url: safeKey(object_key) ? await mediaLink(env, origin, object_key, 'hour') : '',
    thumb_url: thumb_key && safeKey(thumb_key) ? await mediaLink(env, origin, thumb_key, 'hour') : null,
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

// ------------------------------------------------------------------ JWT (local verification) + rate limit
function b64urlBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

interface Jwk { kid?: string; kty: string; crv?: string; x?: string; y?: string; alg?: string }
let liveJwks: { keys: Jwk[]; at: number } | null = null

async function jwks(env: Env, kid: string | undefined): Promise<Jwk | undefined> {
  const embedded = (JSON.parse(env.SUPABASE_JWKS) as { keys: Jwk[] }).keys
  let k = embedded.find((x) => x.kid === kid)
  if (k) return k
  if (!liveJwks || Date.now() - liveJwks.at > 3600_000) {
    try {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
      if (res.ok) liveJwks = { keys: ((await res.json()) as { keys: Jwk[] }).keys, at: Date.now() }
    } catch { /* asleep: embedded keys only */ }
  }
  k = liveJwks?.keys.find((x) => x.kid === kid)
  return k
}

/**
 * Verifies a Supabase access token's ES256 signature locally. `graceSec` lets a recently expired token
 * through (used by wake-up: the auth server sleeps too, so the browser cannot refresh its token).
 */
export async function verifyJwt(env: Env, token: string, graceSec = 0): Promise<{ sub: string } | null> {
  try {
    const [h, p, sig] = token.split('.')
    if (!h || !p || !sig) return null
    const header = JSON.parse(new TextDecoder().decode(b64urlBytes(h))) as { alg?: string; kid?: string }
    if (header.alg !== 'ES256') return null
    const jwk = await jwks(env, header.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`))
    if (!ok) return null
    const claims = JSON.parse(new TextDecoder().decode(b64urlBytes(p))) as { sub?: string; exp?: number; aud?: string | string[]; iss?: string; role?: string }
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes('authenticated') || claims.role !== 'authenticated') return null
    if (claims.iss && claims.iss !== `${env.SUPABASE_URL}/auth/v1`) return null
    if (!claims.exp || claims.exp + graceSec < Date.now() / 1000) return null
    if (!claims.sub || !UUID.test(claims.sub)) return null
    return { sub: claims.sub }
  } catch {
    return null
  }
}

/** Fixed-window limit: false if `key` was used within the last `windowSec` seconds. */
async function allow(env: Env, key: string, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`
  if (await env.RATE.get(k)) return false
  await env.RATE.put(k, String(Date.now()), { expirationTtl: Math.max(60, windowSec) })
  return true
}

async function wakeRequest(env: Env, req: Request) {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const user = token ? await verifyJwt(env, token, 30 * 86400) : null
  // Signed-in (or recently signed-in) users: one restore request per minute.
  // No valid token (e.g. a new device while everything sleeps): one per 30 minutes for everyone together.
  const ok = user ? await allow(env, `wake:${user.sub}`, 60) : await allow(env, 'wake:anon', 1800)
  if (!ok) throw new HttpError(429, 'too many wake-up requests, try again in a minute')
  return wake(env)
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

// ------------------------------------------------------------------ notifications (Web Push)
const PUSH_SUBJECT = 'https://thesandgallery.pages.dev'
const vapid = (env: Env): VapidKeys => ({ publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey })

async function sha256(s: string): Promise<string> {
  return b64urlEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return x === 0
}

async function userSettings(env: Env, ownerId: string): Promise<{ notify_enabled: boolean; reminder_hours: number; reminder_minutes?: number | null }> {
  const res = await service(env, `settings?owner_id=eq.${ownerId}&select=notify_enabled,reminder_hours,reminder_minutes`)
  const rows = res.ok ? ((await res.json()) as { notify_enabled: boolean; reminder_hours: number; reminder_minutes?: number | null }[]) : []
  return rows[0] ?? { notify_enabled: true, reminder_hours: 2, reminder_minutes: 120 }
}

/** Pushes to every device of a user; drops subscriptions the push service says are gone. */
async function pushToUser(env: Env, ownerId: string, data: unknown, opts: { topic?: string; ttl?: number } = {}): Promise<number> {
  const res = await service(env, `push_subscriptions?owner_id=eq.${ownerId}&select=id,endpoint,p256dh,auth`)
  if (!res.ok) return 0
  const subs = (await res.json()) as PushSubscriptionRow[]
  let ok = 0
  await Promise.all(subs.map(async (s) => {
    try {
      const st = await sendPush(s, data, vapid(env), PUSH_SUBJECT, opts)
      if (st === 404 || st === 410) await service(env, `push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' })
      else if (st < 300) { ok++; await service(env, `push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ last_ok_at: new Date().toISOString() }) }) }
      else console.log('push failed', st)
    } catch (e) { console.log('push error', String(e)) }
  }))
  return ok
}

async function pushSubscribe(env: Env, req: Request) {
  const user = await requireUser(env, req)
  const b = (await req.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string }; userAgent?: string; deviceKey?: string }
  if (!b.endpoint || !/^https:\/\//.test(b.endpoint) || b.endpoint.length > 1000 || !b.keys?.p256dh || !b.keys?.auth) throw new HttpError(400, 'bad subscription')
  const deviceKey = typeof b.deviceKey === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(b.deviceKey) ? b.deviceKey : null
  const ua = (b.userAgent ?? '').slice(0, 200)
  const secret = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const res = await service(env, 'push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ owner_id: user.id, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, device_secret_hash: await sha256(secret), user_agent: ua, device_key: deviceKey }),
  })
  if (!res.ok) throw new HttpError(502, `db ${res.status}`)
  const [row] = (await res.json()) as { id: string }[]
  // One row per device: drop this device's older registrations (same device key), and rows from before
  // device keys existed that came from the same browser (same user agent, no key).
  if (deviceKey) {
    const ep = encodeURIComponent(b.endpoint)
    await service(env, `push_subscriptions?owner_id=eq.${user.id}&device_key=eq.${encodeURIComponent(deviceKey)}&endpoint=neq.${ep}`, { method: 'DELETE' })
    if (ua) await service(env, `push_subscriptions?owner_id=eq.${user.id}&device_key=is.null&user_agent=eq.${encodeURIComponent(ua)}&endpoint=neq.${ep}`, { method: 'DELETE' })
  }
  return { deviceId: row.id, deviceSecret: secret }
}

async function pushUnsubscribe(env: Env, req: Request) {
  const user = await requireUser(env, req)
  const { endpoint } = (await req.json()) as { endpoint?: string }
  if (!endpoint) throw new HttpError(400, 'bad endpoint')
  await service(env, `push_subscriptions?owner_id=eq.${user.id}&endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' })
  return { ok: true }
}

async function pushTest(env: Env, req: Request) {
  const user = await requireUser(env, req)
  if (!(await allow(env, `pushtest:${user.id}`, 60))) throw new HttpError(429, 'one test per minute')
  const sent = await pushToUser(env, user.id, { type: 'test' }, { ttl: 600 })
  return { sent }
}

/** The notification's Stop button: authenticated by the device's own secret, works with the app closed. */
async function timerStopFromDevice(env: Env, req: Request) {
  const { deviceId, deviceSecret } = (await req.json()) as { deviceId?: string; deviceSecret?: string }
  if (!deviceId || !UUID.test(deviceId) || !deviceSecret) throw new HttpError(400, 'bad device')
  const res = await service(env, `push_subscriptions?id=eq.${deviceId}&select=owner_id,device_secret_hash`)
  const [dev] = res.ok ? ((await res.json()) as { owner_id: string; device_secret_hash: string }[]) : []
  if (!dev || !sameString(dev.device_secret_hash, await sha256(deviceSecret))) throw new HttpError(401, 'unknown device')
  if (!(await allow(env, `stop:${deviceId}`, 60))) return { ok: true, note: 'already stopping' }
  // closing the open session fires the database hook, which clears the notification on every device
  const up = await service(env, `sessions?owner_id=eq.${dev.owner_id}&ended_at=is.null`, { method: 'PATCH', body: JSON.stringify({ ended_at: new Date().toISOString() }) })
  if (!up.ok) throw new HttpError(502, `db ${up.status}`)
  return { ok: true }
}

interface HookBody { event: 'start' | 'stop'; owner_id: string; session_id: string; item_id: string; title: string; started_at: string }

/** Database hook (pg_net): a timer started or stopped somewhere -> show/clear the notification everywhere. */
async function sessionHook(env: Env, req: Request) {
  const secret = req.headers.get('X-Hook-Secret') ?? ''
  if (!env.HOOK_SECRET || !sameString(secret, env.HOOK_SECRET)) throw new HttpError(401, 'bad hook secret')
  const b = (await req.json()) as HookBody
  if (!b.owner_id || !UUID.test(b.owner_id)) throw new HttpError(400, 'bad body')
  const s = await userSettings(env, b.owner_id)
  if (b.event === 'start' && !s.notify_enabled) return { sent: 0 }
  const data = b.event === 'start'
    ? { type: 'timer-start', session_id: b.session_id, item_id: b.item_id, title: b.title, started_at: b.started_at }
    : { type: 'timer-stop', session_id: b.session_id }
  // same topic: a phone that was offline only gets the latest start/stop
  return { sent: await pushToUser(env, b.owner_id, data, { topic: 'timer' }) }
}

/** Every 15 min: "Still working on X?" once per reminder interval while a timer stays open. */
export async function reminders(env: Env) {
  const res = await service(env, 'sessions?ended_at=is.null&select=id,owner_id,item_id,started_at,reminded_at')
  if (!res.ok) return { ok: false }
  const open = (await res.json()) as { id: string; owner_id: string; item_id: string; started_at: string; reminded_at: string | null }[]
  const now = Date.now()
  let sent = 0
  for (const s of open) {
    const st = await userSettings(env, s.owner_id)
    // any interval in minutes (from 15); older rows only have whole hours
    const minutes = st.reminder_minutes ?? st.reminder_hours * 60
    if (!st.notify_enabled || !minutes) continue
    const every = minutes * 60_000
    const started = Date.parse(s.started_at)
    const last = s.reminded_at ? Date.parse(s.reminded_at) : started
    if (now - started < every || now - last < every - 60_000) continue
    const it = await service(env, `items?id=eq.${s.item_id}&select=title`)
    const [item] = it.ok ? ((await it.json()) as { title: string }[]) : []
    sent += await pushToUser(env, s.owner_id, { type: 'timer-reminder', session_id: s.id, item_id: s.item_id, title: item?.title ?? '', started_at: s.started_at }, { topic: 'timer' })
    await service(env, `sessions?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ reminded_at: new Date(now).toISOString() }) })
  }
  return { ok: true, open: open.length, sent }
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
    if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/f/')) {
      try { return await serveMedia(env, req, url) } catch (e) {
        console.error('media proxy', String(e))
        return new Response('storage unavailable', { status: 502, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } })
      }
    }
    try {
      if (req.method === 'POST' && path === '/api/media/upload') return json(await mediaUpload(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/media/urls') return json(await mediaUrls(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/media/delete') return json(await mediaDelete(env, req), 200, h)
      if (req.method === 'GET' && path.startsWith('/api/share/')) {
        const data = await share(env, decodeURIComponent(path.slice('/api/share/'.length)), url.origin)
        return data ? json(data, 200, h) : json({ error: 'not found' }, 404, h)
      }
      if (req.method === 'GET' && path === '/api/health') return json(await health(env), 200, h)
      if (req.method === 'POST' && path === '/api/wake') return json(await wakeRequest(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/backup') {
        const u = await requireUser(env, req)
        if (!(await allow(env, `backup:${u.id}`, 300))) throw new HttpError(429, 'a backup was made a few minutes ago')
        return json(await backup(env), 200, h)
      }
      if (req.method === 'GET' && path === '/api/push/key') return json({ publicKey: env.VAPID_PUBLIC }, 200, h)
      if (req.method === 'POST' && path === '/api/push/subscribe') return json(await pushSubscribe(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/push/unsubscribe') return json(await pushUnsubscribe(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/push/test') return json(await pushTest(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/timer/stop') return json(await timerStopFromDevice(env, req), 200, h)
      if (req.method === 'POST' && path === '/api/hooks/session') return json(await sessionHook(env, req), 200, h)
      if (path === '/' || path === '/api') return json({ name: 'sand-gallery-api', ok: true }, 200, h)
      return json({ error: 'not found' }, 404, h)
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      return json({ error: e instanceof Error ? e.message : 'error' }, status, h)
    }
  },

  async scheduled(ctrl: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (ctrl.cron !== '0 3 * * *') {
      ctx.waitUntil(reminders(env).then((r) => console.log('reminders', JSON.stringify(r))).catch((e) => console.error('reminders failed', String(e))))
      return
    }
    ctx.waitUntil(backup(env).then((r) => console.log('backup', JSON.stringify(r))).catch((e) => console.error('backup failed', String(e))))
  },
} satisfies ExportedHandler<Env>
