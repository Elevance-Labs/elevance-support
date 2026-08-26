/**
 * A status is coloured by its *type*, and that colour has to show up wherever a
 * status is listed — board columns and the ticket's status picker, in both the
 * option list and the closed field. Same rule, same dot, one component.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { STATUS_TYPE_COLORS } = await import('../src/lib/sla')
const { FIXTURES } = await import('./mockSupabase.js')

const { check, done } = reporter()
const D = dom.window.document
const [ada] = FIXTURES.profiles

// Computed styles come back as rgb(), so compare against the hex we shipped.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
const bgOf = (node) => node && dom.window.getComputedStyle(node).backgroundColor

const mount = async (page) => {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/issues']}>
        <AuthContext.Provider value={{ session: {}, profile: ada, loading: false }}>
          <ConfigProvider><ProjectProvider>{page}</ProjectProvider></ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
  return el
}

// A dot is the only round, fixed-size span a status row carries.
const dotIn = (node) => [...(node?.querySelectorAll('span') ?? [])]
  .find((n) => dom.window.getComputedStyle(n).borderRadius === '50%')

// ---- board columns: the reference the dots are meant to match ----
const Board = (await import('../src/pages/Board')).default
const board = await mount(<Board />)
const columns = [...board.querySelectorAll('.MuiPaper-root')]
  .filter((p) => p.textContent.trim().startsWith('New')
              || p.textContent.trim().startsWith('In Progress')
              || p.textContent.trim().startsWith('Done'))
const columnDot = (label) => dotIn(columns.find((c) => c.textContent.trim().startsWith(label)))
check('board column keeps its dot', Boolean(columnDot('New')))
check('a New column is grey', bgOf(columnDot('New')) === rgb(STATUS_TYPE_COLORS.new),
  bgOf(columnDot('New')))
check('an In Progress column is blue',
  bgOf(columnDot('In Progress')) === rgb(STATUS_TYPE_COLORS.in_progress),
  bgOf(columnDot('In Progress')))
check('a Closed column is green', bgOf(columnDot('Done')) === rgb(STATUS_TYPE_COLORS.closed),
  bgOf(columnDot('Done')))

// ---- the ticket's status picker ----
const IssueDetail = (await import('../src/components/IssueDetail')).default
await mount(<IssueDetail issueId="issue-1" open onClose={() => {}} onSaved={() => {}} />)

// issue-1 sits in "In Progress", so the closed field must already show blue
// without the list ever being opened.
const field = [...D.querySelectorAll('.MuiSelect-select')]
  .find((n) => n.textContent.trim() === 'In Progress')
check('the selected status shows in the closed field', Boolean(field), 'no status field found')
check('the closed field carries a dot', Boolean(dotIn(field)), field?.innerHTML?.slice(0, 200) ?? '')
check('and it is the status type colour',
  bgOf(dotIn(field)) === rgb(STATUS_TYPE_COLORS.in_progress), bgOf(dotIn(field)) ?? '')

await act(async () => {
  field?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
})
await act(async () => { await new Promise((r) => setTimeout(r, 30)) })

const options = [...D.querySelectorAll('[role="option"]')]
check('the picker lists statuses', options.length > 0, String(options.length))
check('every option has a dot', options.every((o) => dotIn(o)),
  options.map((o) => o.textContent).join(' | '))
const optionDot = (label) => dotIn(options.find((o) => o.textContent.trim() === label))
// The dropdown only offers legal moves, so which statuses appear depends on the
// ticket — assert on whichever of the four types actually made it into the list.
const byType = [
  ['In Progress', 'in_progress'], ['Triaged', 'in_progress'],
  ['On Hold', 'paused'], ['Done', 'closed'], ['New', 'new'],
].filter(([label]) => optionDot(label))
check('the picker offered more than one status type',
  new Set(byType.map(([, t]) => t)).size > 1, byType.map(([l]) => l).join(', '))
for (const [label, type] of byType) {
  check(`"${label}" is drawn in its ${type} colour`,
    bgOf(optionDot(label)) === rgb(STATUS_TYPE_COLORS[type]), bgOf(optionDot(label)) ?? '')
}
check('the dot is not the only cue — the type is titled',
  options.every((o) => dotIn(o)?.getAttribute('title')),
  options.map((o) => dotIn(o)?.getAttribute('title')).join(', '))

done()
