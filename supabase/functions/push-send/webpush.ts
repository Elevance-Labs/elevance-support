// Web Push, with nothing but WebCrypto: the payload encryption browsers
// require (RFC 8291, `aes128gcm`) and the VAPID signature that identifies the
// sender to the push service (RFC 8292).
//
// No library: the two standards are small, the popular package leans on
// Node's crypto, and this file is pure — it runs in Deno for push-send and in
// Node for the tests (test/webpush.test.js checks it against the RFC's own
// worked example).

const enc = new TextEncoder();

/** Bytes over a plain ArrayBuffer — what every WebCrypto call accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** base64url, no padding — how every key and secret here is written. */
export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** A P-256 key pair as JWKs, from the raw public point (65 bytes) and private scalar (32). */
function p256Jwk(publicRaw: Bytes, privateRaw?: Bytes): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("Not an uncompressed P-256 public key");
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256", ext: true,
    x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)),
  };
  if (privateRaw) jwk.d = b64urlEncode(privateRaw);
  return jwk;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** The sender's half of the exchange: fresh for every message unless a test fixes it. */
export interface LocalKeys {
  publicKey: string; // base64url, 65 bytes
  privateKey: string; // base64url, 32 bytes
}

/**
 * Encrypts a payload to one browser subscription (RFC 8291) as a single
 * `aes128gcm` record. `p256dh` and `auth` are the subscription's keys, as the
 * browser handed them over. Returns the request body.
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  fixed?: { salt?: Bytes; local?: LocalKeys },
): Promise<Bytes> {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  if (fixed?.local) {
    asPublic = b64urlDecode(fixed.local.publicKey);
    asPrivate = await crypto.subtle.importKey(
      "jwk", p256Jwk(asPublic, b64urlDecode(fixed.local.privateKey)),
      { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  // RFC 8291 §3.4: the auth secret and both public keys bind the key to this
  // subscription; then RFC 8188 derives the content key and nonce from it.
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // One record: the payload, then the 0x02 delimiter that marks the last one.
  const record = concat(payload, new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record));

  // Header: salt, record size, and the sender's public key as the key id.
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/**
 * The VAPID `Authorization` header for one push service (RFC 8292): a short
 * ES256 token naming the service's origin, an expiry and who to contact, plus
 * the public key the browser subscribed with.
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: { publicKey: string; privateKey: string; subject: string },
  now = Date.now(),
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  })));
  const signingKey = await crypto.subtle.importKey(
    "jwk", p256Jwk(b64urlDecode(keys.publicKey), b64urlDecode(keys.privateKey)),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto's ECDSA signature is already the raw r||s that JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, signingKey, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

export interface Subscription { endpoint: string; p256dh: string; auth: string }

/**
 * Sends one push. Resolves to the push service's status: 201 is delivered to
 * the service; 404 and 410 mean the subscription is gone for good.
 */
export async function sendPush(
  sub: Subscription,
  payload: unknown,
  vapid: { publicKey: string; privateKey: string; subject: string },
  { ttl = 24 * 60 * 60, urgency = "normal", topic }: { ttl?: number; urgency?: string; topic?: string } = {},
): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(ttl),
    Urgency: urgency,
  };
  // A newer push with the same topic replaces an undelivered older one — a
  // phone that was off gets the latest word on a ticket, not every word.
  if (topic) headers.Topic = topic;
  const res = await fetch(sub.endpoint, { method: "POST", headers, body });
  await res.body?.cancel();
  return res.status;
}
