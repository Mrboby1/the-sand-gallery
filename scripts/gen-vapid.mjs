// Generates a VAPID key pair (ECDSA P-256) for Web Push. Prints ONE line of JSON
// {publicKey, privateJwk} meant to be captured by setup-push.ps1, never shown.
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
process.stdout.write(JSON.stringify({ publicKey: b64url(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } }))
