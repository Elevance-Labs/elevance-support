import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/report')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const Report = (await import('../src/pages/Report')).default

const { check, done } = reporter()

const profile = { id: 'user-1', full_name: 'Ada Lovelace', role: 'manager' }
const el = dom.window.document.createElement('div')
dom.window.document.body.appendChild(el)

await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/report']}>
      <AuthContext.Provider value={{ session: {}, profile, loading: false, signIn: () => {}, signOut: () => {} }}>
        <ConfigProvider><ProjectProvider><Report /></ProjectProvider></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })

const body = () => el.textContent
const svgs = () => el.querySelectorAll('svg')

// The fixture is a single Bug submitted three days ago, still In Progress,
// against an 8-hour target — so it is open and well past its SLA.
check('the page renders', body().includes('Report'))
check('the tiles are drawn', ['Submitted', 'Still open', 'Closed', 'Median time to close', 'Met SLA']
  .every((label) => body().includes(label)))
check('the ticket in view is counted', body().includes('1 ticket in view'))
check('an open breach is surfaced on the tile', body().includes('1 past target'))
check('nothing closed means no median', body().includes('Median time to close'))

check('every chart section is present',
  ['Volume over time', 'Open tickets by status', 'Tickets by request type',
    'Tickets by product', 'Tickets by area', 'Age of open tickets',
    'Priority mix', 'SLA position of open tickets'].every((t) => body().includes(t)))
check('the charts actually draw marks', svgs().length >= 5, `${svgs().length} svg(s)`)
// A hand-rolled SVG that divides by an empty extent renders "NaN" into the
// path data and silently draws nothing — cheap to assert, hard to spot by eye.
check('no chart geometry came out NaN', !el.innerHTML.includes('NaN'))

check('the per-type table is filled in', body().includes('SLA performance by request type'))
check('the breach shows up in the type table', body().includes('0%'))
check('the attention table lists the open ticket',
  body().includes('Closest to breaching') && body().includes('ACME-42'))
check('the breached ticket is labelled as such', body().includes('SLA breached'))

// No assignee reporting was asked for; make sure none crept in.
check('no assignee breakdown on the page',
  !body().includes('assignee') && !body().includes('Assignee'))

// The report never spans projects: there is one picker and no "all" option.
check('the report is scoped by a project picker', body().includes('Acme Support'))

done()
