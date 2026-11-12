import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { detectDevice, isStandalone } from '../lib/install'
import { deviceLabel, pushStatus, subscriptionKeys, vapidKeyBytes } from '../lib/push'
import { pushEnvironment, subscribePush, unsubscribePush } from '../pwa'

/** The app's VAPID public key: the same value as push-send's VAPID_PUBLIC_KEY. */
const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

// Who last had notifications on in this browser (their profile id). Lets the
// app tell "never turned on" from "stopped" — permission revoked, the device
// removed elsewhere, the push service dropping it — and only for that person.
const WAS_ON_KEY = 'el-support.push-on'
const readWasOn = () => { try { return localStorage.getItem(WAS_ON_KEY) } catch { return null } }
const writeWasOn = (id) => {
  try {
    if (id) localStorage.setItem(WAS_ON_KEY, id)
    else localStorage.removeItem(WAS_ON_KEY)
  } catch { /* this visit only */ }
}

const media = (query) => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null)
const standaloneNow = () => isStandalone((q) => media(q)?.matches === true, navigator.standalone)
const thisDevice = () => detectDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)

/**
 * Hands this browser's subscription to the database. Turning on registers it
 * as the signed-in person's; a check (`refreshOnly`) never registers anything,
 * only refreshes a registration that is still theirs. Resolves to whether the
 * device gets their notifications.
 */
async function save(subscription, { refreshOnly = false } = {}) {
  const keys = subscriptionKeys(subscription)
  if (!keys) throw new Error('The browser returned an incomplete subscription.')
  const { data, error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: keys.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    p_device: deviceLabel(thisDevice(), standaloneNow()), p_refresh_only: refreshOnly,
  })
  if (error) throw error
  return data === true
}

/**
 * Signing out: this device stops getting the person's notifications — the
 * row goes, and the browser's subscription with it, so whoever signs in next
 * on a shared machine starts with nothing. Never holds up the sign-out.
 */
export async function forgetPushDevice() {
  writeWasOn(null)
  if (!VAPID_KEY) return
  const work = (async () => {
    const env = await pushEnvironment()
    const endpoint = env.subscription?.endpoint
    if (!endpoint) return
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    await unsubscribePush()
  })().catch(() => {})
  await Promise.race([work, new Promise((r) => setTimeout(r, 2000))])
}

/**
 * Notifications on this device: whether it really gets them, and turning them
 * on, off, or testing them. Used by the Profile page and the bell.
 *
 * "On" is checked, not assumed: the browser must be subscribed with permission
 * granted, *and* the server must still have this device as yours. Checked when
 * the app starts, whenever it comes back to the front, when the browser's
 * permission changes, and on `refresh()` (the bell opening) — so a device that
 * stopped getting them shows as off, and `wasOn` says it used to.
 */
export default function usePushDevice(userId) {
  const device = useMemo(() => thisDevice(), [])
  const [status, setStatus] = useState('loading')
  const [endpoint, setEndpoint] = useState(null) // this browser's, when subscribed
  const [wasOn, setWasOn] = useState(() => Boolean(userId) && readWasOn() === userId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const env = await pushEnvironment()
    let registered = false
    if (VAPID_KEY && env.subscription && env.permission === 'granted') {
      registered = await save(env.subscription, { refreshOnly: true }).catch(() => false)
    }
    const next = pushStatus({
      vapidKey: VAPID_KEY, device, standalone: standaloneNow(),
      subscribed: Boolean(env.subscription), registered, ...env,
    })
    if (next === 'on' && userId) writeWasOn(userId)
    setWasOn(Boolean(userId) && readWasOn() === userId)
    setEndpoint(env.subscription?.endpoint ?? null)
    setStatus(next)
    return next
  }, [device, userId])

  useEffect(() => {
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    // The browser says when its permission changes (Chrome, Edge, Firefox);
    // elsewhere coming back to the front catches it.
    let permission = null
    navigator.permissions?.query?.({ name: 'notifications' })
      .then((p) => { permission = p; p.onchange = () => refresh() })
      .catch(() => {})
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (permission) permission.onchange = null
    }
  }, [refresh])

  const run = async (fn) => {
    setBusy(true); setError('')
    try {
      await fn()
      return true
    } catch (err) {
      setError(err?.message ?? 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const enable = () => run(async () => save(await subscribePush(vapidKeyBytes(VAPID_KEY))))

  // Turned off on purpose: not "stopped", so nothing nags about it.
  const disable = () => run(async () => {
    writeWasOn(null)
    const endpoint = await unsubscribePush()
    if (endpoint) {
      const { error: err } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
      if (err) throw err
    }
  })

  const test = () => run(async () => {
    const { error: err } = await supabase.rpc('send_test_notification')
    if (err) throw err
  })

  return { status, wasOn, endpoint, device, busy, error, refresh, enable, disable, test, clearError: () => setError('') }
}
