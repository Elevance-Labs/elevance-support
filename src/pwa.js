/**
 * Registers the service worker that vite.pwa builds, and reports when a newer
 * build is ready.
 *
 * `onUpdate(apply)` is called once a new version has been downloaded and is
 * waiting; calling `apply()` switches to it and reloads the page. Nothing is
 * ever swapped under a page that did not ask.
 *
 * Not registered in development, inside another site's frame (the embedded
 * request form), or on the public pages listed in `skip`: those must always
 * come from the network, and their visitors are not installing anything.
 */
export function registerServiceWorker(onUpdate, { skip = [] } = {}) {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (window.top !== window.self) return
  const base = new URL(import.meta.env.BASE_URL, window.location.href).pathname
  const path = window.location.pathname.slice(base.length)
  if (skip.some((prefix) => path.startsWith(prefix))) return

  let applying = false
  // The first install also takes control of the page; only a requested update
  // should reload it.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) window.location.reload()
  })

  const offer = (worker) => onUpdate(() => {
    applying = true
    worker.postMessage('skip-waiting')
  })

  navigator.serviceWorker.register(`${base}sw.js`).then((registration) => {
    // `controller` is null on a first visit: that install is not an update.
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker)
      })
    })
    // An installed app can stay open for days: look for a new build whenever
    // it comes back to the front.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {})
    })
  }).catch(() => {})
}

/** Public pages: served by the network, never by the cached app shell. */
export const PUBLIC_PATHS = ['embed/', 'i/', 'tickets']

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

// Chrome, Edge and Samsung Internet's offer to install the app
// (`beforeinstallprompt`): `prompt()`, then `userChoice.outcome`.
let offer = null
// `installed`: during this visit (the page itself is still a browser tab).
let state = { installed: false }
const listeners = new Set()
let listening = false

const setState = (next) => {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

/**
 * Keeps the browser's install offer for the Install button, instead of the
 * browser's own banner. The offer can come as soon as the page loads, so
 * main.tsx calls this before rendering; calling it again does nothing.
 */
export function listenForInstall() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    offer = event
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    setState({ installed: true })
  })
}

export const installState = () => state
export function subscribeInstall(listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Shows the browser's install dialog. An offer can be used once: afterwards
 * the button falls back to the steps. `null` when there was no offer to use.
 */
export async function promptInstall() {
  const event = offer
  if (!event) return null
  offer = null
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    return null
  }
}
