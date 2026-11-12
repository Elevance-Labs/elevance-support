/**
 * The notifications dropdown notices when this device does not get them, and
 * says so at the top: off (Turn on / Not now), blocked, or — for a device that
 * had them — stopped, which no "Not now" hides and which puts a dot on the
 * bell. Checked again every time the dropdown opens.
 */
import { setupDom, reporter } from './setup.js'
import { installFakePush, ENDPOINT } from './fakePush.js'
const dom = setupDom('http://localhost/issues')
const D = dom.window.document
const { browser, server, caller } = installFakePush(dom.window)
Object.defineProperty(D, 'visibilityState', { configurable: true, get: () => 'visible' })

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const NotificationsBell = (await import('../src/components/NotificationsBell')).default
const { FIXTURES } = await import('./mockSupabase.js')

const { check, done } = reporter()
const settle = (ms = 50) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

let root
async function mount(profile = FIXTURES.profiles[0]) {
  if (root) await act(async () => root.unmount())
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  root = createRoot(el)
  await act(async () => {
    root.render(
      <ThemeProvider theme={theme}><MemoryRouter>
        <AuthContext.Provider value={{ session: {}, profile, loading: false }}>
          <ConfigProvider><ProjectProvider><NotificationsBell /></ProjectProvider></ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await settle()
}
const bell = () => D.querySelector('button[aria-label^="Notifications"]')
const open = async () => {
  await act(async () => { bell().click() })
  await settle()
}
const close = async () => {
  await act(async () => {
    D.querySelector('.MuiBackdrop-root, .MuiModal-backdrop')?.click()
      ?? D.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await settle(300)
}
const prompt = () => D.querySelector('[data-push-prompt]')
const button = (text) => [...(prompt()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text)

// ---------- never turned on ----------
localStorage.clear()
await mount()
await open()
check('off on this device: the dropdown says so', prompt()?.getAttribute('data-push-prompt') === 'off',
  prompt()?.getAttribute('data-push-prompt'))
check('with Turn on and Not now', Boolean(button('Turn on')) && Boolean(button('Not now')))
check('no dot on the bell for that', !D.querySelector('.MuiBadge-dot'))
await act(async () => { button('Not now').click() })
await settle()
check('Not now hides it', !prompt())
await close()
await open()
check('and keeps it hidden next time', !prompt())
check('for a week', Number(localStorage.getItem('el-support.push-offer-snoozed-until')) > Date.now() + 6 * 86_400_000)
await close()

// ---------- turned on from the dropdown ----------
localStorage.clear()
await mount()
await open()
await act(async () => { button('Turn on').click() })
await settle()
check('Turn on asks, subscribes and registers', browser.asked === 1 && server.get(ENDPOINT) === 'user-1')
check('and the prompt goes', !prompt())
await close()

// ---------- stopped while the app was open ----------
server.delete(ENDPOINT) // removed on another device, or dropped by the push service
await open()
check('opening the dropdown checks again, and finds it stopped',
  prompt()?.getAttribute('data-push-prompt') === 'stopped', prompt()?.getAttribute('data-push-prompt'))
check('said as a warning', prompt()?.className.includes('Warning'))
check('with Turn back on, and no Not now', Boolean(button('Turn back on')) && !button('Not now'))
await close()
check('the bell wears a dot while nothing is unread', Boolean(D.querySelector('.MuiBadge-dot'))
  && bell().getAttribute('aria-label') === 'Notifications — stopped on this device', bell().getAttribute('aria-label'))

localStorage.setItem('el-support.push-offer-snoozed-until', String(Date.now() + 86_400_000))
await mount()
await open()
check('a snooze does not hide "stopped"', prompt()?.getAttribute('data-push-prompt') === 'stopped')
await act(async () => { button('Turn back on').click() })
await settle()
check('Turn back on restores it', server.get(ENDPOINT) === 'user-1' && !prompt())
await close()

// ---------- permission withdrawn in the browser ----------
browser.changePermission('denied')
await settle()
await open()
check('blocked after having them: stopped, with how to allow them',
  prompt()?.getAttribute('data-push-prompt') === 'stopped' && prompt()?.textContent.includes('padlock')
  && !button('Turn back on'))
await close()
browser.changePermission('granted')
await settle()

// ---------- someone else's device ----------
// Ada had it on in this browser; now Kay signs in on it. Her check ends Ada's
// registration, and she is offered to turn it on — not told hers "stopped".
caller.id = 'user-3'
localStorage.removeItem('el-support.push-offer-snoozed-until')
await mount(FIXTURES.profiles[2])
await open()
check('the next person ends the last one\'s registration', !server.has(ENDPOINT))
check('and is offered Turn on, not told it stopped', prompt()?.getAttribute('data-push-prompt') === 'off',
  prompt()?.getAttribute('data-push-prompt'))
await close()

// ---------- blocked from the start ----------
caller.id = 'user-1'
localStorage.clear()
browser.drop()
browser.permission = 'denied'
await mount()
await open()
check('blocked: says how to allow them, offers nothing to click',
  prompt()?.getAttribute('data-push-prompt') === 'blocked' && !button('Turn on') && Boolean(button('Not now')))

done()
