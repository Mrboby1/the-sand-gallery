/**
 * Minimal Web Push for Workers (WebCrypto only):
 *  - VAPID (RFC 8292): an ES256 JWT signed with our private key, sent as `Authorization: vapid t=…, k=…`.
 *  - Payload encryption (RFC 8291, "aes128gcm"): ECDH with the browser's p256dh key + its auth secret,
 *    HKDF-SHA-256 to derive the content key and nonce, AES-128-GCM, one record.
 */

const enc = new TextEncoder()

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

export interface VapidKeys { publicKey: string; privateJwk: JsonWebKey }

async function vapidAuth(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })))
  const key = await crypto.subtle.importKey('jwk', { ...keys.privateJwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${keys.publicKey}`
}

export async function encrypt(payload: Uint8Array, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dh) // 65 bytes, uncompressed point
  const auth = b64urlDecode(authSecret) // 16 bytes
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', as.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey, $public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, as.privateKey, 256))
  // RFC 8291 section 3.3/3.4
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const record = concat(payload, new Uint8Array([2])) // last (only) record, no padding
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record))
  // header: salt(16) | record size(4) | key id length(1) | key id (our public key)
  const rs = new Uint8Array([0, 0, 0x10, 0]) // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

export interface PushSubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string }

/** Sends one push. Returns the push service status (201 = accepted; 404/410 = subscription is gone). */
export async function sendPush(sub: PushSubscriptionRow, data: unknown, keys: VapidKeys, subject: string, opts: { ttl?: number; urgency?: 'high' | 'normal'; topic?: string } = {}): Promise<number> {
  const body = await encrypt(enc.encode(JSON.stringify(data)), sub.p256dh, sub.auth)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 6 * 3600),
      Urgency: opts.urgency ?? 'high',
      ...(opts.topic ? { Topic: opts.topic } : {}),
    },
    body,
  })
  return res.status
}
