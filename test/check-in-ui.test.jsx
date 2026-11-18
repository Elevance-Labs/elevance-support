/**
 * A check-in from the Board: open tickets one at a time, the way on held shut
 * until a comment is posted or a status change saved, then a summary. Only an
 * admin or a manager is offered one, on the Board and on Issues.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/board')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { FIXTURES, captured, NOW } = await import('./mockSupabase.js')
const Board = (await import('../src/pages/Board')).default
const Issues = (await import('../src/pages/Issues')).default

const { check, done } = reporter()
const D = dom.window.document
const MANAGER = { id: 'user-3', role: 'manager', full_name: 'Kay' }
const MEMBER = { id: 'user-2', role: 'member', full_name: 'Grace' }

// Beside the In Progress ticket the fixtures carry: a New one, whose lane the
// Board draws first, and a closed one the check-in must skip.
FIXTURES.issues.push(
  { ...FIXTURES.issue, id: 'issue-new', number: 50, title: 'Login page is slow',
    status: 'New', chat_thread: null },
  { ...FIXTURES.issue, id: 'issue-done', number: 51, title: 'Typo on invoice',
    status: 'Done', closed_at: new Date(NOW - 3_600_000).toISOString() },
)

let asked = 0
let answer = true
global.confirm = () => { asked++; return answer }

const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const mount = async (page, profile) => {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/board']}>
        <AuthContext.Provider value={{ session: {}, profile, loading: false }}>
          <ConfigProvider><ProjectProvider>{page}</ProjectProvider></ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await settle(80)
}
const button = (text) => [...D.querySelectorAll('button')]
  .find((b) => b.textContent.trim() === text)
const click = async (node) => {
  await act(async () => { node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle()
}
// The ticket dialog may still be fading out behind it.
const summaryText = () => [...D.querySelectorAll('[role="dialog"]')]
  .find((d) => d.querySelector('.MuiDialogTitle-root'))?.textContent ?? ''
const bar = () => D.querySelector('[data-check-in]')?.textContent ?? ''
const title = () => D.querySelector('.MuiDialog-root h6')?.textContent ?? ''
const comment = async (html) => {
  const box = D.querySelector('[data-rich-text-editor][aria-label="Add a comment…"]')
  await act(async () => {
    box.innerHTML = html
    box.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click(button('Comment'))
}
const fieldFor = (label) => [...D.querySelectorAll('.MuiFormLabel-root')]
  .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)?.closest('.MuiFormControl-root')
async function pick(label, name) {
  const combo = fieldFor(label)?.querySelector('[role="combobox"]')
  await act(async () => {
    combo?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
  await click([...D.querySelectorAll('[role="option"]')]
    .find((o) => o.textContent.trim().startsWith(name)))
}

// ---- who is offered one ----
await mount(<Board />, MEMBER)
check('a member is offered no check-in on the Board', !button('Check-in'))
await mount(<Issues />, MEMBER)
check('nor on Issues', !button('Check-in'))
await mount(<Issues />, MANAGER)
check('a manager is offered one on Issues', Boolean(button('Check-in')) && !button('Check-in').disabled)
await click(button('Check-in'))
check('from Issues it takes the same order as from the Board',
  title() === 'Cannot export invoice' && bar().includes('1 of 2'), `${title()} | ${bar()}`)

await mount(<Board />, MANAGER)
check('and on the Board', Boolean(button('Check-in')) && !button('Check-in').disabled)

// ---- the walk ----
// The New lane is drawn first, but a check-in reads the pipeline from its far
// end: the In Progress ticket comes before the New one.
await click(button('Check-in'))
check('it opens on the in-progress ticket, not the first lane',
  title() === 'Cannot export invoice' && bar().includes('Check-in · 1 of 2'), `${title()} | ${bar()}`)
const band = D.querySelector('[data-check-in]')
const heading = D.querySelector('.MuiDialog-root h6')
check('the check-in sits above the ticket, not inside it', Boolean(band && heading)
  && Boolean(band.compareDocumentPosition(heading) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
  && !band.contains(heading))
check('a closed ticket is not part of it', !bar().includes('of 3'), bar())
check('the way on is shut until something is captured',
  button('Next ticket')?.disabled === true && bar().includes('Change the status or add a comment'), bar())

// Alt+↓ must not slip past the gate either.
await act(async () => {
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }))
})
await settle()
check('nor does Alt+↓ move on', title() === 'Cannot export invoice', title())

await pick('Status', 'Done')
check('a status picked but not saved is not yet captured',
  button('Next ticket')?.disabled === true && bar().includes('Save changes to record'), bar())
await click(button('Save changes'))
const saved = captured.updates.filter((u) => u.table === 'issues').at(-1)
check('the status is saved', saved?.row.status === 'Done', JSON.stringify(saved?.row))
check('and captures the ticket', bar().includes('Status changed')
  && button('Next ticket')?.disabled === false, bar())

await click(button('Next ticket'))
check('then on to the New one', title() === 'Login page is slow' && bar().includes('2 of 2'), bar())
check('the last one finishes instead, and is held in its turn',
  button('Finish check-in')?.disabled === true, bar())

const before = captured.inserts.filter((i) => i.table === 'comments').length
await comment('<div>Ada to profile the login query by Friday</div>')
const posted = captured.inserts.filter((i) => i.table === 'comments')
check('the comment is posted on the ticket', posted.length === before + 1
  && posted.at(-1).row.issue_id === 'issue-new', JSON.stringify(posted.at(-1)?.row))
check('which captures it', bar().includes('Comment added')
  && button('Finish check-in')?.disabled === false, bar())

await click(button('Back'))
check('back to an earlier ticket', title() === 'Cannot export invoice'
  && button('Next ticket')?.disabled === false, bar())
await click(button('Next ticket'))

asked = 0
await click(button('Finish check-in'))
check('finishing asks nothing when everything is captured', asked === 0, `asked ${asked}`)
const summary = summaryText()
check('and sums it up', summary.includes('Check-in complete')
  && summary.includes('2 of 2 open tickets captured') && summary.includes('1 status change')
  && summary.includes('1 ticket commented on'), summary)
await click(button('Done'))
check('Done leaves the board as it was', !D.querySelector('.MuiDialog-root') && Boolean(button('Check-in')))

// ---- ending early ----
await click(button('Check-in'))
answer = false; asked = 0
await click(button('End check-in'))
check('ending with tickets left asks first', asked === 1 && Boolean(bar()), `asked ${asked}`)
answer = true
await click(button('End check-in'))
const ended = summaryText()
check('and the summary names what was missed', ended.includes('Check-in ended')
  && ended.includes('Nothing captured on 2 tickets') && ended.indexOf('ACME-42 Cannot export invoice') >= 0
  && ended.indexOf('ACME-42') < ended.indexOf('ACME-50 Login page is slow'), ended)

done()
