import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/dashboard')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const Dashboard = (await import('../src/pages/Dashboard')).default

const { check, done } = reporter()

// Ada owns the fixture's open ticket, so "My issues" is hers to see.
const profile = { id: 'user-1', full_name: 'Ada Lovelace', role: 'member' }
const el = dom.window.document.createElement('div')
dom.window.document.body.appendChild(el)

await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/dashboard']}>
      <AuthContext.Provider value={{ session: {}, profile, loading: false, signIn: () => {}, signOut: () => {} }}>
        <ConfigProvider><ProjectProvider><Dashboard /></ProjectProvider></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })

const body = () => el.textContent

// The fixture is one open Critical ticket (ACME-42, assigned to Ada, submitted
// three days ago against an 8-hour target) in Acme Support, plus one ticket in
// a second project that must never appear here.
check('the page renders', body().includes('Dashboard'))
check('the tiles are drawn',
  ['Open tickets', 'Assigned to me', 'Past 75% of SLA', 'Unassigned', 'Not triaged']
    .every((label) => body().includes(label)))
check('the open ticket is counted', body().includes('1 open ticket'))

check('my issues lists my open ticket',
  body().includes('My issues') && body().includes('ACME-42')
  && body().includes('Cannot export invoice'))
check('my issues shows the severity', body().includes('Critical'))

check('the breaching list is present', body().includes('Breaching SLA'))
check('a ticket past its target is called out', body().includes('Consumed'))

check('all three breakdowns are drawn',
  ['By status', 'By assignee', 'By severity'].every((t) => body().includes(t)))
check('a breakdown shows a share as well as a count', body().includes('· 100%'))
check('the assignee breakdown names the person', body().includes('Ada Lovelace'))
check('the charts actually draw marks', el.querySelectorAll('svg').length >= 3)
// A hand-rolled SVG that divides by an empty extent renders "NaN" into the path
// data and silently draws nothing — cheap to assert, hard to spot by eye.
check('no chart geometry came out NaN', !el.innerHTML.includes('NaN'))

// The dashboard is one project's, like every other page: a ticket in the second
// project has no business on it.
check('the dashboard is scoped by a project picker', body().includes('Acme Support'))
check('another project\'s ticket is not shown', !body().includes('Invoice PDF is blank'))

done()
