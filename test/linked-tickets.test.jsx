/**
 * Linked tickets in the ticket dialog: one link, seen from both ends, across
 * projects; linking from either ticket writes the same ordered pair; unlinking
 * removes the one row.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { captured, FIXTURES } = await import('./mockSupabase.js')
const LinkedTickets = (await import('../src/components/LinkedTickets')).default

const { check, done } = reporter()
const [ada] = FIXTURES.profiles
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const setValue = (node, value) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value)
  node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const options = () => [...D.querySelectorAll('[role="option"]')]
const optionText = () => options().map((o) => o.textContent).join(' | ')
const shown = () => [...D.querySelectorAll('[data-linked-ticket]')]
  .map((n) => n.getAttribute('data-linked-ticket'))
const picker = () => [...D.querySelectorAll('input')]
  .find((i) => i.getAttribute('placeholder') === 'ACME-42 or a title')

async function mount(issue, canLink = true) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter>
        <AuthContext.Provider value={{ session: {}, profile: ada, loading: false }}>
          <ConfigProvider><ProjectProvider>
            <LinkedTickets issue={issue} canLink={canLink} onError={() => {}} />
          </ProjectProvider></ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await wait(60)
}

// ---- one row, both ends ----
await mount(FIXTURES.issue)
check('ACME-42 shows the ticket it is linked to, by its own project key',
  JSON.stringify(shown()) === '["BILL-1"]', shown().join())
check('with its title', D.body.textContent.includes('Invoice PDF is blank'))
const href = D.querySelector('[data-linked-ticket="BILL-1"] a')?.getAttribute('href')
check('opening it goes through its share link', href === '/i/BILL/1', href)

await mount(FIXTURES.otherIssue)
check('BILL-1 shows the same link from its end',
  JSON.stringify(shown()) === '["ACME-42"]', shown().join())

// ---- unlinking ----
captured.deletes.length = 0
await act(async () => { D.querySelector('[aria-label="Unlink ACME-42"]').click() })
await wait(20)
check('unlinking deletes the one row',
  captured.deletes.some((d) => d.table === 'issue_links'), JSON.stringify(captured.deletes))

// ---- linking, from the end with the larger id ----
const saved = FIXTURES.issue_links
FIXTURES.issue_links = []
await mount(FIXTURES.otherIssue)
check('an unlinked ticket lists nothing', shown().length === 0, shown().join())

await setValue(picker(), 'ACME-42')
await wait(350)
check('a reference finds that ticket', optionText().includes('ACME-42'), optionText())
check('never offers the ticket itself', !optionText().includes('BILL-1'), optionText())

captured.inserts.length = 0
await act(async () => {
  options().find((o) => o.textContent.includes('ACME-42'))
    ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await wait(20)
const row = captured.inserts.find((i) => i.table === 'issue_links')?.row
check('linking from BILL-1 writes the pair smaller id first',
  row?.issue_a === 'issue-1' && row?.issue_b === 'issue-2', JSON.stringify(row))

await setValue(picker(), 'invoice')
await wait(350)
check('a title search finds by part of the title', optionText().includes('ACME-42'), optionText())
FIXTURES.issue_links = saved

// ---- without the right ----
await mount(FIXTURES.issue, false)
check('the link still shows', JSON.stringify(shown()) === '["BILL-1"]', shown().join())
check('but there is nothing to change it with',
  !picker() && !D.querySelector('[aria-label^="Unlink"]'))

done()
