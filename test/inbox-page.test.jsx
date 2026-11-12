/**
 * The Inbox: the selected project's email by person — the people on the
 * left, the conversation in the middle, who they are on the right.
 *
 * Contacts are kept here: renamed, annotated, given another address or one
 * moved between them — never one removed. A new email is always about a
 * ticket, and goes through `email-send` like any other, recipient named.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/inbox')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { captured, FIXTURES, rpcResults } = await import('./mockSupabase.js')
const Inbox = (await import('../src/pages/Inbox')).default

const { check, done } = reporter()

// A closed ticket of Jane's, long done: the Inbox must not load it until asked.
FIXTURES.issues.push({
  id: 'issue-9', number: 9, project_id: 'proj-1', title: 'Old export bug', status: 'Done',
  company: 'Acme', requester_name: 'Jane', requester_email: 'Jane@Acme.com',
  submitted_date: new Date(Date.now() - 40 * 86_400_000).toISOString(),
})
const [ada, grace] = FIXTURES.profiles
const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const click = (node) => act(async () => {
  node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 30))
})
const setValue = (node, value) => act(async () => {
  const proto = node.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
  node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
const button = (re) => [...D.querySelectorAll('button')].find((b) => re.test(b.textContent))
const options = () => [...D.querySelectorAll('[role="option"]')]
const text = () => D.body.textContent
const rows = () => [...D.querySelectorAll('[data-inbox-contact]')].map((r) => r.getAttribute('data-inbox-contact'))
const panel = () => D.querySelector('[data-contact-panel]')

async function render(profile) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/inbox']}>
        <AuthContext.Provider value={{ session: {}, profile, loading: false }}>
          <ConfigProvider><ProjectProvider><Inbox /></ProjectProvider></ConfigProvider>
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await settle(80)
}

// ============================================================
// Reading
// ============================================================
await render(grace)
check('three columns: people, conversation, details', Boolean(D.querySelector('[data-inbox-columns]'))
  && Boolean(panel()))
check('everyone the project has met, the last to email first',
  rows().join() === 'ct-jane,ct-boss,ct-ops', rows().join())
check("never another project's people", !rows().includes('ct-sam') && !text().includes('sam@globex.com'))
const janeRow = D.querySelector('[data-inbox-contact="ct-jane"]')
check('a person is listed under the name the team gave them', janeRow?.textContent.includes('Jane Doe'))
check('with how long ago the last email went, and which way',
  janeRow?.querySelector('[data-last-email="outbound"]')?.textContent === '10m',
  janeRow?.querySelector('[data-last-email]')?.textContent)
check('someone never emailed says so', D.querySelector('[data-inbox-contact="ct-ops"]')?.textContent.includes('No emails'))

check('the first person opens on a wide screen', Boolean(D.querySelector('[data-email-message]')))
const cards = [...D.querySelectorAll('[data-email-message]')]
check('the conversation is every email with them, newest first',
  cards.length === 3 && text().indexOf('Thanks — trying it now.') < text().indexOf('Which browser are you using?'))
check('each email names the ticket it is on',
  cards.every((c) => c.querySelector('[data-email-ticket="ACME-42"]')))
const dialog = () => D.querySelector('[role="dialog"]')
await click(D.querySelector('[data-email-ticket]'))
await settle(60)
check('clicking it opens the ticket over the Inbox — not on Issues',
  Boolean(dialog()?.textContent.includes('Cannot export invoice'))
  && Boolean(D.querySelector('[data-inbox-columns]')), dialog()?.textContent.slice(0, 120))
const closeTicket = async () => {
  await click(dialog()?.querySelector('[data-testid="CloseIcon"]')?.closest('button'))
  await settle(300)
}
await closeTicket()
check('and closing it leaves you where you were', !dialog() && Boolean(D.querySelector('[data-inbox-columns]')))
check('the bodies are read only for the open conversation',
  captured.reads.filter((t) => t === 'email_messages').length >= 2)

check('the details: their name, every address, their company',
  panel().querySelector('[data-contact-name]')?.textContent === 'Jane Doe'
  && panel().querySelector('[data-contact-email="jane@acme.com"]')
  && panel().querySelector('[data-contact-email="jane.doe@gmail.com"]')
  && panel().textContent.includes('Acme'))
check('an address is listed as just the address — the name is the contact\'s',
  panel().querySelector('[data-contact-email="jane.doe@gmail.com"]')?.textContent === 'jane.doe@gmail.com')
check('the notes the team keeps on them', D.querySelector('textarea[aria-label="Notes"]')?.value === 'Prefers email to calls.')
const ticketsIn = (kind) => [...(panel().querySelector(`[data-contact-tickets="${kind}"]`)
  ?.querySelectorAll('[data-contact-ticket]') ?? [])].map((t) => t.getAttribute('data-contact-ticket'))
check('their tickets first: the open ones they asked for',
  ticketsIn('own').join() === 'ACME-42', ticketsIn('own').join())
await click(panel().querySelector('[data-contact-ticket="ACME-42"] button'))
await settle(60)
check("a ticket in the contact's list opens there too", Boolean(dialog()?.textContent.includes('Cannot export invoice')))
await closeTicket()
check('a toggle between theirs and the ones they were copied on, with counts',
  Boolean(button(/^Their tickets · 1$/)) && Boolean(button(/^Copied on · 0$/)))
check('closed tickets are not loaded until asked for',
  !panel().textContent.includes('Old export bug') && Boolean(button(/Show closed tickets/)))
await click(button(/Show closed tickets/))
check('asking fetches their closed ones, under their tickets',
  ticketsIn('own').join() === 'ACME-42,ACME-9' && panel().querySelector('[data-closed-tickets]')
  && button(/^Their tickets · 2$/), ticketsIn('own').join())
await click(button(/^Copied on/))
check('and none they were only copied on', ticketsIn('copied').length === 0
  && panel().textContent.includes('Not on anyone else’s open tickets.'))
await click(button(/^Their tickets/))
check('an address can be moved or added — never removed',
  Boolean(D.querySelector('[aria-label="Move jane@acme.com"]'))
  && Boolean(D.querySelector('[aria-label="Add an email address"]'))
  && ![...panel().querySelectorAll('button')].some((b) => /remove|delete/i.test(b.getAttribute('aria-label') ?? b.textContent)))
check('no grant, no writing', !button(/Write email/))

// ---- by company ----
await click(button(/By company/))
const companies = [...D.querySelectorAll('[data-inbox-company]')].map((h) => h.getAttribute('data-inbox-company'))
check('people under their company, with nobody\'s last', companies.join() === 'Acme,No company', companies.join())

// ---- picking someone else ----
await click(D.querySelector('[data-inbox-contact="ct-boss"]'))
check('picking someone opens their conversation — the email he was copied on',
  D.querySelectorAll('[data-email-message]').length === 1 && text().includes('Chrome, latest.'))
check('and their details, under the name their contact has', panel().querySelector('[data-contact-name]')?.textContent === 'Boss')
check('another person starts again at their own tickets, nothing closed fetched',
  ticketsIn('own').length === 0 && Boolean(button(/Show closed tickets/)))
await click(button(/^Copied on/))
check("someone copied on another's ticket has it under Copied on",
  ticketsIn('copied').join() === 'ACME-42', ticketsIn('copied').join())
await click(D.querySelector('[data-inbox-contact="ct-jane"]'))

// ============================================================
// Keeping contacts
// ============================================================
captured.updates.length = 0
await click(D.querySelector('[aria-label="Rename contact"]'))
const nameInput = [...panel().querySelectorAll('input')].find((i) => i.value === 'Jane Doe')
await setValue(nameInput, '   ')
check('a contact cannot be left without a name', button(/^Save$/)?.disabled === true)
await setValue(nameInput, 'Jane Q. Doe')
await click(button(/^Save$/))
const rename = captured.updates.find((u) => u.table === 'contacts')
check('a rename writes the name, and only the name, to that contact',
  rename?.row?.name === 'Jane Q. Doe' && Object.keys(rename.row).join() === 'name'
  && rename.filters.some(([op, col, v]) => op === 'eq' && col === 'id' && v === 'ct-jane'),
  JSON.stringify(rename))

captured.updates.length = 0
await setValue(D.querySelector('textarea[aria-label="Notes"]'), 'Prefers email. Based in Lahore.')
await click(button(/Save notes/))
const noted = captured.updates.find((u) => u.table === 'contacts')
check('notes are saved to the contact', noted?.row?.notes === 'Prefers email. Based in Lahore.', JSON.stringify(noted))

// ---- adding an address that is someone else's ----
captured.rpcs.length = 0
rpcResults.move_contact_email = 'ct-jane'
const addBox = D.querySelector('[aria-label="Add an email address"]')
await setValue(addBox, 'not an address')
check('a bad address is named, and cannot be added', text().includes('Not an email address') && button(/^Add$/)?.disabled)
await setValue(addBox, 'Ops@Acme.com')
check('an address another contact has says it will move here', text().includes('Now under Ops Desk — adding moves it here.'))
await click(button(/^Add$/))
const added = captured.rpcs.find((r) => r.name === 'move_contact_email')
check('adding files the address under this contact', added?.args.p_email === 'ops@acme.com'
  && added?.args.p_contact === 'ct-jane' && added?.args.p_project === 'proj-1', JSON.stringify(added))

// ---- moving one of hers ----
captured.rpcs.length = 0
rpcResults.move_contact_email = 'ct-boss'
await click(D.querySelector('[aria-label="Move jane.doe@gmail.com"]'))
const target = D.querySelector('[role="dialog"] input')
await act(async () => {
  target.focus()
  target.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
await setValue(target, 'boss')
const offered = options().map((o) => o.textContent)
check('it can go to another contact', offered.some((o) => o.includes('boss@acme.com')), offered.join(' | '))
check('never to the one it is already under', !offered.some((o) => o.startsWith('Jane')), offered.join(' | '))
await click(options().find((o) => o.textContent.includes('boss@acme.com')))
await click(button(/^Move$/))
const moved = captured.rpcs.find((r) => r.name === 'move_contact_email')
check('moving files it under the contact picked', moved?.args.p_email === 'jane.doe@gmail.com'
  && moved?.args.p_contact === 'ct-boss', JSON.stringify(moved))

// ============================================================
// Writing
// ============================================================
await render({ ...ada, can_email: true })
await click(button(/Write email/))
const composer = D.querySelector('[data-inbox-composer]')
check('with the grant, an email can be written to them', Boolean(composer?.querySelector('[data-rich-text-editor]')))
const ticketInput = [...composer.querySelectorAll('input')].find((i) => i.value.startsWith('ACME-42'))
check('their open ticket is picked for it already', Boolean(ticketInput), [...composer.querySelectorAll('input')].map((i) => i.value).join(' | '))
await act(async () => {
  composer.querySelector('.MuiAutocomplete-popupIndicator')
    ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 30))
})
check('only open tickets are offered — a closed one is not loaded',
  options().length > 0 && !options().some((o) => o.textContent.includes('ACME-9')),
  options().map((o) => o.textContent).join(' | '))
await act(async () => {
  D.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
check('to the address that asked for it, under its subject',
  composer.textContent.includes('jane@acme.com') && composer.textContent.includes('[ACME-42] Cannot export invoice'))

captured.functionCalls.length = 0
const box = composer.querySelector('[data-rich-text-editor]')
await act(async () => {
  box.innerHTML = '<div>Following up on your export.</div>'
  box.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
await click(button(/Send email/))
const sent = captured.functionCalls.find((c) => c.name === 'email-send')
check('sending hands it to email-send, on the ticket and to the person',
  sent?.body.issue_id === 'issue-1' && sent?.body.to === 'jane@acme.com'
  && sent?.body.doc?.blocks?.[0]?.runs?.[0]?.text === 'Following up on your export.',
  JSON.stringify(sent?.body))
check('the box closes once it has gone', !D.querySelector('[data-inbox-composer]'))

// ---- nothing is sent without a ticket ----
await click(button(/Write email/))
const clear = D.querySelector('[data-inbox-composer] .MuiAutocomplete-clearIndicator')
await click(clear)
await act(async () => {
  const b = D.querySelector('[data-inbox-composer] [data-rich-text-editor]')
  b.innerHTML = '<div>Hello</div>'
  b.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
check('with no ticket picked, it cannot be sent',
  button(/Send email/)?.disabled === true && text().includes('Every email is filed on a ticket'))

done()
