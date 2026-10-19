/**
 * Comment templates: managed under Configuration → Templates, offered under the
 * comment box.
 *
 * Picking one only writes its text into the box. It must never post, and never
 * throw away what the author had already typed — the template is a starting
 * point they still edit and send themselves.
 *
 * A template is rich text, like the comment it starts. One saved before that
 * is plain text, and must still list, insert, copy and edit as it always did.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/config')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { captured, FIXTURES } = await import('./mockSupabase.js')
const Configuration = (await import('../src/pages/Configuration')).default
const CommentsThread = (await import('../src/components/CommentsThread')).default

const { check, done } = reporter()
const [ada] = FIXTURES.profiles
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const click = (node) => act(async () => {
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
// What typing into a rich text box amounts to: the browser rewrites the
// editable region, then fires `input`.
const typeHtml = (box, html) => act(async () => {
  box.innerHTML = html
  box.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const setValue = (node, value) => act(async () => {
  const proto = node.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
  node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})

// ============================================================
// Configuration → Templates
// ============================================================
const cfg = D.createElement('div')
D.body.appendChild(cfg)
const cfgRoot = createRoot(cfg)
await act(async () => {
  cfgRoot.render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/config']}>
      <AuthContext.Provider value={{ session: {}, profile: ada, loading: false }}>
        <ConfigProvider><Configuration /></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
await settle()

const templatesTab = [...cfg.querySelectorAll('[role="tab"]')]
  .find((t) => t.textContent.trim() === 'Templates')
check('Configuration has a Templates tab', Boolean(templatesTab))
await click(templatesTab)

const heads = [...cfg.querySelectorAll('thead th')].map((h) => h.textContent.trim())
check('Templates table shows title and text', heads.includes('Title') && heads.includes('Text'),
  heads.join(', '))
check('Templates table has no Colour column', !heads.includes('Colour'), heads.join(', '))
const rows = [...cfg.querySelectorAll('tbody tr')].map((r) => r.textContent)
check('lists each template by title', rows.some((r) => r.includes('Need more info')), rows.join(' | '))
check('shows the template text', rows.some((r) => r.includes('send a screenshot')), rows.join(' | '))
check('inactive templates are still listed here', rows.some((r) => r.includes('Retired reply')),
  rows.join(' | '))
const richRow = [...cfg.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Workaround'))
check('a rich template is listed with its formatting',
  richRow?.querySelector('strong')?.textContent === 'this' && Boolean(richRow?.querySelector('ul li')),
  richRow?.innerHTML)

// ---- add one ----
await click([...cfg.querySelectorAll('button')].find((b) => b.textContent === 'Add Template'))
const dialog = D.querySelector('[role="dialog"]')
check('Add Template opens a dialog', dialog?.textContent.startsWith('Add Template'),
  dialog?.textContent.slice(0, 40))
const titleInput = dialog.querySelector('input:not([type="number"]):not([type="checkbox"])')
const bodyInput = dialog.querySelector('[data-rich-text-editor][aria-label="Template text"]')
check('the text is a rich text box, with formatting tools',
  Boolean(bodyInput) && ['Bold', 'Bulleted list', 'Link']
    .every((l) => dialog.querySelector(`[aria-label="${l}"]`)))
const saveBtn = () => [...D.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Save')

await setValue(titleInput, 'Closing')
await click(saveBtn())
check('a template with no text is refused before it is sent',
  !captured.inserts.some((i) => i.table === 'comment_templates'),
  JSON.stringify(captured.inserts))

await typeHtml(bodyInput, '<div>  <b>Closing</b> this ticket now.  </div>'
  + '<ul><li>Reopen it any time</li></ul><script>alert(1)</script>')
await click(saveBtn())
const inserted = captured.inserts.find((i) => i.table === 'comment_templates')?.row
check('saves into comment_templates, not list_items', Boolean(inserted),
  JSON.stringify(captured.inserts))
check('saves the title', inserted?.title === 'Closing', JSON.stringify(inserted))
check('saves the formatting as a document',
  inserted?.body_doc?.blocks?.[0]?.runs?.[0]?.text === 'Closing' && inserted.body_doc.blocks[0].runs[0].b === true
  && inserted.body_doc.blocks[1]?.type === 'ul',
  JSON.stringify(inserted?.body_doc))
check('and its plain text beside it, trimmed',
  inserted?.body === 'Closing this ticket now.\n• Reopen it any time', JSON.stringify(inserted?.body))
check('never as HTML', !JSON.stringify(inserted).includes('<') && !JSON.stringify(inserted).includes('alert'),
  JSON.stringify(inserted))
check('a new template is active', inserted?.is_active === true, JSON.stringify(inserted))

// ---- a template from before rich text opens as its text, and saves as a document ----
await settle()
const legacyRow = [...cfg.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Need more info'))
await click(legacyRow.querySelector('[aria-label="Edit template"]'))
const editBox = D.querySelector('[role="dialog"] [data-rich-text-editor]')
check('a plain-text template opens with its text in the box',
  editBox?.textContent === 'Could you send a screenshot of the error?', editBox?.textContent)
await click(saveBtn())
const updated = captured.updates.filter((u) => u.table === 'comment_templates').at(-1)?.row
check('and saves back unchanged in text, now with a document',
  updated?.body === 'Could you send a screenshot of the error?'
  && updated?.body_doc?.blocks?.[0]?.runs?.[0]?.text === 'Could you send a screenshot of the error?',
  JSON.stringify(updated))

await act(async () => { cfgRoot.unmount() })
cfg.remove()

// ============================================================
// The comment box
// ============================================================
const el = D.createElement('div')
D.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter>
      <AuthContext.Provider value={{ session: {}, profile: ada, loading: false }}>
        <ConfigProvider><CommentsThread issueId="issue-1" /></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
await settle()

const composer = el.querySelector('[data-rich-text-editor][aria-label="Add a comment…"]')
const picker = () => el.querySelector('[aria-label="Insert template"]')
  ?.closest('.MuiInputBase-root')?.querySelector('[role="combobox"]')
const commentInserts = () => captured.inserts.filter((i) => i.table === 'comments')

const openPicker = async () => {
  await act(async () => {
    picker().dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  return [...D.querySelectorAll('[role="option"]')]
}
const pick = async (title) => {
  const option = (await openPicker()).find((o) => o.textContent.trim() === title)
  await click(option)
  await settle()
}

check('a template picker sits under the comment box', Boolean(picker()))
check('the picker reads as an action, not a value',
  picker()?.textContent.includes('Insert template'), picker()?.textContent)

const offered = (await openPicker()).map((o) => o.textContent.trim())
check('offers the active templates by title',
  offered.includes('Need more info') && offered.includes('Fixed'), offered.join(', '))
check('does not offer an inactive template', !offered.includes('Retired reply'), offered.join(', '))

// ---- each option carries a copy button that copies, and does nothing else ----
const clipboard = []
Object.defineProperty(dom.window.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (text) => { clipboard.push(text) } },
})
const copyBtn = D.querySelector('[role="option"] button[aria-label="Copy Fixed"]')
check('each option has a copy button', Boolean(copyBtn))
await click(copyBtn)
await settle()
check('the copy button copies the template text',
  clipboard.at(-1) === 'This is fixed and will ship in the next release.', JSON.stringify(clipboard))
check('copying leaves the comment box alone', composer.textContent === '', composer.textContent)
check('copying keeps the menu open', D.querySelectorAll('[role="option"]').length > 0)
check('copying posts nothing', commentInserts().length === 0, JSON.stringify(commentInserts()))
check('the button confirms the copy',
  D.querySelector('[role="option"] button[aria-label="Copy Fixed"]')?.classList.contains('copied'))
await act(async () => {
  D.activeElement?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
await settle()

// ---- into an empty box ----
await pick('Need more info')
check('picking writes the template text into the box',
  composer.textContent === 'Could you send a screenshot of the error?', composer.textContent)
check('picking does not post', commentInserts().length === 0, JSON.stringify(commentInserts()))
check('the picker goes back to its prompt', picker()?.textContent.includes('Insert template'),
  picker()?.textContent)

// ---- into a draft: inserted at the caret, nothing lost ----
await typeHtml(composer, '<div>Hi Sam,</div><div><br></div><div>Thanks.</div>')
await act(async () => {
  // The caret on the blank line, as the browser reports it.
  const range = D.createRange()
  range.setStart(composer.children[1], 0)
  range.collapse(true)
  const sel = D.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  D.dispatchEvent(new dom.window.Event('selectionchange'))
})
await pick('Fixed')
const lines = () => [...composer.children].map((c) => c.textContent)
check('inserts at the caret, keeping the draft around it',
  lines().join('|') === 'Hi Sam,|This is fixed and will ship in the next release.|Thanks.',
  lines().join('|'))

// ---- still the author's to edit and post ----
await typeHtml(composer, composer.innerHTML.replace('Thanks.', 'Thanks. Cheers'))
await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Comment'))
await settle()
const posted = commentInserts().at(-1)?.row
check('the edited text is what gets posted',
  posted?.body === 'Hi Sam,\nThis is fixed and will ship in the next release.\nThanks. Cheers',
  JSON.stringify(posted))

// ---- a rich template keeps its formatting in the box ----
await pick('Workaround')
check('a rich template lands with its bold', composer.querySelector('strong')?.textContent === 'this',
  composer.innerHTML)
check('and its list', composer.querySelector('ul li')?.textContent === 'Clear the cache', composer.innerHTML)
await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Comment'))
await settle()
const richPost = commentInserts().at(-1)?.row
check('and is posted as a document, formatting included',
  richPost?.body_doc?.blocks?.[0]?.runs?.some((r) => r.b && r.text === 'this')
  && richPost?.body_doc?.blocks?.[1]?.type === 'ul'
  && richPost?.body === 'Try this:\n• Clear the cache',
  JSON.stringify(richPost))

// ---- copying a rich template still gives its words ----
await openPicker()
await click(D.querySelector('[role="option"] button[aria-label="Copy Workaround"]'))
check('copying a rich template copies its text', clipboard.at(-1) === 'Try this:\n• Clear the cache',
  JSON.stringify(clipboard))

done()
