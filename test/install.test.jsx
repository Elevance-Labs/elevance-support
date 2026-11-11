/**
 * Installing the app: telling the device and browser apart, the steps shown
 * for each, and the Install button — beside Collapse on a desktop, leading
 * the navigation on a phone (until dismissed), gone once installed.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

// Media queries, which this jsdom lacks: a screen width and whether the page
// is a browser tab or the installed app. Read when the layout mounts.
const screen = { width: 1280, displayMode: 'browser' }
dom.window.matchMedia = (query) => {
  const min = /min-width:\s*([\d.]+)px/.exec(query)
  const max = /max-width:\s*([\d.]+)px/.exec(query)
  const mode = /display-mode:\s*([\w-]+)/.exec(query)
  const matches = mode
    ? mode[1] === screen.displayMode
    : (!min || screen.width >= Number(min[1])) && (!max || screen.width <= Number(max[1]))
  return {
    matches, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  }
}
global.matchMedia = dom.window.matchMedia

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Route, Routes } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const AppLayout = (await import('../src/components/AppLayout')).default
const { detectDevice, installGuide, installLabel, isStandalone } = await import('../src/lib/install')

const { check, done } = reporter()
const D = dom.window.document
const profile = { id: 'user-1', full_name: 'Ada Lovelace', email: 'ada@co.com', role: 'admin' }

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneGmail: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
}

// ---------------- telling devices apart ----------------
const d = (ua, touch = 0) => detectDevice(ua, touch)
check('an iPhone in Safari', JSON.stringify(d(UA.iphoneSafari)) === '{"os":"ios","browser":"safari","mobile":true}')
check('an iPhone in Chrome', d(UA.iphoneChrome).browser === 'chrome')
check('a link opened inside another iPhone app', d(UA.iphoneGmail).browser === 'in-app')
check('an iPad says Mac, but has a touch screen', d(UA.ipad, 5).os === 'ios' && d(UA.ipad, 0).os === 'mac')
check('Samsung Internet is not Chrome', d(UA.androidSamsung).browser === 'samsung')
check('Edge on Windows is not Chrome', d(UA.winEdge).os === 'windows' && d(UA.winEdge).browser === 'edge')
check('a browser tab is not the app', !isStandalone((q) => q === '(display-mode: browser)'))
check('an app window is', isStandalone((q) => q === '(display-mode: standalone)'))
check('nor is a home-screen app on an older iPhone', isStandalone(() => false, true))

const guide = (ua) => installGuide(detectDevice(ua), 'Elevance Support')
check('iPhone Safari: the share sheet, then Add to Home Screen',
  guide(UA.iphoneSafari).steps.some((s) => s.includes('Add to Home Screen')))
check('an iPhone says Add to Home Screen', installLabel(detectDevice(UA.iphoneSafari)) === 'Add to Home Screen')
check('Safari on a Mac: Add to Dock', guide(UA.macSafari).steps.some((s) => s.includes('Add to Dock')))
check('Android Chrome: the ⋮ menu', guide(UA.androidChrome).steps[0].includes('⋮'))
check('Firefox cannot, and says where to go instead',
  guide(UA.winFirefox).steps.length === 0 && guide(UA.winFirefox).note.includes('Chrome or Edge'))

// ---------------- the page ----------------
const setUserAgent = (ua, touch = 0) => {
  Object.defineProperty(dom.window.navigator, 'userAgent', { get: () => ua, configurable: true })
  Object.defineProperty(dom.window.navigator, 'maxTouchPoints', { get: () => touch, configurable: true })
}
const wait = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

let root = null
async function render() {
  await act(async () => root?.unmount())
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  root = createRoot(el)
  await act(async () => {
    root.render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/issues']}>
          <AuthContext.Provider value={{
            session: {}, profile, loading: false, signIn: () => {}, signOut: () => {},
          }}>
            <ConfigProvider><ProjectProvider>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/issues" element={<div>the page</div>} />
                </Route>
              </Routes>
            </ProjectProvider></ConfigProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await wait(60)
}
const click = async (node) => {
  await act(async () => {
    node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
}
const dialog = () => [...D.querySelectorAll('[role="dialog"]')].at(-1) ?? null
const byText = (text, root = D) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const closeDialog = async () => {
  await click(byText('Close', dialog()))
  await wait(400)
}
const installButton = () => D.querySelector('.MuiDrawer-root [aria-label="Install app"]')
const collapseButton = () => D.querySelector('.MuiDrawer-root [aria-label="Collapse navigation"]')
const banner = () => D.querySelector('[aria-label="Install the app"]')

setUserAgent(UA.macChrome)
localStorage.clear()
await render()

const install = installButton()
check('desktop: Install sits in the foot of the navigation', Boolean(install))
check('in one row with Collapse, Collapse first',
  Boolean(install) && install.parentElement === collapseButton()?.parentElement
    && (collapseButton().compareDocumentPosition(install) & 4) !== 0)
check('no offer at the top of a desktop navigation', banner() === null)

await click(install)
check('without the browser\'s offer it shows the steps', dialog()?.textContent.includes('Install page as app') === true,
  dialog()?.textContent)
await closeDialog()

let prompted = 0
const offer = Object.assign(new dom.window.Event('beforeinstallprompt', { cancelable: true }), {
  prompt: async () => { prompted++ },
  userChoice: Promise.resolve({ outcome: 'dismissed' }),
})
dom.window.dispatchEvent(offer)
check('the browser\'s own banner is held back', offer.defaultPrevented)
await click(installButton())
check('with an offer, Install opens the browser\'s dialog', prompted === 1)
check('turned down there, no steps follow', dialog() === null)
await click(installButton())
check('an offer is used once; then it is the steps again', prompted === 1 && dialog() !== null)
await closeDialog()

localStorage.removeItem('elevance.nav-collapsed')
await click(collapseButton())
const expand = D.querySelector('.MuiDrawer-root [aria-label="Expand navigation"]')
check('collapsed, Install is an icon above Expand',
  Boolean(installButton()) && Boolean(expand) && (installButton().compareDocumentPosition(expand) & 4) !== 0
    && !installButton().textContent.trim())
await click(expand)

screen.displayMode = 'standalone'
await render()
check('running as the app, there is nothing to install', installButton() === null && collapseButton() !== null)
screen.displayMode = 'browser'

// ---------------- a phone ----------------
screen.width = 390
setUserAgent(UA.iphoneSafari)
localStorage.clear()
await render()
check('a phone has no navigation foot', collapseButton() === null)
await click(D.querySelector('[aria-label="Open navigation"]'))
const offerBox = banner()
const firstPage = D.querySelector('.MuiDrawer-root a[aria-label]')
check('opened, the navigation leads with the offer',
  Boolean(offerBox) && Boolean(firstPage) && (offerBox.compareDocumentPosition(firstPage) & 4) !== 0)
check('in iPhone words', offerBox?.textContent.includes('home screen') === true && Boolean(byText('Add to Home Screen', offerBox)))
await click(byText('Add to Home Screen', offerBox))
check('an iPhone cannot be asked: it shows the steps', dialog()?.textContent.includes('Open as Web App') === true)
await closeDialog()

await click(banner()?.querySelector('[aria-label="Dismiss"]'))
check('dismissed, it goes', banner() === null)
check('and is remembered in this browser', localStorage.getItem('el-support:install-dismissed') === '1')
await render()
await click(D.querySelector('[aria-label="Open navigation"]'))
check('a fresh load does not bring it back', banner() === null && Boolean(D.querySelector('.MuiDrawer-root a[aria-label]')))

localStorage.clear()
screen.displayMode = 'standalone'
await render()
await click(D.querySelector('[aria-label="Open navigation"]'))
check('a phone running the app is not offered it', banner() === null)
screen.displayMode = 'browser'
screen.width = 1280

// ---------------- installed from the tab ----------------
setUserAgent(UA.macChrome)
await render()
check('a desktop tab offers it', Boolean(installButton()))
await act(async () => { dom.window.dispatchEvent(new dom.window.Event('appinstalled')) })
await wait()
check('once installed, the button goes', installButton() === null)

done()
