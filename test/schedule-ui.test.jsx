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
const { formatRange, today, weekdayOf } = await import('../src/lib/schedules.js')
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

let root = null
async function mount(profile, node) {
  // Unmount first: a dialog left open lives in a portal outside the root, and
  // clearing the body under it leaves React removing nodes that are gone.
  if (root) await act(async () => root.unmount())
  D.body.innerHTML = ''
  localStorage.removeItem('el-support.schedule-view')
  const el = D.createElement('div')
  D.body.appendChild(el)
  const Stub = ({ children }) =>
    React.createElement(AuthContext.Provider,
      { value: { session: {}, profile, loading: false, signIn: () => {}, signOut: () => {} } },
      children)
  await act(async () => {
    root = createRoot(el)
    root.render(
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
/** A day's cell, paging the calendar towards it if it is not on screen. */
const cellFor = async (day) => {
  for (let i = 0; i < 4; i++) {
    const c = D.querySelector(`[data-day="${day}"]`)
    if (c) return c
    await click(D.querySelector(`button[aria-label="${day < today() ? 'Previous' : 'Next'}"]`))
  }
  return D.querySelector(`[data-day="${day}"]`)
}
const tap = async (day) => click(await cellFor(day))
const dialog = () => D.querySelector('[role="dialog"]')
const dialogTitle = () => dialog()?.querySelector('.MuiDialogTitle-root')?.firstChild?.textContent ?? ''
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
check('it opens on this month', body().includes(new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })),
  D.querySelector('h6')?.textContent)
check('a month is drawn as whole weeks', D.querySelectorAll('[data-day]').length % 7 === 0,
  String(D.querySelectorAll('[data-day]').length))
check('the columns are the days of the week, Monday first', (() => {
  const t = body(); return t.indexOf('Mon') > -1 && t.indexOf('Mon') < t.indexOf('Sun')
})())

const todayCell = await cellFor(today())
check('today\'s cell names who is on support', todayCell?.textContent.includes('Ada')
  && todayCell?.textContent.includes('Grace'), todayCell?.textContent)
check('and says so in words, for a screen reader',
  todayCell?.getAttribute('aria-label')?.includes('Ada Lovelace and Grace Hopper on support'),
  todayCell?.getAttribute('aria-label'))
check('the summary says who is on now', body().includes('On now') && body().includes('Ada Lovelace'))

const freeCell = await cellFor(dayKey(20))
check('a day nobody covers says so', freeCell?.getAttribute('aria-label')?.endsWith('nobody on support'),
  freeCell?.getAttribute('aria-label'))

await rota(ADMIN)
const pastCell = await cellFor(PAST.starts_on)
check('a past range is still on the calendar', pastCell?.textContent.includes('Ada'), pastCell?.textContent)

await rota(ADMIN)
await click(buttonNamed('Week'))
check('the week view draws seven days', D.querySelectorAll('[data-day]').length === 7)
check('and today is one of them', Boolean(D.querySelector(`[data-day="${today()}"]`)))
check('the week view gives full names', D.querySelector(`[data-day="${today()}"]`)?.textContent.includes('Ada Lovelace'))
check('the view is remembered', localStorage.getItem('el-support.schedule-view') === 'week')

// ---------------- creating one ----------------
await rota(ADMIN)
check('an admin is offered a new schedule', Boolean(buttonNamed('New schedule')))
await tap(dayKey(20))
check('tapping a free day opens a new schedule', dialogTitle() === 'New schedule', dialogTitle())
check('with that day filled in',
  inputFor('From')?.value === dayKey(20) && inputFor('To')?.value === dayKey(20),
  `${inputFor('From')?.value} / ${inputFor('To')?.value}`)
check('the date fields name the day of the week',
  inputFor('From')?.closest('.MuiInputBase-root')?.textContent.includes(weekdayOf(dayKey(20))),
  inputFor('From')?.closest('.MuiInputBase-root')?.textContent)
check('the form asks for both ends of a range',
  inputFor('From')?.type === 'date' && inputFor('To')?.type === 'date')
check('the form asks who is on support', Boolean(inputFor('On support')))
check('a schedule with nobody on it cannot be saved', buttonNamed('Save')?.disabled === true)

await setDate('To', LIVE.ends_on)
await setDate('From', LIVE.starts_on)
check('a clash is named before the save, not after it',
  body().includes(`${formatRange(LIVE)} is already covered by`),
  body().match(/.{0,80}already covered.{0,60}/)?.[0] ?? '(no warning)')
check('and the save stays shut while it clashes', buttonNamed('Save')?.disabled === true)

await setDate('From', dayKey(27))
check('moving the start past the end carries the end along', inputFor('To')?.value === dayKey(27))
await setDate('From', dayKey(20))
await setDate('To', dayKey(26))
check('moving it clear drops the warning', !body().includes('already covered by'))
check('the weekday follows the date',
  inputFor('To')?.closest('.MuiInputBase-root')?.textContent.includes(weekdayOf(dayKey(26))))

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

await rota(ADMIN)
await click(buttonNamed('New schedule'))
check('the New button starts on today',
  inputFor('From')?.value === today() && inputFor('To')?.value === today())

// ---------------- editing ----------------
const deleteButton = () => buttonNamed('Delete')
for (const s of [PAST, LIVE, NEXT]) {
  await rota(ADMIN)
  await tap(s.starts_on)
  check(`an admin may edit the ${s.id.slice(4)} schedule`,
    dialogTitle() === 'Edit schedule' && Boolean(deleteButton()), dialogTitle())
}

await rota(ADMIN)
await tap(today())
check('tapping a covered day opens the schedule covering it', dialogTitle() === 'Edit schedule')
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
check('a manager may create a schedule', Boolean(buttonNamed('New schedule')))
await tap(LIVE.starts_on)
check('a manager may edit the one running now', dialogTitle() === 'Edit schedule')
await rota(MANAGER)
await tap(NEXT.starts_on)
check('and the one still ahead', dialogTitle() === 'Edit schedule')
await rota(MANAGER)
await tap(PAST.starts_on)
check('but not the one that has already run',
  dialogTitle() === 'Schedule' && !buttonNamed('Save') && !deleteButton(), dialogTitle())
check('the form says why, rather than just losing its buttons',
  body().includes('only an admin can change it'))

// Creating is not limited by date — only changing an existing schedule is.
await rota(MANAGER)
await tap(dayKey(-40))
check('a manager may start a schedule on a past day', dialogTitle() === 'New schedule')
options = await openRoster()
await click(options.find((o) => o.textContent.includes('Grace Hopper')))
check('a manager may create a schedule for any dates',
  buttonNamed('Save')?.disabled === false)

// ---------------- a member ----------------
await rota(MEMBER)
check('a member still sees who is on support',
  (await cellFor(today()))?.textContent.includes('Ada'))
check('but is offered no way to change any of it',
  !buttonNamed('New schedule')
  && [...D.querySelectorAll('[data-day]')].every((c) => c.getAttribute('role') !== 'button'))

// ---------------- a write the database turns down ----------------
// Row-level security refuses an update by matching no rows rather than by
// raising, so a silent "saved" that changed nothing is the risk. The page has
// to notice and say so.
await rota(ADMIN)
await tap(today())
refuseWrites.on = true
await click(buttonNamed('Save'))
refuseWrites.on = false
check('a refused write is reported, not passed off as saved',
  body().includes('Nothing was saved'),
  body().match(/.{0,30}Nothing was saved.{0,80}/)?.[0] ?? '(silent success)')
check('and the form stays open to try again', dialogTitle() === 'Edit schedule')

done()
