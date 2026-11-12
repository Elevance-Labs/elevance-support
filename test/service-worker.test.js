/**
 * The generated service worker's notifications: what a push shows, the icon
 * badge, and where a tap goes — always a page of this app, never a public page
 * or anywhere else, and through an open window rather than a new one.
 *
 * The worker is built by the real plugin and run against a stand-in for the
 * service worker global.
 */
import vm from 'node:vm'
import { reporter } from './setup.js'
import { pwa } from '../vite.pwa.js'

const { check, done } = reporter()

// ---------- build sw.js the way `vite build` does ----------
const plugin = pwa({
  id: 'el-support', name: 'Elevance Support', shortName: 'Support', description: 'x',
  themeColor: '#000', backgroundColor: '#fff', passthrough: ['embed/', 'i/', 'tickets'],
})
plugin.configResolved({ base: '/support/' })
const emitted = {}
plugin.generateBundle.call(
  { emitFile: (f) => { emitted[f.fileName] = f.source } },
  {}, { 'index.html': { source: '<html></html>' }, 'assets/app.js': {} })
const source = emitted['sw.js']
check('the worker is built', typeof source === 'string' && source.includes("addEventListener('push'"))
check('the status-bar badge is cached with the app', source.includes('icons/badge-96.png'))

// ---------- a stand-in service worker global ----------
const SCOPE = 'https://app.example/support/'
function boot({ windows = [], badge = true } = {}) {
  const handlers = {}
  const log = { shown: [], badges: [], opened: [], focused: [], messages: [] }
  const win = (url) => ({
    url,
    postMessage: (m) => log.messages.push({ url, m }),
    focus: async () => { log.focused.push(url) },
  })
  const nav = badge
    ? { setAppBadge: async (n) => log.badges.push(n), clearAppBadge: async () => log.badges.push(0) }
    : {}
  const self = {
    registration: {
      scope: SCOPE,
      showNotification: async (title, options) => { log.shown.push({ title, options }) },
    },
    clients: {
      matchAll: async () => windows.map(win),
      openWindow: async (url) => { log.opened.push(url) },
      claim: async () => {},
    },
    navigator: nav,
    addEventListener: (type, fn) => { handlers[type] = fn },
    skipWaiting: () => {},
  }
  vm.runInNewContext(source, { self, caches: {}, URL, Response, Request, fetch, Promise, JSON, Date, console })
  const fire = async (type, event) => {
    let pending = Promise.resolve()
    handlers[type]({ ...event, waitUntil: (p) => { pending = p } })
    await pending
  }
  return { fire, log }
}

const pushEvent = (payload) => ({
  data: typeof payload === 'string'
    ? { json: () => JSON.parse(payload), text: () => payload }
    : { json: () => payload, text: () => JSON.stringify(payload) },
})

// ---------- a push ----------
{
  const { fire, log } = boot({ windows: [`${SCOPE}board`] })
  await fire('push', pushEvent({
    id: 'n1', title: 'ACME-42 · Cannot export invoice', body: 'Grace mentioned you: “look”',
    path: 'issues?issue=issue-1&project=proj-1', tag: 'issue-1', unread: 3,
  }))
  const shown = log.shown[0]
  check('shows the notification with its title', shown?.title === 'ACME-42 · Cannot export invoice')
  check('and its body', shown?.options.body === 'Grace mentioned you: “look”')
  check('one per ticket: tagged, and a newer one still alerts',
    shown?.options.tag === 'issue-1' && shown?.options.renotify === true)
  check('the app icon, and the status-bar badge', shown?.options.icon === `${SCOPE}icons/icon-192.png`
    && shown?.options.badge === `${SCOPE}icons/badge-96.png`)
  check('remembers the page a tap opens, inside the app',
    shown?.options.data.url === `${SCOPE}issues?issue=issue-1&project=proj-1`, shown?.options.data.url)
  check('puts the unread count on the app icon', log.badges.at(-1) === 3)
  check('tells an open window, so its bell refreshes',
    log.messages.some((x) => x.m.type === 'push' && x.m.id === 'n1'))
}
{
  const { fire, log } = boot({ badge: false })
  await fire('push', pushEvent({ title: 'x', unread: 0 }))
  check('no badge API: still shows the notification', log.shown.length === 1)
}
{
  const { fire, log } = boot()
  await fire('push', pushEvent({ title: 'x', unread: 0, path: 'profile' }))
  check('zero unread clears the badge', log.badges.at(-1) === 0)
}
{
  const { fire, log } = boot()
  await fire('push', pushEvent('not json at all'))
  check('a payload it cannot read still shows something (never a silent push)',
    log.shown[0]?.title === 'Elevance Support' && log.shown[0]?.options.body === 'not json at all')
}
for (const [path, why] of [
  ['https://evil.example/phish', 'another site'],
  ['../other-app/', 'a sibling app on the same origin'],
  ['i/ACME/42', 'a public share page'],
  ['tickets?company=wupi', 'the public company page'],
]) {
  const { fire, log } = boot()
  await fire('push', pushEvent({ title: 'x', path }))
  check(`a tap never leads to ${why}`, log.shown[0]?.options.data.url === SCOPE, log.shown[0]?.options.data.url)
}

// ---------- a tap ----------
const tap = (url) => ({
  notification: { data: { url }, close() { this.closed = true } },
})
{
  const { fire, log } = boot({ windows: [`${SCOPE}i/ACME/42`, `${SCOPE}board`] })
  const event = tap(`${SCOPE}issues?issue=issue-1&project=proj-1`)
  await fire('notificationclick', event)
  check('closes the notification', event.notification.closed === true)
  check('focuses the window already running the app (not the public page)',
    log.focused.length === 1 && log.focused[0] === `${SCOPE}board`, JSON.stringify(log.focused))
  check('and asks it to go to the ticket, without a reload', log.messages.some((x) =>
    x.url === `${SCOPE}board` && x.m.type === 'open' && x.m.url === `${SCOPE}issues?issue=issue-1&project=proj-1`))
  check('rather than opening another window', log.opened.length === 0)
}
{
  const { fire, log } = boot({ windows: [] })
  await fire('notificationclick', tap(`${SCOPE}issues?issue=issue-1`))
  check('with the app closed, opens it on the ticket', log.opened[0] === `${SCOPE}issues?issue=issue-1`)
}
{
  const { fire, log } = boot({ windows: [] })
  await fire('notificationclick', tap('https://evil.example/'))
  check('a tampered target opens the app, not the target', log.opened[0] === SCOPE)
}

done()
