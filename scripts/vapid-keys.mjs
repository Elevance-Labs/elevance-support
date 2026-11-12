// Prints a fresh VAPID key pair for device notifications (Web Push).
//
//   npm run vapid-keys
//
// The public key goes to the app (VITE_VAPID_PUBLIC_KEY) and to push-send
// (VAPID_PUBLIC_KEY); the private key goes to push-send only
// (VAPID_PRIVATE_KEY). Changing the pair later is allowed — every device
// re-subscribes the next time its owner turns notifications on — but devices
// stop getting them until then.
const { subtle } = globalThis.crypto
const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)))
const { d: privateKey } = await subtle.exportKey('jwk', pair.privateKey)

console.log(`VAPID public key (app and push-send):\n  ${publicKey}\n`)
console.log(`VAPID private key (push-send only — keep it secret):\n  ${privateKey}\n`)
console.log('In .env (then rebuild the app):')
console.log(`  VITE_VAPID_PUBLIC_KEY=${publicKey}\n`)
console.log('For the function:')
console.log(`  supabase secrets set VAPID_PUBLIC_KEY='${publicKey}' VAPID_PRIVATE_KEY='${privateKey}' VAPID_SUBJECT='mailto:support@yourcompany.com'`)
