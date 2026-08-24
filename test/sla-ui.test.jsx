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

async function render(profile, issueOverrides = {}) {
  Object.assign(FIXTURES.issue, issueOverrides)
  dom.window.document.body.innerHTML = ''
  const el = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(el)
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

const body = () => dom.window.document.body.textContent
const D = dom.window.document

/** The big number inside the "Total time elapsed" box, not just any text on the page. */
const elapsedBox = () => {
  const box = [...D.querySelectorAll('.MuiPaper-root')]
    .find((el) => el.textContent.startsWith('Total time elapsed'))
  return {
    value: box?.querySelector('h5')?.textContent ?? '',
    text: box?.textContent ?? '',
    // MUI compiles sx to a class, so read the injected CSS rather than .style
    bg: box ? backgroundOf(box) : '',
  }
}

/**
 * Emotion inserts rules through the CSSOM rather than as <style> text, so read
 * the stylesheets and find the background-color for one of the element's classes.
 */
function backgroundOf(el) {
  const classes = [...el.classList]
  let found = ''
  for (const sheet of D.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const rule of rules ?? []) {
      if (!rule.selectorText || !rule.style) continue
      const hit = classes.some((c) => rule.selectorText.split(/[\s,>]+/).includes('.' + c))
      if (hit && rule.style.backgroundColor) found = rule.style.backgroundColor
    }
  }
  return found
}

