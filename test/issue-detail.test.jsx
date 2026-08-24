import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const IssueDetail = (await import('../src/components/IssueDetail')).default
const { FIXTURES } = await import('./mockSupabase.js')

const { check, done } = reporter()

// Sign in as an admin for the first pass.
const AuthCtx = (await import('../src/context/AuthContext.jsx'))
const React = await import('react')

async function render(profile) {
  // Provide the auth context directly so we can vary the role.
  const { AuthProvider } = AuthCtx
  const el = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(el)

  // Patch useAuth's context value by wrapping in a provider stub.
  const Stub = ({ children }) =>
    React.createElement(AuthCtxRaw.Provider,
      { value: { session: {}, profile, loading: false, signIn: () => {}, signOut: () => {} } },
      children)

  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <Stub>
            <ConfigProvider>
              <ProjectProvider>
                <IssueDetail issueId="issue-1" open onClose={() => {}} onSaved={() => {}} />
              </ProjectProvider>
            </ConfigProvider>
          </Stub>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
  return el
}

// IssueDetail renders into a portal, so read from document.body.
const body = () => dom.window.document.body.textContent
const elapsedBoxText = () => [...dom.window.document.querySelectorAll('.MuiPaper-root')]
  .find((el) => el.textContent.startsWith('Total time elapsed'))?.textContent ?? ''

const AuthCtxRaw = AuthCtx.AuthContext ?? null
if (!AuthCtxRaw) {
  console.log('FAIL AuthContext is not exported — cannot inject a role for testing')
  process.exit(1)
}

await render({ id: 'user-1', role: 'admin', full_name: 'Ada Lovelace' })

check('renders the ticket title', body().includes('Cannot export invoice'))
check('shows the ticket identifier, prefixed with the project key',
  body().includes('ACME-42'))
// Which queue a ticket belongs to is the context for reading its number, so the
// project name leads and the identifier follows, separated by a centre dot.
check('shows the project name before the identifier, on a centre dot',
  body().includes('Acme Support · ACME-42'),
  body().match(/.{0,30}ACME-42.{0,10}/)?.[0] ?? '')

// three columns
const grid = dom.window.document.querySelector('[class*="MuiDialog"] .MuiBox-root')
check('left column: controls', body().includes('Controls'))
check('left column: submission details', body().includes('Submission') && body().includes('Acme'))
check('notes are gone from the ticket', !body().includes('Reproduced on staging.'))
check('centre: assignee and status side by side', (() => {
  const labels = [...dom.window.document.querySelectorAll('.MuiFormLabel-root')]
    .map((l) => l.textContent.replace(/\s*\*$/, '').trim())
  return labels.includes('Assignee') && labels.includes('Status')
})())
check('centre: comments', body().includes('Comments'))
check('centre: existing comment shown', body().includes('Looking into this.'))
check('comment shows author name', body().includes('Ada Lovelace'))

// timeline
check('right: status timeline', body().includes('Status timeline'))
check('right: total elapsed', body().includes('Total time elapsed'))
check('timeline names who changed status', body().includes('Grace Hopper'))
check('timeline shows a derived name, never an email',
  !body().includes('grace.hopper@co.com'))
check('timeline marks the current status', body().includes('current'))
check('total elapsed box no longer shows a "since" line',
  !(elapsedBoxText() ?? '').includes('since'), elapsedBoxText())
// Each timeline caption must be its own block, or they run together as
// "Grace Hopper · 22 Aug 2026, 03:02after 1h in New".
const timelinePaper = () => [...dom.window.document.querySelectorAll('.MuiPaper-root')]
  .find((el) => el.textContent.startsWith('Status timeline'))

check('timeline captions are block-level, not inline', (() => {
  const caps = [...(timelinePaper()?.querySelectorAll('.MuiTypography-caption') ?? [])]
  if (!caps.length) return false
  return caps.every((c) => {
    const cls = [...c.classList]
    for (const sheet of dom.window.document.styleSheets) {
      let rules; try { rules = sheet.cssRules } catch { continue }
      for (const r of rules ?? []) {
        if (!r.selectorText || !r.style) continue
        if (cls.some((k) => r.selectorText.split(/[\s,>]+/).includes('.' + k))
            && r.style.display === 'block') return true
      }
    }
    return false
  })
})(), 'a caption is not display:block')

check('no leaked display attribute on the DOM',
  timelinePaper()?.querySelector('[display]') === null,
  timelinePaper()?.querySelector('[display]')?.outerHTML?.slice(0, 80) ?? '')

check('time in status shown on its own entry, not the next',
  /\d+[dhm].{0,3} in this status/.test(timelinePaper()?.textContent ?? ''),
  timelinePaper()?.textContent?.slice(0, 200) ?? '')

