// The share link: what an anonymous visitor sees, what they must NOT see, and
// where a signed-in staff member ends up instead.
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/i/ACME/42')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const React = await import('react')
const { MemoryRouter, Routes, Route, useLocation } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext.jsx')
const PublicIssue = (await import('../src/pages/PublicIssue')).default
const { captured, PUBLIC_KEY, PUBLIC_NUMBER, PUBLIC_PAYLOAD } = await import('./mockSupabase.js')
const { publicIssueUrl, publicIssuePath } = await import('../src/lib/projects.js')

const { check, done } = reporter()

// Renders the page at /i/:key/:number and reports where the router ended up, so
// the signed-in redirect can be asserted rather than inferred.
async function render({ session, number = PUBLIC_NUMBER, key = PUBLIC_KEY }) {
  const el = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(el)
  const seen = { path: null }

  const Spy = () => {
    const loc = useLocation()
    React.useEffect(() => { seen.path = loc.pathname + loc.search })
    return null
  }
  const auth = { session, profile: session ? { id: 'user-1', role: 'admin' } : null,
    loading: false, signIn: () => {}, signOut: () => {} }

  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[publicIssuePath(key, number)]}>
          <AuthContext.Provider value={auth}>
            <Spy />
            <Routes>
              <Route path="/i/:key/:number" element={<PublicIssue />} />
              <Route path="/issues" element={<div>issues list</div>} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
  return seen
}

const body = () => dom.window.document.body.textContent

// ---- the link itself ----
check('public link is the ticket reference: ACME-42 lives at /i/ACME/42',
  publicIssueUrl('ACME', 42, 'https://support.example')
    === 'https://support.example/i/ACME/42',
  publicIssueUrl('ACME', 42, 'https://support.example'))
check('no link without a number', publicIssueUrl('ACME', null, 'https://x') === null)
check('no link without a project key', publicIssueUrl(null, 42, 'https://x') === null)
check('the link is constructible by hand from the ticket reference alone',
  publicIssueUrl('ACME', 42, 'https://x') === 'https://x/i/' + 'ACME-42'.replace('-', '/'))

// ---- anonymous visitor ----
dom.window.document.body.innerHTML = ''
captured.functionCalls.length = 0
await render({ session: null })

check('anon sees the title', body().includes('Cannot export invoice'))
check('anon sees the ticket identifier, prefixed with the project key',
  body().includes('ACME-42'))
check('anon sees the project name', body().includes('Acme Support'))
check('anon sees the description', body().includes('The export button spins forever.'))
check('anon sees the company', body().includes('Acme'))
check('anon sees the Jira ticket', body().includes('ENG-77'))
check('anon sees attachments', body().includes('screenshot.png'))
check('anon sees comments', body().includes('Looking into this.') && body().includes('Just posted.'))
check('anon sees comment authors by name', body().includes('Ada Lovelace'))

// The photo is on the allow-list deliberately — a support reply reads better
// from a person. What must not follow it out is the id or the email behind it.
const D = dom.window.document
const commentImgs = [...D.querySelectorAll('img')].map((i) => i.getAttribute('src'))
check('anon sees a comment author photo',
  commentImgs.includes(PUBLIC_PAYLOAD.comments[0].author_avatar_url),
  commentImgs.join(', ') || '(none)')
check('an author with no photo falls back to initials, not a broken image',
  body().includes('GH'), body().slice(0, 400))
check('the photo URL is the only thing the avatar exposes',
  !commentImgs.some((src) => /user-2|@co\.com/.test(src ?? '')),
  commentImgs.join(', '))

check('the page is served by the edge function, with the key and number from the URL',
  captured.functionCalls.length === 1
  && captured.functionCalls[0].name === 'public-issue'
  && captured.functionCalls[0].body.number === PUBLIC_NUMBER
  && captured.functionCalls[0].body.key === PUBLIC_KEY,
  JSON.stringify(captured.functionCalls))
check('the number reaches the function as a number, not the raw path string',
  typeof captured.functionCalls[0].body.number === 'number',
  typeof captured.functionCalls[0]?.body?.number)

// Everything internal must stay internal. These are the fields the staff dialog
// shows that a customer holding the link has no business seeing.
const leaks = {
  status: 'In Progress',
  priority: 'High',
  assignee: 'Assignee',
  'status timeline': 'Status timeline',
  SLA: 'Total time elapsed',
  'requester email': 'jane@acme.com',
  'internal notes': 'Reproduced on staging.',
}
for (const [what, text] of Object.entries(leaks)) {
  check(`anon does NOT see ${what}`, !body().includes(text), `found "${text}"`)
}
check('anon gets no editing affordance',
  dom.window.document.querySelector('textarea') === null
  && ![...dom.window.document.querySelectorAll('button')]
      .some((b) => /save|comment|delete/i.test(b.textContent)),
  'an input or action button is rendered')

// ---- a link that doesn't resolve ----
dom.window.document.body.innerHTML = ''
await render({ session: null, number: 9999 })
check('an unknown ticket number shows a friendly dead end, not a crash',
  body().includes('No such ticket'), body().slice(0, 120))
check('an unknown ticket number reveals nothing about the ticket',
  !body().includes('Cannot export invoice'))

// Numbers restart at 1 per project, so the key is what disambiguates them. The
// same number under another key must not fall through to this project's ticket.
dom.window.document.body.innerHTML = ''
await render({ session: null, key: 'BILL' })
check('the same number under a different project key does not resolve',
  body().includes('No such ticket') && !body().includes('Cannot export invoice'),
  body().slice(0, 120))

// A junk path must dead-end in the page, without a pointless round trip.
dom.window.document.body.innerHTML = ''
captured.functionCalls.length = 0
await render({ session: null, number: 'not-a-number' })
check('a non-numeric ticket number dead-ends without calling the function',
  body().includes('No such ticket') && captured.functionCalls.length === 0,
  `${captured.functionCalls.length} calls`)

// ---- signed-in staff ----
dom.window.document.body.innerHTML = ''
const seen = await render({ session: { user: { id: 'user-1' } } })
check('signed-in staff land on the issues list with the ticket open',
  seen.path === '/issues?issue=issue-1&project=proj-1', seen.path)
check('signed-in staff do not get the read-only page',
  !body().includes('read-only view of a support ticket'))

done()
