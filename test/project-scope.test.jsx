// The project filter: one project at a time, never none, and remembered.
//
// The mock applies `eq`, so a page that forgot to scope its read would show the
// other project's ticket here rather than quietly passing.
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider, STORAGE_KEY } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const Issues = (await import('../src/pages/Issues')).default
const Board = (await import('../src/pages/Board')).default

const { check, done } = reporter()
const D = dom.window.document
const profile = { id: 'user-1', full_name: 'Ada Lovelace', role: 'admin' }

async function render(page) {
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
            <ConfigProvider><ProjectProvider>{page}</ProjectProvider></ConfigProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
  return el
}

// The project select, by its label. MUI renders a select's value into a div,
// not an <input>, so read the combobox's text.
const projectSelect = () => [...D.querySelectorAll('.MuiInputBase-root')]
  .find((r) => r.previousSibling?.textContent?.trim()?.startsWith('Project'))

localStorage.removeItem(STORAGE_KEY)

// ---- Issues, with nothing remembered ----
let el = await render(<Issues />)
let text = () => el.textContent

check('a project is selected without being asked for',
  text().includes('Acme Support'), text().slice(0, 160))
check('the selected project’s ticket is listed',
  text().includes('Cannot export invoice'))
check('another project’s ticket is NOT listed',
  !text().includes('Invoice PDF is blank'), 'a ticket from Billing leaked in')
check('tickets are identified by the selected project’s key',
  text().includes('ACME-42'), text().slice(0, 200))

// ---- the filter is mandatory: there is no way to select nothing ----
const options = () => {
  const combo = projectSelect()?.querySelector('[role="combobox"]')
  combo?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
  return [...D.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())
}
await act(async () => { options() })
const opts = [...D.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())

check('every project is offered', opts.length === 2, opts.join(' | '))
check('there is no "All projects" option',
  !opts.some((o) => /^all/i.test(o)), opts.join(' | '))
check('there is no blank option to fall back to',
  !opts.some((o) => o === ''), JSON.stringify(opts))

// ---- switching projects swaps the data, and is remembered ----
const billing = [...D.querySelectorAll('[role="option"]')]
  .find((o) => o.textContent.includes('Billing'))
await act(async () => { billing?.click() })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })

check('switching shows the other project’s ticket',
  text().includes('Invoice PDF is blank'), text().slice(0, 200))
check('switching hides the first project’s ticket',
  !text().includes('Cannot export invoice'))
check('the same number in another project reads under its own key',
  text().includes('BILL-1'), text().slice(0, 220))
check('the choice is written to local storage',
  localStorage.getItem(STORAGE_KEY) === 'proj-2', String(localStorage.getItem(STORAGE_KEY)))

// ---- and it survives a fresh mount, on any page ----
el = await render(<Issues />)
check('a remembered project is pre-selected, not re-asked',
  text().includes('Billing') && text().includes('Invoice PDF is blank'),
  text().slice(0, 200))

el = await render(<Board />)
check('the Board reads the same remembered project',
  text().includes('Invoice PDF is blank') && !text().includes('Cannot export invoice'),
  text().slice(0, 200))
check('the Board offers the project filter too', Boolean(projectSelect()))

// A project the user can no longer see must not be resurrected by a stale entry.
localStorage.setItem(STORAGE_KEY, 'proj-gone')
el = await render(<Issues />)
check('a stale remembered project falls back rather than showing nothing',
  text().includes('Acme Support') && text().includes('Cannot export invoice'),
  text().slice(0, 200))
check('the fallback is written back, so it stops being stale',
  localStorage.getItem(STORAGE_KEY) === 'proj-1',
  String(localStorage.getItem(STORAGE_KEY)))

done()