check('the old "after X in Y" phrasing is gone',
  !/after \d+[dhms]+ in /.test(body()), body().match(/.{0,40}after.{0,20}/)?.[0] ?? '')
check('unreached statuses are NOT shown', !body().includes('Not reached'))
check('unreached "Done" status is absent from the timeline', (() => {
  const tl = [...dom.window.document.querySelectorAll('.MuiPaper-root')]
    .find((el) => el.textContent.includes('Status timeline'))
  return tl && !tl.textContent.includes('Done')
})())
check('reached statuses are all shown', (() => {
  const tl = [...dom.window.document.querySelectorAll('.MuiPaper-root')]
    .find((el) => el.textContent.includes('Status timeline'))
  return ['New', 'Triaged', 'In Progress'].every((n) => tl.textContent.includes(n))
})())

// left column order: Submission, then Request, then Controls
check('left column ordered Submission -> Request -> Controls', (() => {
  const t = body()
  const sub = t.indexOf('Submission'), req = t.indexOf('Request'), ctl = t.indexOf('Controls')
  return sub > -1 && req > sub && ctl > req
})(), `submission=${body().indexOf('Submission')} request=${body().indexOf('Request')} controls=${body().indexOf('Controls')}`)

// comments list sits above the composer
check('comments appear above the comment box', (() => {
  const thread = [...dom.window.document.querySelectorAll('.MuiPaper-root')]
    .find((el) => el.textContent.includes('Looking into this.'))
  const composerEl = [...dom.window.document.querySelectorAll('textarea')]
    .find((t) => (t.getAttribute('placeholder') ?? '').startsWith('Add a comment'))
  if (!thread || !composerEl) return false
  // DOCUMENT_POSITION_FOLLOWING === 4 -> composer comes after the comment
  return (thread.compareDocumentPosition(composerEl) & 4) !== 0
})())

// ---- the share link ----
const copyButton = () => [...dom.window.document.querySelectorAll('button')]
  .find((b) => b.getAttribute('aria-label') === 'Copy public link')

check('there is a copy-link button', Boolean(copyButton()))
check('the copy-link button is enabled once the ticket has loaded',
  copyButton()?.disabled === false)

const clipboard = { text: null }
Object.defineProperty(dom.window.navigator, 'clipboard', {
  value: { writeText: async (t) => { clipboard.text = t } }, configurable: true,
})
// setup.js already points global.navigator at this same object.
await act(async () => { copyButton()?.click() })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

check('clicking copies the ticket reference as a link: ACME-42 -> /i/ACME/42',
  clipboard.text === `${dom.window.location.origin}/i/ACME/42`, String(clipboard.text))
check('the copied link carries no internal id', !String(clipboard.text).includes('issue-1'))

const deleteButtons = () =>
  [...dom.window.document.querySelectorAll('button')]
    .filter((b) => b.textContent.trim() === 'Delete')

check('admin sees a Delete button', deleteButtons().length === 1,
  `found ${deleteButtons().length}`)

// Comment edit window: c2 is 30s old and authored by user-2; c1 is 2 days old.
// Rendering as user-2 should expose edit/delete on c2 only.
const editIcons = () =>
  [...dom.window.document.querySelectorAll('[data-testid="EditIcon"]')].length

// ---- second pass: a member ----
dom.window.document.body.innerHTML = ''
await render({ id: 'user-2', role: 'member', full_name: '', email: 'grace.hopper@co.com' })

check('member sees NO Delete button', deleteButtons().length === 0,
  `found ${deleteButtons().length}`)
check('member still sees the ticket', body().includes('Cannot export invoice'))
// The composer is a placeholder attribute, not page text.
const composer = () => [...dom.window.document.querySelectorAll('textarea')]
  .some((t) => (t.getAttribute('placeholder') ?? '').startsWith('Add a comment'))
check('member can still comment', composer())

// No raw email address should appear anywhere in the ticket view. The requester's
// email is a submission detail and is expected; team members' are not.
const teamEmails = ['grace.hopper@co.com', 'ada@co.com']
check('no team member email leaks into the UI',
  teamEmails.every((e) => !body().includes(e)),
  teamEmails.filter((e) => body().includes(e)).join(', '))

// One EditIcon for the fresh own comment; the ticket controls use no EditIcon.
check('fresh own comment is editable', editIcons() >= 1, `found ${editIcons()}`)

// ---- third pass: an author whose comments are all stale ----
dom.window.document.body.innerHTML = ''
await render({ id: 'user-1', role: 'member', full_name: 'Ada Lovelace' })
check('stale own comment is not editable (5 min window closed)',
  editIcons() === 0, `found ${editIcons()} edit icons`)

done()
