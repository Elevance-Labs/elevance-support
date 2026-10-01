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
const { FIXTURES } = await import('./mockSupabase.js')

const { check, done } = reporter()
const D = dom.window.document
const ADMIN = { id: 'user-1', role: 'admin', full_name: '' }

// The dialog asks through confirm(); the test answers for the user and counts.
let asked = 0
let answer = false
global.confirm = () => { asked++; return answer }

let closed = 0
async function render(profile, issueOverrides = {}) {
  Object.assign(FIXTURES.issue, issueOverrides)
  asked = 0; closed = 0
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
          <IssueDetail issueId="issue-1" open onClose={() => { closed++ }} onSaved={() => {}} />
        </ProjectProvider></ConfigProvider>
      </Stub></MemoryRouter></ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
}

const body = () => D.body.textContent

const fieldFor = (label) => {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  return lab?.closest('.MuiFormControl-root')
}

/** Open a labelled select and click the option whose text starts with `name`. */
async function pick(label, name) {
  const combo = fieldFor(label)?.querySelector('[role="combobox"]')
  await act(async () => {
    combo?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    combo?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await act(async () => {
    ;[...D.querySelectorAll('[role="option"]')]
      .find((o) => o.textContent.trim().startsWith(name))
      ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
}

const clickButton = async (find) => {
  await act(async () => {
    find()?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
}
const closeButton = () => D.querySelector('[data-testid="CloseIcon"]')?.closest('button')
const saveButton = () => [...D.querySelectorAll('button')]
  .find((b) => b.textContent.trim().startsWith('Save changes'))

const elapsedBox = () => [...D.querySelectorAll('.MuiPaper-root')]
  .find((el) => el.textContent.startsWith('Total time elapsed'))?.textContent ?? ''

// ---------------- an untouched ticket ----------------
await render(ADMIN, { severity: 'Critical', status: 'In Progress', assignee_ids: ['user-1'] })

check('an untouched ticket has nothing to save', saveButton()?.disabled === true)
await clickButton(closeButton)
check('and closes without a question', asked === 0 && closed === 1, `asked ${asked}, closed ${closed}`)

// ---------------- a draft is not the ticket ----------------
await render(ADMIN, { severity: 'Critical', status: 'In Progress', assignee_ids: ['user-1'] })
const slaBefore = elapsedBox()
const statusBefore = fieldFor('Status')?.textContent

// Critical carries a target and Moderate none, so the SLA box would read
// differently if it followed the field.
await pick('Severity', 'Moderate')
check('the field shows the new choice',
  fieldFor('Severity')?.textContent.includes('Moderate'), fieldFor('Severity')?.textContent ?? 'no field')
check('the SLA still reads the saved severity', elapsedBox() === slaBefore && slaBefore !== '',
  `${slaBefore} → ${elapsedBox()}`)
check('the change enables Save', saveButton()?.disabled === false)

await pick('Status', 'Done')
check('a status picked but not saved does not read as closed',
  !body().includes('this ticket cannot be reopened'), statusBefore ?? '')

// ---------------- leaving with a draft ----------------
answer = false
await clickButton(closeButton)
check('closing with unsaved changes asks first', asked === 1, `asked ${asked}`)
check('and stays open when the answer is no', closed === 0, `closed ${closed}`)

await act(async () => {
  D.querySelector('.MuiDialog-container')
    ?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 40))
})
check('Escape asks the same question', asked === 2 && closed === 0, `asked ${asked}, closed ${closed}`)

const leaving = new dom.window.Event('beforeunload', { cancelable: true })
dom.window.dispatchEvent(leaving)
check('a reload is held back too', leaving.defaultPrevented)

answer = true
await clickButton(closeButton)
check('and closes when the answer is yes', closed === 1, `closed ${closed}`)

// ---------------- once it is saved ----------------
await render(ADMIN, { severity: 'Critical', status: 'In Progress', assignee_ids: ['user-1'] })
await pick('Severity', 'Moderate')
// The mock keeps no writes, so make the row say what the save sent.
FIXTURES.issue.severity = 'Moderate'
await clickButton(saveButton)
check('a saved ticket has nothing left to save', saveButton()?.disabled === true)
asked = 0
await clickButton(closeButton)
check('and closes without a question', asked === 0 && closed === 1, `asked ${asked}, closed ${closed}`)

done()
