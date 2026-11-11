/**
 * The shell: the header and navigation every Elevance app wears, so that
 * switching between them does not rearrange the screen — and the navigation
 * folding away to a rail of icons.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Route, Routes } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const AppLayout = (await import('../src/components/AppLayout')).default

const { check, done } = reporter()
const D = dom.window.document
const profile = { id: 'user-1', full_name: 'Ada Lovelace', email: 'ada@co.com', role: 'admin' }
const KEY = 'elevance.nav-collapsed'

async function render() {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
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
  await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
  return el
}
const click = async (node) => {
  await act(async () => {
    node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
}
const navLabels = () =>
  [...D.querySelectorAll('.MuiDrawer-root .MuiListItemText-primary')].map((n) => n.textContent)

localStorage.removeItem(KEY)
await render()

// ---------------- the same shell as the other apps ----------------
check('the look is the shared one: indigo, Roboto, bold page titles',
  theme.palette.primary.main === '#3f51b5' && theme.typography.fontFamily.startsWith('Roboto')
    && theme.typography.h5.fontWeight === 600,
  `${theme.palette.primary.main} ${theme.typography.fontFamily} ${theme.typography.h5.fontWeight}`)

const toolbar = [...(D.querySelector('header .MuiToolbar-root')?.children ?? [])]
const order = (sel) => toolbar.findIndex((el) => el.matches(sel) || el.querySelector(sel) !== null)
check('the header opens with the app switcher, then the logo',
  order('[aria-label="Switch app"]') === 0 && order('.MuiAvatar-rounded') === 1,
  toolbar.map((el) => el.getAttribute('aria-label') ?? el.className.slice(0, 24)).join(' | '))

const account = D.querySelector('[aria-label="Account menu"]')
check('the account button is the avatar with the name and role beside it',
  Boolean(account?.querySelector('.MuiAvatar-root')) && account.textContent.includes('Ada Lovelace')
    && account.textContent.includes('Admin'), account?.textContent)
await click(account)
const menu = D.querySelector('[role="menu"]')?.closest('.MuiPaper-root')
check('its menu opens with who you are: name, email, role',
  menu?.textContent.includes('Ada Lovelace') && menu.textContent.includes('ada@co.com')
    && menu.textContent.includes('Admin'), menu?.textContent)
check('then Profile and Sign out',
  [...D.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim()).join() === 'Profile,Sign out',
  [...D.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim()).join())
await act(async () => {
  D.activeElement?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 40))
})

const selected = D.querySelector('.MuiDrawer-root .Mui-selected')
check('the current page is marked in the navigation', selected?.getAttribute('aria-label') === 'Issues',
  selected?.outerHTML.slice(0, 120))
check('with a tint, not a solid fill', !selected?.classList.contains('active'))

// ---------------- collapsing the navigation ----------------
const foot = D.querySelector('.MuiDrawer-root [aria-label="Collapse navigation"]')
check('the collapse toggle sits at the foot of the navigation, after every page',
  Boolean(foot) && [...D.querySelectorAll('.MuiDrawer-root a[aria-label]')].every((a) => a.compareDocumentPosition(foot) & 4))
const before = navLabels()
check('expanded, every page is named', before.includes('Issues') && before.includes('Configuration'), before.join())
await click(D.querySelector('[aria-label="Collapse navigation"]'))
check('collapsing folds the navigation to icons', navLabels().length === 0, navLabels().join())
check('every page is still there, named for a screen reader and a tooltip',
  [...D.querySelectorAll('.MuiDrawer-root a[aria-label]')].map((a) => a.getAttribute('aria-label')).join() === before.join())
check('the toggle now expands', Boolean(D.querySelector('[aria-label="Expand navigation"]')))
check('the choice is remembered, under the key the apps share', localStorage.getItem(KEY) === '1')

await render()
check('a fresh load stays collapsed',
  navLabels().length === 0 && Boolean(D.querySelector('[aria-label="Expand navigation"]')))
await click(D.querySelector('[aria-label="Expand navigation"]'))
check('expanding brings the labels back', navLabels().join() === before.join(), navLabels().join())
check('and that is remembered too', localStorage.getItem(KEY) === '0')

done()
