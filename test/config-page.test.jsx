import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/config')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { AuthContext } = await import('../src/context/AuthContext')
const Configuration = (await import('../src/pages/Configuration')).default

const { check, done } = reporter()
const admin = { id: 'a', role: 'admin', is_active: true }

const el = dom.window.document.createElement('div')
dom.window.document.body.appendChild(el)
const root = createRoot(el)
const render = (profile) => act(async () => {
  root.render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/config']}>
      <AuthContext.Provider value={{ session: {}, profile, loading: false }}>
        <ConfigProvider withUsers={false}><Configuration /></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
await render(admin)
await act(async () => { await new Promise((r) => setTimeout(r, 30)) })

const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
check('renders without crashing', el.textContent.includes('Configuration'))
check('has 9 tabs', tabs.length === 9, `got ${tabs.length}: ${tabs.join(', ')}`)
for (const t of ['Types', 'Products', 'Areas', 'Priorities', 'Severities', 'Statuses',
  'Labels', 'Sources', 'Templates'])
  check(`tab "${t}"`, tabs.includes(t), tabs.join(', '))

// default tab = Type, seeded with Bug + Question from the mock
const rowText = () => [...el.querySelectorAll('tbody tr')].map((r) => r.textContent)
check('lists items for active tab', rowText().some((r) => r.includes('Bug')), rowText().join(' | '))
check('has Add button', el.textContent.includes('Add Type'), el.textContent.slice(0, 200))
check('singular button label, not "Add Types"', !el.textContent.includes('Add Types'))
check('each row has edit + delete', el.querySelectorAll('tbody tr button').length >= 2)

// switching tabs swaps the list
const productTab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Products')
await act(async () => {
  productTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
check('switching to Product shows its items',
  rowText().some((r) => r.includes('Mobile App')), rowText().join(' | '))
check('switching away hides Type items',
  !rowText().some((r) => r.includes('Bug')), rowText().join(' | '))

// Add opens a modal
const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Add'))
await act(async () => {
  addBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
const dialog = dom.window.document.querySelector('[role="dialog"]')
check('Add opens a modal', Boolean(dialog))
check('modal title uses singular', dialog?.textContent.startsWith('Add Product'),
  dialog?.textContent.slice(0, 40))
// statuses are coloured by type, so they no longer carry their own colour
{
  const statusTab = [...D.querySelectorAll('[role="tab"]')]
    .find((t) => t.textContent.trim() === 'Statuses')
  await act(async () => {
    statusTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  const heads = [...el.querySelectorAll('thead th')].map((h) => h.textContent.trim())
  check('Statuses tab has a Status type column', heads.includes('Status type'), heads.join(', '))
  check('Statuses tab has NO Colour column', !heads.includes('Colour'), heads.join(', '))
  check('Statuses tab lists a Paused status',
    [...el.querySelectorAll('tbody tr')].some((r) => r.textContent.includes('Paused')),
    [...el.querySelectorAll('tbody tr')].map((r) => r.textContent).join(' | '))
  check('Statuses tab has a Description column', heads.includes('Description'), heads.join(', '))
  check('a status shows the description customers read',
    [...el.querySelectorAll('tbody tr')].some((r) => r.textContent.includes('deciding on next steps')),
    [...el.querySelectorAll('tbody tr')].map((r) => r.textContent).join(' | '))

  // A severity is a name plus the behaviour it commits the team to, and the
  // behaviour has to be visible in the list or nobody can tell two apart.
  const severityTab = [...D.querySelectorAll('[role="tab"]')]
    .find((t) => t.textContent.trim() === 'Severities')
  await act(async () => {
    severityTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  const sevHeads = [...el.querySelectorAll('thead th')].map((h) => h.textContent.trim())
  check('Severities tab has a Behaviour column', sevHeads.includes('Behaviour'), sevHeads.join(', '))
  const sevRows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent)
  check('Severities tab lists the configured severities',
    sevRows.some((r) => r.includes('Critical')), sevRows.join(' | '))
  check('each severity row shows its behaviour, not just its name',
    sevRows.some((r) => r.includes('Work starts immediately')), sevRows.join(' | '))
  // The SLA is a commitment to what the ticket costs the customer, so the
  // target is set beside the sentence that says what that costs.
  check('Severities tab has the SLA target column',
    sevHeads.includes('SLA target'), sevHeads.join(', '))
  check('a severity shows its target', sevRows.some((r) => r.includes('8h')), sevRows.join(' | '))
  check('a severity with no target says so',
    sevRows.some((r) => r.includes('No SLA')), sevRows.join(' | '))

  const typesTab = [...D.querySelectorAll('[role="tab"]')]
    .find((t) => t.textContent.trim() === 'Types')
  await act(async () => {
    typesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  const typeHeads = [...el.querySelectorAll('thead th')].map((h) => h.textContent.trim())
  check('other tabs keep their Colour column', typeHeads.includes('Colour'), typeHeads.join(', '))
  // A type says what kind of request it is, and commits to nothing on its own.
  check('Types tab no longer carries an SLA target',
    !typeHeads.includes('SLA target'), typeHeads.join(', '))
}

check('modal has Name field',
  dialog && [...dialog.querySelectorAll('.MuiFormLabel-root')].some((l) => l.textContent.includes('Name')),
  dialog ? [...dialog.querySelectorAll('.MuiFormLabel-root')].map(l=>l.textContent).join(', ') : 'no dialog')

// ============================================================
// A manager: labels and templates, and nothing that drives a ticket's rules
// ============================================================
await act(async () => { root.unmount() })
D.body.innerHTML = ''
D.body.appendChild(el)
const managerRoot = createRoot(el)
await act(async () => {
  managerRoot.render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/config']}>
      <AuthContext.Provider value={{ session: {}, profile: { id: 'm', role: 'manager', is_active: true }, loading: false }}>
        <ConfigProvider withUsers={false}><Configuration /></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
{
  const managerTabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
  check('a manager sees only Labels and Templates', managerTabs.join() === 'Labels,Templates',
    managerTabs.join(', '))
  check('and opens on Labels, with an Add button', el.textContent.includes('Add Label'),
    el.textContent.slice(0, 200))
  check('and is told who manages the rest', el.textContent.includes('managed by an admin'))
}

done()
