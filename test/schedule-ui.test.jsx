import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/schedule')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const React = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const ScheduleManager = (await import('../src/components/ScheduleManager')).default
const SchedulePage = (await import('../src/pages/Schedule')).default
const Projects = (await import('../src/pages/Projects')).default
const { formatRange } = await import('../src/lib/schedules.js')
const {
  PROJECTS, PROJECT_SCHEDULES, captured, dayKey, refuseWrites,
} = await import('./mockSupabase.js')

const { check, done } = reporter()
const D = dom.window.document

const ADMIN   = { id: 'user-1', role: 'admin',   full_name: 'Ada Lovelace' }
const MANAGER = { id: 'user-2', role: 'manager', full_name: '', email: 'grace.hopper@co.com' }
const MEMBER  = { id: 'user-3', role: 'member',  full_name: 'Kay Antonelli' }

const PAST = PROJECT_SCHEDULES.find((s) => s.id === 'sch-past')
const LIVE = PROJECT_SCHEDULES.find((s) => s.id === 'sch-live')
const NEXT = PROJECT_SCHEDULES.find((s) => s.id === 'sch-next')

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

const rota = (profile) => mount(profile, <ScheduleManager project={PROJECTS[0]} />)
const body = () => D.body.textContent
const buttonNamed = (text) => [...D.querySelectorAll('button')]
  .find((b) => b.textContent.trim() === text)
