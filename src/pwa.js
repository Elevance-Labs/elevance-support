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
