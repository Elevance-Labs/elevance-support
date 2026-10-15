/**
 * Suggesting the addresses a project has met: in the email Cc, and in the
 * staff form's requester email. Never on the public form — the list is the
 * project's customers, and it is not readable without a session.
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
const IssueForm = (await import('../src/components/IssueForm')).default

const { check, done } = reporter()
const [ada, grace] = FIXTURES.profiles
const writer = { ...ada, can_email: true }
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const setValue = (node, value) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value)
  node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
const options = () => [...D.querySelectorAll('[role="option"]')]
const optionText = () => options().map((o) => o.textContent).join(' | ')
const pick = (text) => act(async () => {
  options().find((o) => o.textContent.includes(text))
    ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})

async function mount(ui, profile = writer) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter>
        <AuthContext.Provider value={{ session: {}, profile, loading: false }}>
          <ConfigProvider>{ui}</ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await settle()
}

// ============================================================
// The Cc
// ============================================================
await mount(<ConversationThread issue={FIXTURES.issue} ticketRef="ACME-42" />)
const ccInput = () => [...D.querySelectorAll('input')]
  .find((i) => (i.getAttribute('placeholder') ?? '').startsWith('Optional'))

const focus = (node) => act(async () => {
  node.focus()
  node.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
await focus(ccInput())
check('an empty Cc box suggests nothing', options().length === 0, optionText())

await setValue(ccInput(), 'ACME')
check('typing in the Cc offers the project\'s addresses, ignoring case',
  optionText().includes('boss@acme.com') && optionText().includes('Ops Desk <ops@acme.com>'),
  optionText())
check('never the requester — she is already on the To line', !optionText().includes('jane@acme.com'),
  optionText())
check("never another project's addresses", !optionText().includes('sam@globex.com'), optionText())

await pick('boss@acme.com')
check('picking one completes the address being typed', ccInput().value === 'boss@acme.com, ',
  ccInput().value)
check('and, with nothing new typed after it, nothing more is suggested', options().length === 0,
  optionText())

await setValue(ccInput(), 'boss@acme.com, o')
check('the next suggestion leaves out who is already copied',
  optionText().includes('ops@acme.com') && !optionText().includes('boss@acme.com'), optionText())
await pick('ops@acme.com')
check('and adds to the line', ccInput().value === 'boss@acme.com, ops@acme.com, ', ccInput().value)

captured.functionCalls.length = 0
const box = D.querySelector('[data-rich-text-editor]')
await act(async () => {
  box.innerHTML = '<div>Copying the team.</div>'
  box.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
await act(async () => {
  [...D.querySelectorAll('button')].find((b) => b.textContent === 'Send email').click()
})
await settle()
const call = captured.functionCalls.find((c) => c.name === 'email-send')
check('the picked addresses go as the Cc',
  call?.body.cc.join() === 'boss@acme.com,ops@acme.com', JSON.stringify(call?.body.cc))

// Without the grant there is no Cc to suggest into, and no reason to read.
captured.reads.length = 0
await mount(<ConversationThread issue={FIXTURES.issue} ticketRef="ACME-42" />, grace)
check('no grant, no read of the addresses', !captured.reads.includes('project_contacts'),
  captured.reads.join())

// ============================================================
// The staff form's requester email
// ============================================================
const inputFor = (label) => {
  const lab = [...D.querySelectorAll('label')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  return lab && D.getElementById(lab.getAttribute('for'))
}

await mount(<IssueForm staff projectId="proj-1" />)
await focus(inputFor('Requester email'))
check('an empty requester email suggests nothing', options().length === 0, optionText())
await setValue(inputFor('Requester email'), 'J')
check('one character is enough to suggest', optionText().includes('jane@acme.com'), optionText())
await setValue(inputFor('Requester email'), 'Jane')
check('the requester email suggests the project\'s addresses',
  optionText().includes('Jane <jane@acme.com>'), optionText())
check("not another project's", !optionText().includes('sam@globex.com'), optionText())
await pick('jane@acme.com')
check('picking one fills the address', inputFor('Requester email').value === 'jane@acme.com',
  inputFor('Requester email').value)
check('and the name it is known by, when none was typed',
  inputFor('Requester name').value === 'Jane', inputFor('Requester name').value)

await mount(<IssueForm staff projectId="proj-1" />)
await setValue(inputFor('Requester name'), 'Mr Boss')
await setValue(inputFor('Requester email'), 'ops')
await pick('ops@acme.com')
check('a typed name is never overwritten', inputFor('Requester name').value === 'Mr Boss',
  inputFor('Requester name').value)

await mount(<IssueForm staff projectId="proj-1" />)
await setValue(inputFor('Requester email'), 'new.person@acme.com')
check('a new address can still be typed freely',
  inputFor('Requester email').value === 'new.person@acme.com' && options().length === 0,
  `${inputFor('Requester email').value} / ${optionText()}`)

// ============================================================
// The public form
// ============================================================
captured.reads.length = 0
await mount(<IssueForm projectId="proj-1" />, null)
await setValue(inputFor('Requester email'), 'jane')
check('the public form never reads the addresses', !captured.reads.includes('project_contacts'),
  captured.reads.join())
check('and suggests nothing', options().length === 0, optionText())

done()
