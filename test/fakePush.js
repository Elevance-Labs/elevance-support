/**
 * A browser that can do Web Push, and the server's side of it, for the tests
 * of device notifications. Install before importing the app.
 *
 *   browser.permission     'default' | 'granted' | 'denied'
 *   browser.subscribed()   whether the browser holds a subscription
 *   server                 the endpoints the database has, and whose
 *   caller.id              who the database thinks is signed in
 *
 * `save_push_subscription` behaves as migration 0023's does: turning on
 * registers the device to the caller; a check only reports (and refreshes)
 * a registration that is still the caller's.
 */
import { rpcResults } from './mockSupabase.js'

export const ENDPOINT = 'https://push.example/device-1'

export function installFakePush(W, { me = 'user-1' } = {}) {
  // Who the database thinks is calling: whoever the test has signed in.
  const caller = { id: me }
  let subscription = null
  const browser = {
    permission: 'default', asked: 0, subscribedWith: null, unsubscribed: 0,
    subscribed: () => Boolean(subscription),
    // As if the browser (or the push service) dropped it.
    drop: () => { subscription = null },
    subscribeNow: () => { subscription = fake() },
    onPermissionChange: null,
  }
  const server = new Map() // endpoint -> owner
  const fake = () => ({
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
    unsubscribe: async () => { browser.unsubscribed++; subscription = null; return true },
  })
  const registration = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async (opts) => { browser.subscribedWith = opts; subscription = fake(); return subscription },
    },
  }
  Object.defineProperty(W.navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => registration, addEventListener() {}, removeEventListener() {} },
  })
  const status = { onchange: null }
  Object.defineProperty(W.navigator, 'permissions', {
    configurable: true, value: { query: async () => status },
  })
  browser.changePermission = (p) => { browser.permission = p; status.onchange?.() }
  W.PushManager = function PushManager() {}
  globalThis.Notification = W.Notification = {
    get permission() { return browser.permission },
    requestPermission: async () => { browser.asked++; browser.permission = 'granted'; return 'granted' },
  }
  rpcResults.save_push_subscription = (args) => {
    if (!args.p_refresh_only) { server.set(args.p_endpoint, caller.id); return true }
    const owner = server.get(args.p_endpoint)
    if (owner && owner !== caller.id) server.delete(args.p_endpoint)
    return owner === caller.id
  }
  return { browser, server, caller }
}