const click = async (node) => {
  await act(async () => {
    node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
}
const inputFor = (label) => [...D.querySelectorAll('.MuiFormLabel-root')]
  .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  ?.closest('.MuiFormControl-root')?.querySelector('input')
/** The row a schedule is drawn in, found by the range it shows. */
const rowFor = (schedule) => [...D.querySelectorAll('.MuiPaper-root')]
  .filter((el) => el.textContent.includes(formatRange(schedule)))
  .sort((a, b) => a.textContent.length - b.textContent.length)[0]
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

// ---------------- reaching it ----------------
const page = await mount(ADMIN, <Projects />)
const scheduleButtons = [...page.querySelectorAll('button')]
  .filter((b) => b.querySelector('[data-testid="EventNoteIcon"]'))
check('every project row offers its schedule',
  scheduleButtons.length === PROJECTS.length, String(scheduleButtons.length))
await click(scheduleButtons[0])
check('the button opens the rota', body().includes('Support schedule'))
check('the rota names the project it belongs to', body().includes('Acme Support'))
check('it warns that ranges cannot overlap', body().includes('Ranges cannot overlap'))

// A manager cannot reach the Projects page at all, so the rota has a page of
// its own — otherwise "managers run the rota" would be unreachable.
await mount(MANAGER, <SchedulePage />)
check('a manager gets the rota as a page', body().includes('Schedule'))
check('the page explains what a schedule does',
  body().includes('assigned to the people on it'))
check('and tells a manager where their reach ends',
  body().includes('A past schedule can only be changed by an admin'),
  body().match(/.{0,60}past schedule.{0,60}/)?.[0] ?? '(no notice)')

await mount(ADMIN, <SchedulePage />)
check('an admin gets no such notice — they may change all of it',
  !body().includes('A past schedule can only be changed by an admin'))

// ---------------- what the rota shows ----------------
await rota(ADMIN)
check('each schedule reads as a date range',
  [PAST, LIVE, NEXT].every((s) => body().includes(formatRange(s))),
  [PAST, LIVE, NEXT].map(formatRange).join(' | '))
check('a range says how long it runs, both ends counted', body().includes('7 days'))
check('the people on a range are named', body().includes('Ada Lovelace'))

// Read top to bottom: who is on now, who is next, who was on when.
check('schedules are grouped by where they sit relative to today', (() => {
  const t = body()
  const now = t.indexOf('On now'), next = t.indexOf('Coming up'), past = t.indexOf('Past')
  return now > -1 && next > now && past > next
})(), `now=${body().indexOf('On now')} next=${body().indexOf('Coming up')} past=${body().indexOf('Past')}`)

check('each schedule lands in the right group', (() => {
  const t = body()
  const at = (s) => t.indexOf(formatRange(s))
  const now = t.indexOf('On now'), next = t.indexOf('Coming up'), past = t.indexOf('Past')
  return at(LIVE) > now && at(LIVE) < next
    && at(NEXT) > next && at(NEXT) < past
    && at(PAST) > past
})(), body().replace(/\s+/g, ' ').slice(0, 260))

// ---------------- creating one ----------------
check('an admin is offered a new schedule', Boolean(buttonNamed('New schedule')))
await click(buttonNamed('New schedule'))
check('the form asks for both ends of a range',
  inputFor('From')?.type === 'date' && inputFor('To')?.type === 'date')
check('the form asks who is on support', Boolean(inputFor('On support')))
check('a schedule with nobody on it cannot be saved', buttonNamed('Save')?.disabled === true)

await setDate('From', LIVE.starts_on)
await setDate('To', LIVE.ends_on)
check('a clash is named before the save, not after it',
  body().includes(`${formatRange(LIVE)} is already covered by`),
  body().match(/.{0,80}already covered.{0,60}/)?.[0] ?? '(no warning)')
check('and the save stays shut while it clashes', buttonNamed('Save')?.disabled === true)

await setDate('From', dayKey(20))
await setDate('To', dayKey(26))
check('moving it clear drops the warning', !body().includes('already covered by'))

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
check('the roster names each person\'s department',
  options.find((o) => o.textContent.includes('Ada Lovelace'))?.textContent.includes('Engineering'),
  options.map((o) => o.textContent).join(' | '))
await click(options.find((o) => o.textContent.includes('Ada Lovelace')))

// A rota is where most pairs come from, so it carries the ticket's department rule.
options = await openRoster()
check('a second person from the same department is closed off on a rota too',
  options.find((o) => o.textContent.includes('Kay Antonelli'))?.getAttribute('aria-disabled') === 'true')
check('somebody from another department may still be added',
  options.find((o) => o.textContent.includes('Grace Hopper'))?.getAttribute('aria-disabled') !== 'true')
check('the field says the pair must span two departments',
  body().includes('from different departments'))

captured.inserts.length = 0
await click(buttonNamed('Save'))
const inserted = captured.inserts.find((i) => i.table === 'project_schedules')?.row ?? {}
check('the schedule is filed against its project', inserted.project_id === PROJECTS[0].id)
check('it stores plain day keys, not instants',
  inserted.starts_on === dayKey(20) && inserted.ends_on === dayKey(26),
  `${inserted.starts_on} / ${inserted.ends_on}`)
check('it stores who is on as an array',
  JSON.stringify(inserted.assignee_ids) === JSON.stringify(['user-1']),
  JSON.stringify(inserted.assignee_ids))
check('it records who set it up', inserted.created_by === ADMIN.id)

// ---------------- editing ----------------
await rota(ADMIN)
const editIn = (row) => [...(row?.querySelectorAll('button') ?? [])]
  .find((b) => b.querySelector('[data-testid="EditIcon"]'))
const lockIn = (row) => row?.querySelector('[data-testid="LockIcon"]')

check('an admin may edit every schedule, the past one included',
  [PAST, LIVE, NEXT].every((s) => Boolean(editIn(rowFor(s)))))
await click(editIn(rowFor(LIVE)))
check('editing opens the form on that schedule', body().includes('Edit schedule'))
check('the form is filled with the range it is editing',
  inputFor('From')?.value === LIVE.starts_on && inputFor('To')?.value === LIVE.ends_on,
  `${inputFor('From')?.value} / ${inputFor('To')?.value}`)
check('an edit does not clash with itself', !body().includes('already covered by'))

captured.updates.length = 0
await click(buttonNamed('Save'))
const updated = captured.updates.find((u) => u.table === 'project_schedules')?.row ?? {}
check('saving an edit updates rather than inserts',
  updated.starts_on === LIVE.starts_on, JSON.stringify(updated))

// ---------------- a manager: creates freely, changes current and upcoming ----------------
await rota(MANAGER)
check('a manager sees the whole rota, past included',
  [PAST, LIVE, NEXT].every((s) => body().includes(formatRange(s))))
check('a manager may create a schedule', Boolean(buttonNamed('New schedule')))
check('a manager may edit the one running now', Boolean(editIn(rowFor(LIVE))))
check('and the one still ahead', Boolean(editIn(rowFor(NEXT))))
check('but not the one that has already run', !editIn(rowFor(PAST)),
  rowFor(PAST)?.textContent ?? '(row not found)')
check('the past row says why, rather than just losing its buttons',
  Boolean(lockIn(rowFor(PAST))))

// Creating is not limited by date — only changing an existing schedule is.
await click(buttonNamed('New schedule'))
await setDate('From', dayKey(-40))
await setDate('To', dayKey(-35))
options = await openRoster()
await click(options.find((o) => o.textContent.includes('Grace Hopper')))
check('a manager may create a schedule for any dates',
  buttonNamed('Save')?.disabled === false)

// ---------------- a member ----------------
await rota(MEMBER)
check('a member still sees who is on support', body().includes(formatRange(LIVE)))
check('but is offered no way to change any of it',
  !buttonNamed('New schedule')
  && [PAST, LIVE, NEXT].every((s) => !editIn(rowFor(s))))

// ---------------- a write the database turns down ----------------
// Row-level security refuses an update by matching no rows rather than by
// raising, so a silent "saved" that changed nothing is the risk. The page has
// to notice and say so.
await rota(ADMIN)
await click(editIn(rowFor(LIVE)))
refuseWrites.on = true
await click(buttonNamed('Save'))
refuseWrites.on = false
check('a refused write is reported, not passed off as saved',
  body().includes('Nothing was saved'),
  body().match(/.{0,30}Nothing was saved.{0,80}/)?.[0] ?? '(silent success)')

done()
