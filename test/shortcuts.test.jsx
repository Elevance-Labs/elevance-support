/**
 * The header's keyboard shortcuts, the same two the other Elevance apps use:
 * Cmd/Ctrl+S opens search, Cmd/Ctrl+K opens Create issue. Search finds a
 * ticket by reference, number or title across every project you can see, and
 * Enter opens it on the Issues page with its project selected.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Route, Routes, useLocation } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const { isShortcut, ticketPath } = await import('../src/lib/search')
const AppLayout = (await import('../src/components/AppLayout')).default

const { check, done } = reporter()
const profile = { id: 'user-1', full_name: 'Ada Lovelace', email: 'ada@co.com', role: 'admin' }
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

// ---- the rule ----
const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })
check('Cmd or Ctrl with the letter is a shortcut',
  isShortcut(key('s', { metaKey: true }), 's') && isShortcut(key('K', { ctrlKey: true }), 'k'))
check('the letter alone, or with Shift or Alt, is not',
  !isShortcut(key('s'), 's') && !isShortcut(key('s', { metaKey: true, shiftKey: true }), 's')
  && !isShortcut(key('k', { ctrlKey: true, altKey: true }), 'k'))
check('a ticket opens on Issues with its project',
  ticketPath({ id: 'issue-1', project_id: 'proj-1' }) === '/issues?issue=issue-1&project=proj-1')

// ---- the shell ----
function Where() {
  const { pathname, search } = useLocation()
  return <div data-where>{pathname + search}</div>
}

const el = D.createElement('div')
D.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthContext.Provider value={{ session: {}, profile, loading: false, signIn() {}, signOut() {} }}>
          <ConfigProvider><ProjectProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="*" element={<Where />} />
              </Route>
            </Routes>
          </ProjectProvider></ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>)
})
await wait(60)

const press = async (k, mods = { ctrlKey: true }, target = dom.window) => {
  const e = new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })
  await act(async () => { target.dispatchEvent(e) })
  await wait(30)
  return e
}
const searchBox = () => D.querySelector('input[aria-label="Search tickets"]')
const creating = () => [...D.querySelectorAll('.MuiDialog-root h2, .MuiDialog-root h6')]
  .some((n) => n.textContent.includes('Create issue'))
const results = () => [...D.querySelectorAll('[data-result]')].map((n) => n.getAttribute('data-result'))
const where = () => D.querySelector('[data-where]')?.textContent
const type = (value) => act(async () => {
  const input = searchBox()
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})

check('the header offers search', Boolean(D.querySelector('header [aria-label="Search"]')))
check('and says which keys do what',
  D.querySelector('header [aria-label="Search"]')?.getAttribute('aria-keyshortcuts') === 'Meta+S Control+S'
  && Boolean(D.querySelector('header [aria-keyshortcuts="Meta+K Control+K"]')))

let e = await press('k')
check('Ctrl+K opens the Create issue form', creating())
check('and the browser does not act on it', e.defaultPrevented)

e = await press('s', { metaKey: true })
check('Cmd+S opens search', Boolean(searchBox()))
check('instead of saving the page', e.defaultPrevented)
await wait(400) // Create's closing transition
check('and closes Create', !creating())

await type('ACME-42')
await wait(250)
check('a reference finds that ticket', JSON.stringify(results()) === '["ACME-42"]', results().join())
check('with its title', D.body.textContent.includes('Cannot export invoice'))

await type('invoice')
await wait(250)
check('words find titles across every project you can see',
  results().includes('ACME-42') && results().includes('BILL-1'), results().join())

await type('#1')
await wait(250)
check('a bare number finds that number in any project', JSON.stringify(results()) === '["BILL-1"]', results().join())

await press('Enter', {}, searchBox())
check('Enter opens it on Issues with its project selected', where() === '/issues?issue=issue-2&project=proj-2', where())
await wait(400) // search's closing transition
check('and closes search', !searchBox())

// Something focused that already handled the key (the editor's Cmd+K adds a
// link) keeps it.
const handled = new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
handled.preventDefault()
await act(async () => { dom.window.dispatchEvent(handled) })
await wait(30)
check('a key already handled is left alone', !creating())

done()
