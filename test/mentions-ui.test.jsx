/**
 * @mentions in the comment box: typing "@" offers the people who can see the
 * ticket, a pick becomes one "@Name" the posted comment carries as a mention,
 * and a posted mention is drawn as one. The email box offers nobody.
 *
 * Rendered as Ada, on ACME-42, with Grace and Kay offered.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')
const D = dom.window.document
const W = dom.window

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { captured, FIXTURES } = await import('./mockSupabase.js')
const CommentsThread = (await import('../src/components/CommentsThread')).default
const RichTextEditor = (await import('../src/components/RichTextEditor')).default
const { mentionedIds } = await import('../src/lib/richText.js')

const { check, done } = reporter()
const [ada, grace, kay] = FIXTURES.profiles

// A posted comment that mentions Grace, to see how one is drawn.
FIXTURES.comments.push({
  id: 'c-m', issue_id: 'issue-1', author_id: 'user-1', body: '@Grace Hopper please look',
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  body_doc: { blocks: [{ type: 'p', runs: [{ text: '@Grace Hopper', mention: 'user-2' }, { text: ' please look' }] }] },
})

const el = D.createElement('div')
D.body.appendChild(el)
let emailDoc = null
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter>
      <AuthContext.Provider value={{ session: {}, profile: ada, loading: false }}>
        <ConfigProvider>
          <CommentsThread issueId="issue-1" mentionables={[grace, kay]} />
          <RichTextEditor ariaLabel="Email" onChange={(d) => { emailDoc = d }} />
        </ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
await settle()

const composer = () => D.querySelector('[data-rich-text-editor][aria-label="Add a comment…"]')
const options = () => [...D.querySelectorAll('[role="listbox"][aria-label="People to mention"] [role="option"]')]

/** Types `text` as the box's only line, with the caret at its end. */
const typeText = (box, text) => act(async () => {
  box.innerHTML = ''
  const line = D.createElement('div')
  const node = D.createTextNode(text)
  line.appendChild(node)
  box.appendChild(line)
  box.focus()
  const range = D.createRange()
  range.setStart(node, text.length)
  range.collapse(true)
  const sel = D.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  box.dispatchEvent(new W.Event('input', { bubbles: true }))
})
const key = (box, k) => act(async () => {
  box.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
})

// ---------- reading ----------
const drawn = D.querySelector('.MuiPaper-root [data-mention="user-2"]')
check('a posted mention is drawn as one', drawn?.textContent === '@Grace Hopper')
check('the box says how to mention', composer()?.parentElement?.textContent.includes('type @ to mention someone'))

// ---------- offering ----------
await typeText(composer(), 'Thanks @')
check('"@" offers the people who can see the ticket', options().length === 2, String(options().length))
await typeText(composer(), 'Thanks @gr')
check('typing narrows it', options().length === 1 && options()[0].textContent.includes('Grace Hopper'))
await typeText(composer(), 'Thanks @nobody')
check('no match, no list', options().length === 0)
await typeText(composer(), 'mail grace@co.com')
check('an email address offers nobody', options().length === 0)

// ---------- picking with the keyboard ----------
await typeText(composer(), 'Thanks @')
await key(composer(), 'ArrowDown')
check('the arrows move through the names', options()[1]?.getAttribute('aria-selected') === 'true')
await key(composer(), 'ArrowUp')
await typeText(composer(), 'Thanks @k')
await key(composer(), 'Enter')
const span = composer().querySelector('[data-mention]')
check('Enter puts the person in', span?.getAttribute('data-mention') === 'user-3' && span.textContent === '@Kay Antonelli')
check('as one uneditable piece', span?.getAttribute('contenteditable') === 'false')
check('the typed "@k" is gone', !composer().textContent.includes('@k@') && composer().textContent.startsWith('Thanks @Kay'))
check('and the list closes', options().length === 0)

// ---------- picking with the mouse ----------
const box = composer()
await act(async () => {
  const sel = D.getSelection()
  const tail = D.createTextNode(' and @gra')
  box.lastChild.appendChild(tail)
  const r = D.createRange()
  r.setStart(tail, tail.length)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  box.dispatchEvent(new W.Event('input', { bubbles: true }))
})
await act(async () => { options()[0]?.click() })
check('a click puts the person in too',
  [...box.querySelectorAll('[data-mention]')].map((s) => s.getAttribute('data-mention')).join() === 'user-3,user-2')

// ---------- Escape ----------
await typeText(composer(), 'x @')
await key(composer(), 'Escape')
check('Escape closes the list', options().length === 0)

// ---------- posting ----------
await typeText(composer(), 'Ping @gr')
await key(composer(), 'Tab')
await act(async () => {
  [...D.querySelectorAll('button')].find((b) => b.textContent === 'Comment').click()
})
await settle()
const posted = captured.inserts.filter((i) => i.table === 'comments').at(-1)?.row
check('the posted comment carries the mention', JSON.stringify(mentionedIds(posted?.body_doc)) === '["user-2"]',
  JSON.stringify(posted?.body_doc))
check('and its plain text reads naturally', posted?.body?.startsWith('Ping @Grace Hopper'), JSON.stringify(posted?.body))

// ---------- the email box ----------
const email = D.querySelector('[data-rich-text-editor][aria-label="Email"]')
await typeText(email, 'Hi @gr')
check('the email box offers nobody', options().length === 0)
await act(async () => {
  email.innerHTML = '<div><span data-mention="user-2" contenteditable="false">@Grace Hopper</span> pasted</div>'
  email.dispatchEvent(new W.Event('input', { bubbles: true }))
})
check('and a mention pasted into it is just text',
  mentionedIds(emailDoc).length === 0 && emailDoc.blocks[0].runs[0].text.startsWith('@Grace Hopper'))

done()
