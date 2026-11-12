/**
 * Web Push from push-send: the payload encryption (RFC 8291) checked against
 * the RFC's own worked example byte for byte, a round trip through a receiver
 * written from the spec, and the VAPID token (RFC 8292) verified with the
 * public key a browser would subscribe with.
 */
import { reporter } from './setup.js'
import {
  b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization,
} from '../supabase/functions/push-send/webpush.ts'

const { check, done } = reporter()
const enc = new TextEncoder()
const subtle = globalThis.crypto.subtle

// ---------- RFC 8291, Appendix A ----------
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

const body = await encryptPayload(enc.encode(RFC.plaintext), RFC.uaPublic, RFC.auth, {
  salt: b64urlDecode(RFC.salt), local: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate },
})
check('matches RFC 8291\'s worked example byte for byte', b64urlEncode(body) === RFC.body, b64urlEncode(body))

// ---------- a receiver, written from the spec, decrypts a real (random) one ----------
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length } return o }
const hkdf = async (salt, ikm, info, len) => new Uint8Array(await subtle.deriveBits(
  { name: 'HKDF', hash: 'SHA-256', salt, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8))

async function receive(bodyBytes, uaKeys, authSecret) {
  const salt = bodyBytes.slice(0, 16)
  const idlen = bodyBytes[20]
  const asPublic = bodyBytes.slice(21, 21 + idlen)
  const sealed = bodyBytes.slice(21 + idlen)
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256))
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', uaKeys.publicKey))
  const ikm = await hkdf(authSecret, secret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed))
  return { text: new TextDecoder().decode(plain.slice(0, -1)), delimiter: plain.at(-1), rs: new DataView(bodyBytes.buffer, bodyBytes.byteOffset + 16, 4).getUint32(0) }
}

const browser = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const browserPublic = b64urlEncode(new Uint8Array(await subtle.exportKey('raw', browser.publicKey)))
const authSecret = globalThis.crypto.getRandomValues(new Uint8Array(16))
const message = JSON.stringify({ title: 'ACME-42 · Cannot export invoice', body: 'Ada mentioned you — “café ☕”' })
const sealed = await encryptPayload(enc.encode(message), browserPublic, b64urlEncode(authSecret))
const opened = await receive(sealed, browser, authSecret)
check('a browser with the subscription keys decrypts it', opened.text === message, opened.text)
check('as the last record (0x02 delimiter)', opened.delimiter === 2)
check('record size 4096 in the header', opened.rs === 4096)
const again = await encryptPayload(enc.encode(message), browserPublic, b64urlEncode(authSecret))
check('fresh salt and sender key every time', b64urlEncode(again.slice(0, 86)) !== b64urlEncode(sealed.slice(0, 86)))

let refused = false
try { await receive(sealed, browser, globalThis.crypto.getRandomValues(new Uint8Array(16))) } catch { refused = true }
check('the wrong auth secret cannot open it', refused)

// ---------- VAPID ----------
const vapidPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwk = await subtle.exportKey('jwk', vapidPair.privateKey)
const vapid = {
  publicKey: b64urlEncode(new Uint8Array(await subtle.exportKey('raw', vapidPair.publicKey))),
  privateKey: jwk.d,
  subject: 'mailto:support@example.com',
}
const now = Date.UTC(2026, 10, 12, 9, 0, 0)
const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', vapid, now)
const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? []
check('header is "vapid t=…, k=…"', Boolean(token && k), header)
check('k is the public key the browser subscribed with', k === vapid.publicKey)
const [h, c, sig] = token.split('.')
const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)))
check('aud is the push service\'s origin only', claims.aud === 'https://fcm.googleapis.com', claims.aud)
check('exp is within 24 hours (12h)', claims.exp === now / 1000 + 12 * 3600, claims.exp)
check('sub says who to contact', claims.sub === vapid.subject)
check('ES256', JSON.parse(new TextDecoder().decode(b64urlDecode(h))).alg === 'ES256')
const verified = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapidPair.publicKey,
  b64urlDecode(sig), enc.encode(`${h}.${c}`))
check('signature verifies with the public key', verified)
check('signature is raw r||s (64 bytes), as JWS wants', b64urlDecode(sig).length === 64)

done()
