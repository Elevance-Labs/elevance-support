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

const ADMIN  = { id: 'user-1', role: 'admin',   full_name: 'Ada Lovelace' }
const MEMBER = { id: 'user-2', role: 'member',  full_name: '', email: 'grace.hopper@co.com' }
const MANAGER = { id: 'user-2', role: 'manager', full_name: '', email: 'grace.hopper@co.com' }

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

const fieldFor = (label) => [...D.querySelectorAll('.MuiFormLabel-root')]
  .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  ?.closest('.MuiFormControl-root')

const chipsIn = (label) =>
  [...(fieldFor(label)?.querySelectorAll('.MuiChip-root') ?? [])].map((c) => c.textContent)

async function openAssignees() {
  const opener = fieldFor('Assignees')?.querySelector('.MuiAutocomplete-popupIndicator')
  await act(async () => {
    opener?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  return [...D.querySelectorAll('[role="option"]')]
}

async function closeMenu() {
  await act(async () => {
    D.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
}

/** Open a labelled select (Status is still one) and read its option rows. */
async function statusOptions() {
  const combo = fieldFor('Status')?.querySelector('[role="combobox"]')
  await act(async () => {
    combo?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    combo?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  const opts = [...D.querySelectorAll('[role="option"]')].map((o) => o.textContent)
  await closeMenu()
  return opts
}

// ---------------- one person on a ticket ----------------
await render(ADMIN, { assignee_ids: ['user-1'], severity: 'Critical', status: 'In Progress' })

check('the field is plural — a ticket can carry two', Boolean(fieldFor('Assignees')))
check('the person on it is shown as a chip',
  chipsIn('Assignees').some((t) => t.includes('Ada Lovelace')), chipsIn('Assignees').join(' | '))
check('one seat is still free', body().includes('One more may be added'))

let options = await openAssignees()
check('the picker offers the roster', options.length >= 2, String(options.length))
check('only active accounts are offered',
  !options.some((o) => o.textContent.includes('Shelved')), options.map((o) => o.textContent).join(' | '))

// ---- one per department ----
// Ada is Engineering. Grace is Quality and may join her; Kay is the second
// engineer and may not.
const optionFor = (opts, name) => opts.find((o) => o.textContent.includes(name))
check('the picker names each person\'s department',
  optionFor(options, 'Grace Hopper')?.textContent.includes('Quality'),
  optionFor(options, 'Grace Hopper')?.textContent ?? '(no option)')
check('somebody from another department may join',
  optionFor(options, 'Grace Hopper')?.getAttribute('aria-disabled') !== 'true',
  optionFor(options, 'Grace Hopper')?.getAttribute('aria-disabled') ?? 'null')
check('a second person from the same department may not',
  optionFor(options, 'Kay Antonelli')?.getAttribute('aria-disabled') === 'true',
  optionFor(options, 'Kay Antonelli')?.getAttribute('aria-disabled') ?? 'null')
check('and the person already on it stays clickable, so they can be removed',
  optionFor(options, 'Ada Lovelace')?.getAttribute('aria-disabled') !== 'true',
  optionFor(options, 'Ada Lovelace')?.getAttribute('aria-disabled') ?? 'null')
check('the field says the free seat is for another department',
  body().includes('One more may be added, from another department'))
await closeMenu()

// An unassigned ticket closes nobody off — the rule only has something to say
// about a second name.
await render(ADMIN, { assignee_ids: [], severity: 'Critical', status: 'New' })
options = await openAssignees()
check('with nobody on it, every department is still open',
  options.every((o) => o.getAttribute('aria-disabled') !== 'true'),
  options.map((o) => `${o.textContent}:${o.getAttribute('aria-disabled')}`).join(' | '))
await closeMenu()

// A pair written before somebody moved department is grandfathered by the
// database, so the field has to say so rather than look fine and fail on save.
await render(ADMIN, { assignee_ids: ['user-1', 'user-3'], severity: 'Critical', status: 'In Progress' })
check('a pair that now shares a department is called out',
  body().includes('Both are in Engineering'),
  body().match(/.{0,40}Both are in.{0,60}/)?.[0] ?? '(no warning)')

// ---------------- two people, and no room for a third ----------------
await render(ADMIN, { assignee_ids: ['user-1', 'user-2'], severity: 'Critical', status: 'In Progress' })

check('both people are shown', (() => {
  const t = chipsIn('Assignees').join(' ')
  return t.includes('Ada Lovelace') && t.includes('Grace Hopper')
})(), chipsIn('Assignees').join(' | '))
check('the field says two is the ceiling',
  body().includes('Two people is the most a ticket carries'))

options = await openAssignees()
// Anyone already on it must stay clickable, or there is no way to take them off.
const onIt = options.filter((o) => /Ada Lovelace|Grace Hopper/.test(o.textContent))
check('the people already on it stay selectable, so they can be removed',
  onIt.length === 2 && onIt.every((o) => o.getAttribute('aria-disabled') !== 'true'),
  onIt.map((o) => `${o.textContent}:${o.getAttribute('aria-disabled')}`).join(' | '))
check('and nobody else can be added',
  options.filter((o) => !/Ada Lovelace|Grace Hopper/.test(o.textContent))
    .every((o) => o.getAttribute('aria-disabled') === 'true'))
await closeMenu()

// The chips carry the department, so a pair reads as two departments rather
// than as two names you have to look up.
check('each chip names the department beside the person', (() => {
  const t = chipsIn('Assignees').join(' | ')
  return t.includes('Ada Lovelace · Engineering') && t.includes('Grace Hopper · Quality')
})(), chipsIn('Assignees').join(' | '))

// ---------------- nobody on it: the gate ----------------
await render(ADMIN, { assignee_ids: [], severity: 'Critical', status: 'New' })

// The placeholder is an attribute, not page text: an empty picker has to read
// as "Unassigned" rather than as an empty box.
check('an unassigned ticket says so',
  fieldFor('Assignees')?.querySelector('input')?.getAttribute('placeholder') === 'Unassigned',
  fieldFor('Assignees')?.querySelector('input')?.getAttribute('placeholder') ?? '(none)')
check('the assignee field says what it is blocking',
  body().includes('Assign someone before moving this ticket on'))
check('the status field says the same thing in its own words',
  body().includes('Assign someone before moving this ticket out of New'))

const stuck = await statusOptions()
check('an unassigned ticket is offered nowhere to go',
  stuck.length === 0, stuck.join(' | '))

// Triaged and assigned, the whole ladder opens up.
await render(ADMIN, { assignee_ids: ['user-1'], severity: 'Critical', status: 'New' })
const unlocked = await statusOptions()
check('assigning someone unlocks In Progress',
  unlocked.some((o) => o.includes('In Progress')), unlocked.join(' | '))
check('assigning someone unlocks Done',
  unlocked.some((o) => o.includes('Done')), unlocked.join(' | '))

// ---------------- who may change who is on it ----------------
const pickerInput = () => fieldFor('Assignees')?.querySelector('input')

await render(MEMBER, { assignee_ids: ['user-1'], severity: 'Critical', status: 'In Progress' })
check('a member cannot change an already-assigned ticket',
  pickerInput()?.disabled === true, String(pickerInput()?.disabled))
check('and is told why, not just left with a dead field',
  body().includes('an admin or a manager changes who is on it'))

await render(MEMBER, { assignee_ids: [], severity: 'Critical', status: 'New' })
check('a member may pick up a ticket nobody holds',
  pickerInput()?.disabled === false, String(pickerInput()?.disabled))

await render(MANAGER, { assignee_ids: ['user-1'], severity: 'Critical', status: 'In Progress' })
check('a manager may reassign an owned ticket',
  pickerInput()?.disabled === false, String(pickerInput()?.disabled))

// ---------------- what a save sends ----------------
const saveNow = async () => {
  captured.updates.length = 0
  await act(async () => {
    ;[...D.querySelectorAll('button')]
      .find((b) => b.textContent.trim().startsWith('Save changes'))
      ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  return captured.updates.find((u) => u.table === 'issues')?.row ?? {}
}

await render(ADMIN, { assignee_ids: ['user-1', 'user-2'], severity: 'Critical', status: 'In Progress' })
let saved = await saveNow()
check('saving sends the whole set, in order',
  JSON.stringify(saved.assignee_ids) === JSON.stringify(['user-1', 'user-2']),
  JSON.stringify(saved.assignee_ids))
check('the old single-assignee column is gone from the payload',
  !('assignee_id' in saved), JSON.stringify(Object.keys(saved)))

// A member saving an owned ticket must not send the field at all: sending it
// back unchanged is still an update the database would judge, and refuse.
await render(MEMBER, { assignee_ids: ['user-1'], severity: 'Critical', status: 'In Progress' })
saved = await saveNow()
check('a member\'s save leaves assignees out entirely',
  !('assignee_ids' in saved), JSON.stringify(Object.keys(saved)))
check('but still saves everything else they may change',
  saved.status === 'In Progress' && 'labels' in saved, JSON.stringify(Object.keys(saved)))

done()
