/**
 * Notifications in the app: the header's bell (what it counts, what each one
 * says, where one leads, marking read), watching a ticket from its dialog,
 * and opening a ticket marking its notifications read.
 *
 * Ada's feed (mockSupabase): Grace mentioned her on ACME-42, Jane replied
 * there — both unread — and an older, read assignment on BILL-1.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Route, Routes, useLocation } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const { NotificationsProvider } = await import('../src/context/NotificationsContext')
const AppLayout = (await import('../src/components/AppLayout')).default
const IssueDetail = (await import('../src/components/IssueDetail')).default
const { captured, FIXTURES } = await import('./mockSupabase.js')

const { check, done } = reporter()
const [ada, , kay] = FIXTURES.profiles

const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const click = async (node) => {
  await act(async () => { node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await settle(40)
}
let where = ''
function Where() {
  const loc = useLocation()
  where = loc.pathname + loc.search
  return <div>the page</div>
}

const mount = async (profile, tree) => {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/board']}>
          <AuthContext.Provider value={{ session: {}, profile, loading: false, signIn() {}, signOut() {} }}>
            <ConfigProvider><ProjectProvider>{tree}</ProjectProvider></ConfigProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await settle()
}

// ======================= the bell =======================
await mount(ada, (
  <Routes>
    <Route element={<AppLayout />}>
      <Route path="/board" element={<Where />} />
      <Route path="/issues" element={<Where />} />
      <Route path="/profile" element={<Where />} />
    </Route>
  </Routes>
))

const bell = () => D.querySelector('button[aria-label^="Notifications"]')
check('the header has a bell, counting the unread', bell()?.getAttribute('aria-label') === 'Notifications (2 unread)',
  bell()?.getAttribute('aria-label'))
check('beside the account button', bell()?.nextElementSibling?.getAttribute('aria-label') === 'Account menu')
const sub = captured.channels.find((c) => c.name === 'notifications:user-1')
check('listens live for Ada\'s rows only',
  sub?.listeners[0]?.filter?.filter === 'recipient_id=eq.user-1' && sub.listeners[0].filter.table === 'notifications')

await click(bell())
const items = () => [...D.querySelectorAll('[aria-label="Notifications"] .MuiListItemButton-root')]
check('lists all three, newest first', items().length === 3)
const [first, second, third] = items().map((i) => i.textContent)
check('a mention says who, and which ticket', first.includes('Grace Hopper mentioned you')
  && first.includes('ACME-42 · Cannot export invoice'), first)
check('and quotes the comment', first.includes('“@Ada Lovelace can you check the export on staging?”'))
check('a customer reply names the customer', second.includes('Jane replied by email'))
check('an assignment from the rota, on the other project\'s ticket',
  third.includes('Assigned to you') && third.includes('BILL-1 · Invoice PDF is blank'), third)
check('unread ones are marked as such', items().filter((i) => i.querySelector('[aria-label="Unread"]')).length === 2)
check('no offer to turn on a device this build cannot use', !D.body.textContent.includes('Turn on'))

captured.updates.length = 0
await click(items()[0])
const mark = captured.updates.find((u) => u.table === 'notifications')
check('opening one marks just it read', JSON.stringify(mark?.filters) === '[["in","id",["n1"]]]'
  && Boolean(mark?.row.read_at), JSON.stringify(mark))
check('and goes to its ticket, project and all', where === '/issues?issue=issue-1&project=proj-1', where)
check('the count drops', bell()?.getAttribute('aria-label') === 'Notifications (1 unread)')

await click(bell())
captured.updates.length = 0
await click([...D.querySelectorAll('button')].find((b) => b.textContent === 'Mark all read'))
const all = captured.updates.find((u) => u.table === 'notifications')
check('mark all read: everything of Ada\'s still unread',
  JSON.stringify(all?.filters) === '[["eq","recipient_id","user-1"],["is","read_at",null]]', JSON.stringify(all))
check('and the bell is quiet', bell()?.getAttribute('aria-label') === 'Notifications')

// ======================= the ticket dialog =======================
captured.updates.length = 0
captured.upserts.length = 0
await mount(ada, (
  <NotificationsProvider>
    <IssueDetail issueId="issue-1" open onClose={() => {}} onSaved={() => {}} />
  </NotificationsProvider>
))
await settle(100)
const readTicket = captured.updates.find((u) => u.table === 'notifications')
check('opening a ticket marks what you were told about it read',
  JSON.stringify(readTicket?.filters) === '[["eq","recipient_id","user-1"],["eq","issue_id","issue-1"],["is","read_at",null]]',
  JSON.stringify(readTicket))

const watch = () => D.querySelector('button[aria-label="Watch"], button[aria-label="Stop watching"]')
check('the eye shows Ada watching (filled), with how many do',
  watch()?.getAttribute('aria-label') === 'Stop watching' && watch()?.getAttribute('aria-pressed') === 'true'
  && watch()?.textContent === '2' && Boolean(watch()?.querySelector('[data-testid="VisibilityIcon"]')),
  watch()?.outerHTML.slice(0, 200))
check('Kay, who unwatched, is not counted', !watch()?.textContent.includes('3'))
await click(watch())
const up = captured.upserts.at(-1)
check('unwatching writes her own row, saying so', up?.table === 'issue_watchers'
  && JSON.stringify(up.row) === JSON.stringify({ issue_id: 'issue-1', user_id: 'user-1', watching: false })
  && up.options?.onConflict === 'issue_id,user_id', JSON.stringify(up))
check('people to mention come from the ticket\'s project', captured.reads.includes('project_members'))

captured.upserts.length = 0
await mount(kay, (
  <NotificationsProvider>
    <IssueDetail issueId="issue-1" open onClose={() => {}} onSaved={() => {}} />
  </NotificationsProvider>
))
await settle(100)
check('Kay sees the outlined eye: not watching', watch()?.getAttribute('aria-label') === 'Watch'
  && watch()?.getAttribute('aria-pressed') === 'false' && watch()?.textContent === '2'
  && Boolean(watch()?.querySelector('[data-testid="VisibilityOutlinedIcon"]')), watch()?.textContent)
await click(watch())
check('and watching again is her row, set to true',
  JSON.stringify(captured.upserts.at(-1)?.row) === JSON.stringify({ issue_id: 'issue-1', user_id: 'user-3', watching: true }))

done()
