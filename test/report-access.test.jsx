import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/report')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const { can } = await import('../src/lib/permissions')
const { Protected } = await import('../src/App')
const AppLayout = (await import('../src/components/AppLayout')).default

const { check, done } = reporter()

const PROFILES = {
  admin:   { id: 'u1', full_name: 'Ada Admin',    email: 'a@co.com', role: 'admin' },
  manager: { id: 'u2', full_name: 'Mo Manager',   email: 'm@co.com', role: 'manager' },
  member:  { id: 'u3', full_name: 'Mia Member',   email: 'x@co.com', role: 'member' },
}

// ---- the rule itself, for every role and for nobody at all ----
check('admin sees reports',   can.seeReports(PROFILES.admin))
check('manager sees reports', can.seeReports(PROFILES.manager))
check('member cannot see reports', !can.seeReports(PROFILES.member))
check('a signed-out visitor cannot see reports', !can.seeReports(null))
check('an unknown role cannot see reports', !can.seeReports({ role: 'guest' }))

const render = async (node) => {
  dom.window.document.body.innerHTML = ''
  const el = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(el)
  await act(async () => { createRoot(el).render(node) })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
  return el
}

const withAuth = (profile, session, children) => (
  <ThemeProvider theme={theme}>
    <AuthContext.Provider value={{ session, profile, loading: false, signIn: () => {}, signOut: () => {} }}>
      {children}
    </AuthContext.Provider>
  </ThemeProvider>
)

/**
 * The real route, wearing the real guard: land on /report and see where the
 * router actually leaves you. A rule that is right but not wired to the route
 * protects nothing.
 */
const visitReport = async (profile, session = {}) => {
  const el = await render(withAuth(profile, session,
    <MemoryRouter initialEntries={['/report']}>
      <Routes>
        <Route path="/report" element={
          <Protected require={can.seeReports}><div>REPORT PAGE</div></Protected>
        } />
        <Route path="/issues" element={<div>ISSUES PAGE</div>} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>))
  return el.textContent
}

check('admin reaches /report',   (await visitReport(PROFILES.admin)).includes('REPORT PAGE'))
check('manager reaches /report', (await visitReport(PROFILES.manager)).includes('REPORT PAGE'))

const asMember = await visitReport(PROFILES.member)
check('member is bounced off /report', !asMember.includes('REPORT PAGE'), asMember)
check('member lands back on Issues', asMember.includes('ISSUES PAGE'))

const signedOut = await visitReport(null, null)
check('a signed-out visitor is sent to Login',
  !signedOut.includes('REPORT PAGE') && signedOut.includes('LOGIN PAGE'))

// ---- and the nav never offers a door the member cannot walk through ----
const navFor = async (profile) => {
  const el = await render(withAuth(profile, {},
    <MemoryRouter initialEntries={['/issues']}>
      <ConfigProvider><ProjectProvider><AppLayout /></ProjectProvider></ConfigProvider>
    </MemoryRouter>))
  return [...el.querySelectorAll('a')].map((a) => a.textContent.trim())
}

const adminNav = await navFor(PROFILES.admin)
const managerNav = await navFor(PROFILES.manager)
const memberNav = await navFor(PROFILES.member)

check('admin nav offers Report',   adminNav.includes('Report'), adminNav.join(', '))
check('manager nav offers Report', managerNav.includes('Report'), managerNav.join(', '))
check('member nav has no Report link', !memberNav.includes('Report'), memberNav.join(', '))
check('the member still gets the pages they may use',
  memberNav.includes('Issues') && memberNav.includes('Board'), memberNav.join(', '))

// ---- Projects is admin-only, and sits between Report and Users ----
check('admin nav offers Projects', adminNav.includes('Projects'), adminNav.join(', '))
check('manager nav has no Projects link', !managerNav.includes('Projects'), managerNav.join(', '))
check('member nav has no Projects link', !memberNav.includes('Projects'), memberNav.join(', '))
check('Projects sits between Report and Users in the nav',
  adminNav.indexOf('Projects') === adminNav.indexOf('Report') + 1
  && adminNav.indexOf('Users') === adminNav.indexOf('Projects') + 1,
  adminNav.join(', '))

done()
