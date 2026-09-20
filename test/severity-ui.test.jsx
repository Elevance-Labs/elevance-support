import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const React = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const IssueDetail = (await import('../src/components/IssueDetail')).default
const { FIXTURES, captured } = await import('./mockSupabase.js')

const { check, done } = reporter()
const D = dom.window.document
const ADMIN = { id: 'user-1', role: 'admin', full_name: 'Ada Lovelace' }

async function render(profile, issueOverrides = {}) {
  Object.assign(FIXTURES.issue, issueOverrides)
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  const Stub = ({ children }) =>
    React.createElement(AuthContext.Provider,
      { value: { session: {}, profile, loading: false, signIn: () => {}, signOut: () => {} } },
      children)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter><Stub>
        <ConfigProvider><ProjectProvider>
          <IssueDetail issueId="issue-1" open onClose={() => {}} onSaved={() => {}} />
        </ProjectProvider></ConfigProvider>
      </Stub></MemoryRouter></ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
}

const body = () => D.body.textContent

/** The closed field of a labelled MUI select. */
const fieldFor = (label) => {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  return lab?.closest('.MuiFormControl-root')
}

/** Open a labelled select and return the option rows it listed. */
async function openOptions(label) {
  const combo = fieldFor(label)?.querySelector('[role="combobox"]')
  await act(async () => {
    combo?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    combo?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  return [...D.querySelectorAll('[role="option"]')].map((o) => o.textContent)
}

async function closeMenu() {
  const backdrop = D.querySelector('.MuiBackdrop-root, [role="presentation"]')
  await act(async () => {
    backdrop?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
}

// ---------------- a triaged ticket ----------------
await render(ADMIN, { severity: 'Critical', status: 'In Progress' })

check('severity sits in the ticket controls', Boolean(fieldFor('Severity')))
check('the assigned severity reads by name',
  fieldFor('Severity')?.textContent.includes('Critical'),
  fieldFor('Severity')?.textContent ?? 'no field')
// The behaviour is a whole sentence; it belongs where the choice is made, not
// in a field the reader is scanning past.
check('the closed field does NOT carry the behaviour',
  !fieldFor('Severity')?.textContent.includes('Work starts immediately'),
  fieldFor('Severity')?.textContent ?? 'no field')

const options = await openOptions('Severity')
check('the dropdown lists the configured severities',
  options.some((o) => o.includes('Critical')) && options.some((o) => o.includes('Moderate')),
  options.join(' | '))
check('each option shows its behaviour beside the name',
  options.some((o) => o.includes('Critical') && o.includes('Work starts immediately')),
  options.join(' | '))
check('an inactive severity is not offered',
  !options.some((o) => o.includes('Shelved')), options.join(' | '))
check('the ticket can be untriaged again',
  options.some((o) => o.includes('Not triaged')), options.join(' | '))
await closeMenu()

// Severity travels with the rest of the ticket when it is saved.
captured.updates.length = 0
await act(async () => {
  ;[...D.querySelectorAll('button')]
    .find((b) => b.textContent.trim().startsWith('Save changes'))
    ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 40))
})
const saved = captured.updates.find((u) => u.table === 'issues')?.row ?? {}
check('saving sends the severity', saved.severity === 'Critical', JSON.stringify(saved.severity))

// ---------------- an untriaged ticket ----------------
await render(ADMIN, { severity: null, status: 'New' })

check('an untriaged ticket says so', body().includes('Not triaged'), 'no "Not triaged" anywhere')
check('the severity field explains what it is blocking',
  body().includes('Needed before this ticket can be started or paused.'))
check('the status field says what is missing',
  body().includes('Assign a severity to start or pause this ticket'))

const statusOptions = await openOptions('Status')
check('no In Progress status is offered while untriaged',
  !statusOptions.some((o) => o.includes('Triaged') || o.includes('In Progress')),
  statusOptions.join(' | '))
check('no Paused status is offered while untriaged',
  !statusOptions.some((o) => o.includes('On Hold')), statusOptions.join(' | '))
check('an untriaged ticket can still be closed',
  statusOptions.some((o) => o.includes('Done')), statusOptions.join(' | '))
await closeMenu()

// ---------------- and once it is triaged ----------------
await render(ADMIN, { severity: 'Moderate', status: 'New' })
const unlocked = await openOptions('Status')
check('assigning a severity unlocks In Progress',
  unlocked.some((o) => o.includes('In Progress')), unlocked.join(' | '))
check('assigning a severity unlocks Paused',
  unlocked.some((o) => o.includes('On Hold')), unlocked.join(' | '))
await closeMenu()

// ---------------- a member is internal too ----------------
// Severity is what unlocks starting work, so the people who start work must be
// able to set it — the boundary is internal vs. the public form, not role.
await render({ id: 'user-2', role: 'member', full_name: '' }, { severity: 'Critical', status: 'In Progress' })
check('a member may change the severity',
  fieldFor('Severity')?.querySelector('[role="combobox"]')?.getAttribute('aria-disabled') !== 'true',
  fieldFor('Severity')?.querySelector('[role="combobox"]')?.outerHTML?.slice(0, 120) ?? 'no combobox')

done()