/** rgb(r, g, b) -> #rrggbb so it can be compared with the band palette. */
const toHex = (rgb) => {
  const m = rgb.match(/\d+/g)
  if (!m) return rgb
  return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

/** Options offered by a select, identified by its visible label. */
async function optionsOf(label) {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  if (!lab) return null
  const combo = D.getElementById(lab.id.replace(/-label$/, ''))
  await act(async () => {
    combo.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await new Promise((r) => setTimeout(r, 20))
  })
  const opts = [...D.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())
  await act(async () => {
    D.querySelector('.MuiBackdrop-root')?.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  return opts
}

const fieldDisabled = (label) => {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  if (!lab) return null
  const el = D.getElementById(lab.id.replace(/-label$/, ''))
  return el?.classList.contains('Mui-disabled')
    || el?.getAttribute('aria-disabled') === 'true'
    || el?.closest('.MuiInputBase-root')?.classList.contains('Mui-disabled')
}

const HR = 3_600_000, DAY = 86_400_000
const ago = (ms) => new Date(Date.now() - ms).toISOString()

// ---------- 1. New status, admin: request fields editable, all statuses offered ----------
await render({ id: 'user-1', role: 'admin' },
  { status: 'New', closed_at: null, submitted_date: ago(1 * HR) })
check('New + admin: Type is editable', fieldDisabled('Type') === false)
check('New + admin: Product is editable', fieldDisabled('Product') === false)
check('New + admin: Area is editable', fieldDisabled('Area') === false)

let opts = await optionsOf('Status')
check('from New: every status is reachable',
  ['New', 'Triaged', 'In Progress', 'On Hold', 'Done'].every((n) => opts?.includes(n)),
  (opts ?? []).join(', '))
check('from New: a Paused status is offered', opts?.includes('On Hold'), (opts ?? []).join(', '))

// ---------- 2. New status, member: request fields locked ----------
await render({ id: 'user-2', role: 'member' },
  { status: 'New', closed_at: null, submitted_date: ago(1 * HR) })
check('New + member: Type is locked', fieldDisabled('Type') === true)
check('New + member: Product is locked', fieldDisabled('Product') === true)

// ---------- 3. In Progress: request fields locked even for an admin ----------
await render({ id: 'user-1', role: 'admin' },
  { status: 'In Progress', closed_at: null, submitted_date: ago(1 * HR) })
check('In Progress + admin: Type is locked', fieldDisabled('Type') === true)

opts = await optionsOf('Status')
check('from In Progress: "New" is not offered', !opts?.includes('New'), (opts ?? []).join(', '))
check('from In Progress: forward statuses offered',
  opts?.includes('In Progress') && opts?.includes('Triaged') && opts?.includes('Done'),
  (opts ?? []).join(', '))
check('from In Progress: can be paused', opts?.includes('On Hold'), (opts ?? []).join(', '))

// ---------- 4. Closed: cannot reopen ----------
await render({ id: 'user-1', role: 'admin' },
  { status: 'Done', closed_at: ago(1 * HR), submitted_date: ago(4 * HR) })
opts = await optionsOf('Status')
check('from Closed: only Done offered', opts?.length === 1 && opts[0] === 'Done',
  (opts ?? []).join(', '))
check('a closed ticket cannot be paused', !opts?.includes('On Hold'), (opts ?? []).join(', '))
check('closed shows a cannot-reopen hint', body().includes('cannot be reopened'))

// ---------- 5. SLA states in the elapsed box (Bug = 8h target) ----------
await render({ id: 'user-1', role: 'admin' },
  { status: 'In Progress', type: 'Bug', closed_at: null, submitted_date: ago(1 * HR) })
check('under 40% reads "On track"', elapsedBox().text.includes('On track'), elapsedBox().text)
check('under 40% box is BLUE', toHex(elapsedBox().bg) === '#1565c0', elapsedBox().bg)
check('elapsed box shows a real target, not a dash',
  /target \d/.test(elapsedBox().text), elapsedBox().text)
check('elapsed box shows no percentage', !elapsedBox().text.includes('%'), elapsedBox().text)
check('elapsed box has no "since" line', !elapsedBox().text.includes('since'), elapsedBox().text)

// Bug has an 8h target: 4h = 50% -> yellow, 7h = 87% -> orange.
await render({ id: 'user-1', role: 'admin' },
  { status: 'In Progress', type: 'Bug', closed_at: null, submitted_date: ago(4 * HR) })
check('40-70% reads "Watch"', elapsedBox().text.includes('Watch'), elapsedBox().text)
check('40-70% box is YELLOW', toHex(elapsedBox().bg) === '#f9a825', elapsedBox().bg)

await render({ id: 'user-1', role: 'admin' },
  { status: 'In Progress', type: 'Bug', closed_at: null, submitted_date: ago(7 * HR) })
check('70-100% reads "At risk"', elapsedBox().text.includes('At risk'), elapsedBox().text)
check('70-100% box is ORANGE', toHex(elapsedBox().bg) === '#ef6c00', elapsedBox().bg)

await render({ id: 'user-1', role: 'admin' },
  { status: 'In Progress', type: 'Bug', closed_at: null, submitted_date: ago(20 * HR) })
check('past target shows "SLA breached"', body().includes('SLA breached'))
check('past target box is RED', toHex(elapsedBox().bg) === '#c62828', elapsedBox().bg)
check('breach reports how far over as a duration, no percent',
  /\d+[dh]( \d+[hm])? over/.test(elapsedBox().text) && !elapsedBox().text.includes('%'),
  elapsedBox().text)

// closed stops the clock: submitted 10d ago, closed 9d ago, 8h target -> breached, frozen at 1d
await render({ id: 'user-1', role: 'admin' },
  { status: 'Done', type: 'Bug', closed_at: ago(9 * DAY), submitted_date: ago(10 * DAY) })
check('closed ticket freezes elapsed at close time',
  elapsedBox().value === '1d', `elapsed box shows "${elapsedBox().value}"`)
check('closed ticket is not still counting to 10d',
  !elapsedBox().value.startsWith('10d'), elapsedBox().value)
check('closed ticket shows the stopped-clock state',
  elapsedBox().text.includes('SLA breached'), elapsedBox().text)

// closed within target -> met
await render({ id: 'user-1', role: 'admin' },
  { status: 'Done', type: 'Bug', closed_at: ago(9 * DAY), submitted_date: ago(9 * DAY + 2 * HR) })
check('closed inside target shows "Met SLA"', body().includes('Met SLA'), body().slice(0, 200))

// no SLA configured for this type
await render({ id: 'user-1', role: 'admin' },
  { status: 'In Progress', type: 'Question', closed_at: null, submitted_date: ago(2 * HR) })
check('type without an SLA says so', body().includes('No SLA set'), body().slice(0, 200))

// ---------- 6. Paused: clock stops, colour is orange ----------
// Bug has an 8h target. Submitted 20h ago but 16h of that was paused -> 4h counted.
await render({ id: 'user-1', role: 'admin' }, {
  status: 'On Hold', type: 'Bug', closed_at: null,
  submitted_date: ago(20 * HR), paused_ms: 16 * HR, paused_since: null,
})
// 4h of an 8h target is 50% -> the Watch band. The point is that subtracting
// the pause pulled it out of breach entirely.
check('paused: banked pause pulls the ticket out of breach',
  !elapsedBox().text.includes('breached') && elapsedBox().text.includes('Watch'),
  elapsedBox().text)
check('paused: elapsed excludes the pause',
  elapsedBox().value === '4h', elapsedBox().value)
check('paused: the box says paused', elapsedBox().text.includes('paused'), elapsedBox().text)
check('paused: status field explains the stopped clock',
  body().includes('SLA clock is stopped'), '')

// a live pause is subtracted too
await render({ id: 'user-1', role: 'admin' }, {
  status: 'On Hold', type: 'Bug', closed_at: null,
  submitted_date: ago(20 * HR), paused_ms: 10 * HR, paused_since: ago(6 * HR),
})
check('paused: an in-flight pause is subtracted',
  elapsedBox().value === '4h', elapsedBox().value)

// without the pause the same ticket would have breached
await render({ id: 'user-1', role: 'admin' }, {
  status: 'In Progress', type: 'Bug', closed_at: null,
  submitted_date: ago(20 * HR), paused_ms: 0, paused_since: null,
})
check('same age without a pause DOES breach',
  elapsedBox().text.includes('SLA breached'), elapsedBox().text)

done()
