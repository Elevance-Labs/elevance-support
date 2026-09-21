import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/projects')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const React = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const ScheduleDialog = (await import('../src/components/ScheduleDialog')).default
const Projects = (await import('../src/pages/Projects')).default
const { PROJECTS, PROJECT_SCHEDULES, captured } = await import('./mockSupabase.js')

const { check, done } = reporter()
const D = dom.window.document

const ADMIN  = { id: 'user-1', role: 'admin',  full_name: 'Ada Lovelace' }
const MEMBER = { id: 'user-2', role: 'member', full_name: '', email: 'grace.hopper@co.com' }

async function mount(profile, node) {
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
        <ConfigProvider><ProjectProvider>{node}</ProjectProvider></ConfigProvider>
      </Stub></MemoryRouter></ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
  return el
}

const body = () => D.body.textContent
const buttonNamed = (text) => [...D.querySelectorAll('button')]
  .find((b) => b.textContent.trim() === text)
const click = async (node) => {
  await act(async () => {
    node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
}

// ---------------- reaching it from the Projects page ----------------
const page = await mount(ADMIN, <Projects />)
const scheduleButtons = [...page.querySelectorAll('button')]
  .filter((b) => b.querySelector('[data-testid="EventNoteIcon"]'))
check('every project row offers its schedule',
  scheduleButtons.length === PROJECTS.length, String(scheduleButtons.length))

await click(scheduleButtons[0])
check('the button opens the rota', body().includes('Support schedule'))
check('the rota names the project it belongs to', body().includes('Acme Support'))

// ---------------- what the rota shows ----------------
await mount(ADMIN, <ScheduleDialog project={PROJECTS[0]} open onClose={() => {}} />)

check('it explains what a schedule does',
  body().includes('assigned to the people on it'), body().slice(0, 300))
check('it warns that ranges cannot overlap', body().includes('cannot overlap'))

// Both fixture ranges are listed, as dates rather than raw column values.
check('each schedule reads as a date range',
  body().includes('05 Jan 2026 – 11 Jan 2026')
  && body().includes('12 Jan 2026 – 18 Jan 2026'),
  body().match(/\d{2} \w{3} 2026[^|]{0,40}/g)?.join(' | ') ?? '(none)')
check('a range says how long it runs, both ends counted',
  body().includes('7 days'))
check('the people on a range are named',
  body().includes('Ada Lovelace'))

// Read top to bottom: who is on now, who is next, who was on when.
check('schedules are grouped by where they sit relative to today', (() => {
  const t = body()
  const now = t.indexOf('On now')
  const next = t.indexOf('Coming up')
  const past = t.indexOf('Past')
  return now > -1 && next > now && past > next
})(), `now=${body().indexOf('On now')} next=${body().indexOf('Coming up')} past=${body().indexOf('Past')}`)
// Both fixtures are in January 2026 and this suite runs well after that, so
// every group but "Past" has to say it is empty rather than render nothing.
check('an empty group says so rather than going blank',
  body().includes('Nobody is scheduled today.'))

// ---------------- creating one ----------------
check('an admin is offered a new schedule', Boolean(buttonNamed('New schedule')))
await click(buttonNamed('New schedule'))
check('the form opens', body().includes('New schedule') && Boolean(buttonNamed('Save')))

const inputFor = (label) => [...D.querySelectorAll('.MuiFormLabel-root')]
  .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  ?.closest('.MuiFormControl-root')?.querySelector('input')

check('the form asks for both ends of a range',
  inputFor('From')?.type === 'date' && inputFor('To')?.type === 'date',
  `${inputFor('From')?.type} / ${inputFor('To')?.type}`)
check('the form asks who is on support', Boolean(inputFor('On support')))
check('it says the pair go on every ticket submitted in the range',
  body().includes('They go on every ticket submitted in this range'))
check('a schedule with nobody on it cannot be saved',
  buttonNamed('Save')?.disabled === true)

// Set a range that collides with the second fixture week.
const setDate = async (label, value) => {
  const input = inputFor(label)
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
}
await setDate('From', '2026-01-14')
await setDate('To', '2026-01-20')
check('a clash is named before the save, not after it',
  body().includes('12 Jan 2026 – 18 Jan 2026 is already covered by'),
  body().match(/.{0,80}already covered.{0,60}/)?.[0] ?? '(no warning)')
check('and the save stays shut while it clashes',
  buttonNamed('Save')?.disabled === true)

// Move it clear of every existing week and pick somebody.
await setDate('From', '2026-02-02')
await setDate('To', '2026-02-08')
check('moving it clear drops the warning', !body().includes('already covered by'))

// The picker keeps its list open after a pick (disableCloseOnSelect), so this
// only reaches for the opener when the list is actually shut.
const openRoster = async () => {
  if (!D.querySelector('[role="option"]')) {
    const opener = [...D.querySelectorAll('.MuiFormLabel-root')]
      .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === 'On support')
      ?.closest('.MuiFormControl-root')?.querySelector('.MuiAutocomplete-popupIndicator')
    await click(opener)
  }
  return [...D.querySelectorAll('[role="option"]')]
}
let options = await openRoster()
check('the roster is offered', options.length >= 2, String(options.length))
check('and names each person\'s department',
  options.find((o) => o.textContent.includes('Ada Lovelace'))?.textContent.includes('Engineering'),
  options.map((o) => o.textContent).join(' | '))
await click(options.find((o) => o.textContent.includes('Ada Lovelace')))

// A rota is where most pairs come from, so it carries the same rule a ticket
// does — one naming two engineers would mint tickets that break it.
options = await openRoster()
check('a second person from the same department is closed off on a rota too',
  options.find((o) => o.textContent.includes('Kay Antonelli'))?.getAttribute('aria-disabled') === 'true',
  options.find((o) => o.textContent.includes('Kay Antonelli'))?.getAttribute('aria-disabled') ?? 'null')
check('somebody from another department may still be added',
  options.find((o) => o.textContent.includes('Grace Hopper'))?.getAttribute('aria-disabled') !== 'true')
check('the field says the pair must span two departments',
  body().includes('from different departments'))
await click(options.find((o) => o.textContent.includes('Grace Hopper')))
check('a valid pair can be saved', buttonNamed('Save')?.disabled === false)
// Take Grace back off, so the insert below is the one-person schedule asserted for.
options = await openRoster()
await click(options.find((o) => o.textContent.includes('Grace Hopper')))

check('the range says how long it runs as it is typed', body().includes('7 days'))
check('with a range and a person, it can be saved',
  buttonNamed('Save')?.disabled === false)

captured.inserts.length = 0
await click(buttonNamed('Save'))
const inserted = captured.inserts.find((i) => i.table === 'project_schedules')?.row ?? {}
check('the schedule is filed against its project',
  inserted.project_id === PROJECTS[0].id, JSON.stringify(inserted))
check('it stores plain day keys, not instants',
  inserted.starts_on === '2026-02-02' && inserted.ends_on === '2026-02-08',
  `${inserted.starts_on} / ${inserted.ends_on}`)
check('it stores who is on as an array',
  JSON.stringify(inserted.assignee_ids) === JSON.stringify(['user-1']),
  JSON.stringify(inserted.assignee_ids))
check('it records who set it up', inserted.created_by === ADMIN.id)

// ---------------- editing an existing one ----------------
await mount(ADMIN, <ScheduleDialog project={PROJECTS[0]} open onClose={() => {}} />)
const editButtons = [...D.querySelectorAll('button')]
  .filter((b) => b.querySelector('[data-testid="EditIcon"]'))
check('every schedule can be edited',
  editButtons.length === PROJECT_SCHEDULES.length, String(editButtons.length))
await click(editButtons[0])
check('editing opens the form on that schedule', body().includes('Edit schedule'))
check('the form is filled with the range it is editing',
  inputFor('From')?.value === '2026-01-12' && inputFor('To')?.value === '2026-01-18',
  `${inputFor('From')?.value} / ${inputFor('To')?.value}`)
check('and with the people already on it', (() => {
  const t = [...D.querySelectorAll('.MuiChip-root')].map((c) => c.textContent).join(' ')
  return t.includes('Ada Lovelace') && t.includes('Grace Hopper')
})(), [...D.querySelectorAll('.MuiChip-root')].map((c) => c.textContent).join(' | '))
check('an edit does not clash with itself', !body().includes('already covered by'))

captured.updates.length = 0
await click(buttonNamed('Save'))
const updated = captured.updates.find((u) => u.table === 'project_schedules')?.row ?? {}
check('saving an edit updates rather than inserts',
  updated.starts_on === '2026-01-12', JSON.stringify(updated))

// ---------------- who may change it ----------------
await mount(MEMBER, <ScheduleDialog project={PROJECTS[0]} open onClose={() => {}} />)
check('a member still sees who is on support',
  body().includes('05 Jan 2026 – 11 Jan 2026'))
check('but is offered no way to change it',
  !buttonNamed('New schedule')
  && ![...D.querySelectorAll('button')].some((b) => b.querySelector('[data-testid="EditIcon"]')))

done()
