/**
 * Notifications on this device, from the Profile page: turning them on
 * (permission, then a push subscription registered to you), sending a test,
 * turning them off, your devices — and the app noticing when they have
 * stopped without anyone turning them off. Signing out takes this device off.
 */
import { setupDom, reporter } from './setup.js'
import { installFakePush, ENDPOINT } from './fakePush.js'
const dom = setupDom('http://localhost/profile')
const D = dom.window.document
const { browser, server } = installFakePush(dom.window)
// jsdom calls every page 'prerender'; this one is on screen.
Object.defineProperty(D, 'visibilityState', { configurable: true, get: () => 'visible' })

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { captured, FIXTURES } = await import('./mockSupabase.js')
const Profile = (await import('../src/pages/Profile')).default
const { forgetPushDevice } = await import('../src/components/usePushDevice')

const { check, done } = reporter()
const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const click = async (node) => {
  await act(async () => { node?.click() })
  await settle()
}
const button = (text) => [...D.querySelectorAll('button')].find((b) => b.textContent === text)
const card = () => [...D.querySelectorAll('.MuiPaper-root')].find((p) => p.textContent.startsWith('Notifications'))
const chip = () => card()?.querySelector('.MuiChip-label')?.textContent
const comeBack = () => act(async () => {
  D.dispatchEvent(new dom.window.Event('visibilitychange'))
  await new Promise((r) => setTimeout(r, 40))
})

// A device of Ada's on the server, so the list has one: this browser's row
// joins it once she turns this one on.
FIXTURES.push_subscriptions.push({ id: 'ps-here', user_id: 'user-1', endpoint: ENDPOINT,
  device: 'Chrome on Windows', created_at: new Date().toISOString(), last_used_at: null })

const el = D.createElement('div')
D.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter>
      <AuthContext.Provider value={{ session: {}, profile: FIXTURES.profiles[0], loading: false, refreshProfile() {} }}>
        <Profile />
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
await settle()

check('the Profile page has a Notifications card', Boolean(card()))
check('it says what you are told about', card()?.textContent.includes('@mentions you'))
check('this device starts off', chip() === 'Off' && Boolean(button('Turn on')))
check('nothing is asked before a click', browser.asked === 0)
check('your other devices are listed', card()?.textContent.includes('Chrome on Android'))

// ---------- on ----------
captured.rpcs.length = 0
await click(button('Turn on'))
check('asks for permission on the click', browser.asked === 1)
check('subscribes with the app\'s key, visible notifications only',
  browser.subscribedWith?.userVisibleOnly === true && browser.subscribedWith?.applicationServerKey?.length === 65)
const saved = captured.rpcs.find((r) => r.name === 'save_push_subscription' && !r.args.p_refresh_only)
check('registers the device through the function, not the table',
  saved?.args.p_endpoint === ENDPOINT && saved.args.p_p256dh === 'P'.repeat(87)
  && saved.args.p_auth === 'A'.repeat(22) && Boolean(saved.args.p_device), JSON.stringify(saved?.args))
check('then checks the server has it before saying on',
  captured.rpcs.some((r) => r.name === 'save_push_subscription' && r.args.p_refresh_only === true))
check('and now it is on', chip() === 'On' && Boolean(button('Send a test')))
check('this device is marked in the list', card()?.textContent.includes('Chrome on Windows — this device'))

// ---------- test ----------
await click(button('Send a test'))
check('a test is the database\'s send_test_notification', captured.rpcs.some((r) => r.name === 'send_test_notification'))
check('and says so', card()?.textContent.includes('Sent.'))

// ---------- stopped, without anyone turning it off ----------
server.delete(ENDPOINT) // removed from another device, or dropped as gone by push-send
captured.rpcs.length = 0
await comeBack()
check('coming back to the app checks again', captured.rpcs.some((r) => r.args?.p_refresh_only === true))
check('and the check never re-registers a removed device', !server.has(ENDPOINT)
  && !captured.rpcs.some((r) => r.name === 'save_push_subscription' && !r.args.p_refresh_only))
check('so it says stopped, not on', chip() === 'Stopped', chip())
check('in words', card()?.textContent.includes('Notifications have stopped on this device'))
await click(button('Turn back on'))
check('Turn back on registers it again', server.get(ENDPOINT) === 'user-1' && chip() === 'On')

browser.changePermission('denied')
await settle()
check('permission withdrawn in the browser: noticed at once, as blocked', chip() === 'Blocked', chip())
browser.changePermission('granted')
await settle()
check('and allowed again: on', chip() === 'On', chip())

// ---------- off, on purpose ----------
captured.deletes.length = 0
await click(button('Turn off'))
check('turning off unsubscribes the browser', browser.unsubscribed === 1)
const del = captured.deletes.find((d) => d.table === 'push_subscriptions')
check('and deletes this device\'s row, by its endpoint',
  JSON.stringify(del?.filters) === `[["eq","endpoint","${ENDPOINT}"]]`, JSON.stringify(del))
server.delete(ENDPOINT)
check('turned off on purpose is just off — not "stopped"', chip() === 'Off' && Boolean(button('Turn on')), chip())

// ---------- another device ----------
captured.deletes.length = 0
await click(D.querySelector('button[aria-label="Remove Chrome on Android"]'))
check('a listed device can be removed',
  JSON.stringify(captured.deletes.find((d) => d.table === 'push_subscriptions')?.filters) === '[["eq","id","ps-1"]]')

// ---------- signing out ----------
browser.subscribeNow()
server.set(ENDPOINT, 'user-1')
captured.deletes.length = 0
await forgetPushDevice()
check('signing out takes this device off: its row', captured.deletes.some((d) => d.table === 'push_subscriptions'))
check('and its subscription', !browser.subscribed() && browser.unsubscribed === 2)
check('and forgets it was on, so the next person is not told it "stopped"',
  localStorage.getItem('el-support.push-on') === null)

done()
