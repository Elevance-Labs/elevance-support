/**
 * The Conversation tab: the email thread with a ticket's requester.
 *
 * Everyone who can see the ticket reads the thread. Only someone with the
 * `can_email` grant gets a composer, and what it sends is a draft handed to
 * the `email-send` function — never an email the browser assembles itself.
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
const { captured, FIXTURES } = await import('./mockSupabase.js')
const ConversationThread = (await import('../src/components/ConversationThread')).default

const { check, done } = reporter()
const [ada, grace] = FIXTURES.profiles
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const setValue = (node, value) => act(async () => {
  const proto = node.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
  node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})

async function render(profile, issue = FIXTURES.issue) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter>
        <AuthContext.Provider value={{ session: {}, profile, loading: false }}>
          <ConfigProvider>
            <ConversationThread issue={issue} ticketRef="ACME-42" />
          </ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await settle()
  return el
}

const box = () => D.querySelector('[data-rich-text-editor]')
// What a person typing into the box amounts to: the browser rewrites the
// editable region, then fires `input`.
const typeHtml = (html) => act(async () => {
  box().innerHTML = html
  box().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const sendButton = () => [...D.querySelectorAll('button')]
  .find((b) => /Send email|Sending/.test(b.textContent))
const tiles = () => [...D.querySelectorAll('[data-attachment-name]')].map((t) => t.textContent)
const text = () => D.body.textContent

// ============================================================
// Without the grant: the thread, and nothing to send with
// ============================================================
await render(grace)
check('the thread is there for anyone who can see the ticket',
  text().includes('Chrome, latest.') && text().includes('Which browser are you using?'))
check('newest first, as comments are',
  text().indexOf('Thanks — trying it now.') < text().indexOf('Chrome, latest.')
  && text().indexOf('Chrome, latest.') < text().indexOf('Which browser are you using?'))
check('a reply shows what the customer wrote, not the quoted history',
  !text().includes('> Which browser'))
check('no composer without the grant', !box() && !sendButton())
check('and it says who to ask', text().includes('Ask an admin'))

const kinds = [...D.querySelectorAll('[data-email-message]')].map((p) => p.getAttribute('data-email-message'))
check('sent and received are told apart', kinds.join() === 'outbound,inbound,outbound', kinds.join())
check('a delivered send says so', text().includes('Delivered'))
check('a bounced send says so, rather than failing silently', text().includes('Not delivered'))
check('a received email names who sent it', text().includes('Jane') && text().includes('jane@acme.com'))
check('and who else was copied', text().includes('Cc boss@acme.com'))
check('a reply does not repeat the earlier thread inside its card',
  ![...D.querySelectorAll('[data-email-message="inbound"]')]
    .some((p) => p.textContent.includes('> Which browser')))
check('a file the customer sent that could not be kept is named',
  text().includes('invoice.xlsx'))
check("the email's own file is drawn with it", tiles().includes('console.png'), tiles().join(', '))
check("the request's and the comments' files are not",
  !tiles().includes('report.pdf') && !tiles().includes('staging.png'), tiles().join(', '))

// ============================================================
// With the grant
// ============================================================
const writer = { ...ada, can_email: true }
await render(writer)
check('the composer appears with the grant', Boolean(box()))
check('it says who the email goes to', text().includes('Jane <jane@acme.com>'))
check('and names the email "[REF] Ticket title" — the same on every reply',
  text().includes('[ACME-42] Cannot export invoice') && !text().includes('SubjectRe:'))
check('nothing to send until something is written', sendButton()?.disabled === true)
check('the box is a rich text box, with formatting tools',
  ['Bold', 'Italic', 'Underline', 'Bulleted list', 'Numbered list', 'Link']
    .every((l) => D.querySelector(`[aria-label="${l}"]`)))
const signature = () => D.querySelector('[data-email-signature]')
check('with no signature saved, the box shows the name the email is signed with',
  signature()?.textContent.includes('— Ada Lovelace'), signature()?.textContent)
check('the signature sits inside the box, under the text',
  Boolean(signature()?.closest('[data-rich-text-footer]'))
  && box().compareDocumentPosition(signature()) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
check('and cannot be typed into — it is outside the editable region',
  !box().contains(signature()) && signature().closest('[contenteditable="true"]') === null)
check('templates are offered here too', Boolean(D.querySelector('[aria-label="Insert template"]')))

const ccInput = [...D.querySelectorAll('input')].find((i) =>
  (i.getAttribute('placeholder') ?? '').startsWith('Optional'))
await typeHtml('<div>We have <b>shipped</b> a fix.</div><ul><li>Update the app</li></ul>'
  + '<div><span style="color:red" onclick="alert(1)">Thanks</span><script>alert(2)</script></div>')
await setValue(ccInput, 'boss@acme.com, not-an-address')
check('a bad Cc is named, and blocks the send',
  text().includes('Not an email address: not-an-address') && sendButton()?.disabled === true)
await setValue(ccInput, 'Boss@Acme.com')
check('a good one does not', sendButton()?.disabled === false)

captured.functionCalls.length = 0
await act(async () => { sendButton().click() })
await settle()
const call = captured.functionCalls.find((c) => c.name === 'email-send')
check('sending hands the draft to email-send', Boolean(call))
const sentDoc = call?.body.doc
check('with the ticket and the copied, and nothing it should decide itself',
  call?.body.issue_id === 'issue-1' && call?.body.cc.join() === 'boss@acme.com'
  && !('to' in (call?.body ?? {})) && !('subject' in (call?.body ?? {}))
  && !('signature' in (call?.body ?? {})),
  JSON.stringify(call?.body))
check('the text goes as a document, keeping its bold and its list',
  sentDoc?.blocks?.[0]?.runs?.map((r) => (r.b ? `*${r.text}*` : r.text)).join('')
    === 'We have *shipped* a fix.' 
  && sentDoc?.blocks?.[1]?.type === 'ul'
  && sentDoc?.blocks?.[1]?.items?.[0]?.[0]?.text === 'Update the app',
  JSON.stringify(sentDoc))
check('never as HTML — styles, handlers and scripts do not survive the reading',
  !JSON.stringify(call?.body).includes('<') && !JSON.stringify(call?.body).includes('alert')
  && !JSON.stringify(call?.body).includes('color'),
  JSON.stringify(call?.body))
check('the box empties once it has gone', box()?.textContent === '')

// ============================================================
// A saved signature
// ============================================================
await render({ ...writer, email_signature: { blocks: [
  { type: 'p', runs: [{ text: 'Ada', b: true }, { text: ' · Support' }] },
  { type: 'p', runs: [{ text: 'gideonsystem.com', href: 'https://gideonsystem.com' }] },
] } })
check('the saved signature is what the box shows', signature()?.textContent.includes('Ada · Support')
  && !signature()?.textContent.includes('—'), signature()?.textContent)
check('drawn with its formatting', Boolean(signature()?.querySelector('strong'))
  && signature()?.querySelector('a')?.getAttribute('href') === 'https://gideonsystem.com')

// A sent email is drawn from what it went as — formatting included.
const sentCard = [...D.querySelectorAll('[data-email-message="outbound"]')]
  .find((p) => p.textContent.includes('Which browser'))
check("a sent email's formatting shows in the thread", Boolean(sentCard?.querySelector('strong')),
  sentCard?.innerHTML.slice(0, 200))

// ============================================================
// Nobody to write to
// ============================================================
await render(writer, { ...FIXTURES.issue, requester_email: null })
check('a ticket with no requester email has no composer',
  !box() && text().includes('no requester email'))

done()
