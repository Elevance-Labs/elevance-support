/**
 * On a phone or tablet (below `md`) the header has no room for the project
 * picker beside its buttons, so a page scoped to a project gets a bar of its
 * own under the header, the picker across its full width. Pages that are not
 * scoped get no bar; on a wide screen the picker stays in the header.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')
const D = dom.window.document

// A phone: every "max-width" query (`breakpoints.down`) matches.
let phone = true
dom.window.matchMedia = (query) => ({
  matches: phone && /max-width/.test(query), media: query,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
})
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

const { check, done } = reporter()
const profile = { id: 'user-1', full_name: 'Ada Lovelace', email: 'ada@co.com', role: 'admin' }

async function render(path) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[path]}>
          <AuthContext.Provider value={{ session: {}, profile, loading: false, signIn() {}, signOut() {} }}>
            <ConfigProvider><ProjectProvider>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/issues" element={<div>the page</div>} />
                  <Route path="/users" element={<div>the page</div>} />
                </Route>
              </Routes>
            </ProjectProvider></ConfigProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
}
const header = () => D.querySelector('header .MuiToolbar-root')
const bar = () => D.querySelector('[data-project-bar]')
// The project select, found the way project-scope.test.jsx finds it: by the
// label just before its input.
const picker = (root) => [...(root?.querySelectorAll('.MuiInputBase-root') ?? [])]
  .some((r) => r.previousSibling?.textContent?.trim()?.startsWith('Project'))

await render('/issues')
check('on a phone, a scoped page gets a bar under the header', Boolean(bar()))
check('inside the fixed header, so it stays put as the page scrolls', Boolean(bar()?.closest('header')))
check('holding the project picker', picker(bar()))
check('which takes the bar\'s full width', Boolean(bar()?.querySelector('.MuiFormControl-fullWidth')))
check('and is no longer in the header row', !picker(header()))
check('the header row keeps the bell and the account button',
  Boolean(header()?.querySelector('[aria-label^="Notifications"]')) && Boolean(header()?.querySelector('[aria-label="Account menu"]')))

await render('/users')
check('a page with no project has no bar', !bar())

phone = false
await render('/issues')
check('on a wide screen there is no bar', !bar())
check('and the picker sits in the header', picker(header()))

done()
