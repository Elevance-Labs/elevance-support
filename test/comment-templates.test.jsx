/**
 * Comment templates: managed under Configuration → Templates, offered under the
 * comment box.
 *
 * Picking one only writes its text into the box. It must never post, and never
 * throw away what the author had already typed — the template is a starting
 * point they still edit and send themselves.
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
      <ConfigProvider><Configuration /></ConfigProvider>
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

// ---- add one ----
await click([...cfg.querySelectorAll('button')].find((b) => b.textContent === 'Add Template'))
const dialog = D.querySelector('[role="dialog"]')
check('Add Template opens a dialog', dialog?.textContent.startsWith('Add Template'),
  dialog?.textContent.slice(0, 40))
const titleInput = dialog.querySelector('input:not([type="number"]):not([type="checkbox"])')
const bodyInput = dialog.querySelector('textarea:not([aria-hidden])')
const saveBtn = () => [...D.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Save')

await setValue(titleInput, 'Closing')
await click(saveBtn())
check('a template with no text is refused before it is sent',
  !captured.inserts.some((i) => i.table === 'comment_templates'),
  JSON.stringify(captured.inserts))

await setValue(bodyInput, '  Closing this ticket now.  ')
await click(saveBtn())
const inserted = captured.inserts.find((i) => i.table === 'comment_templates')?.row
check('saves into comment_templates, not list_items', Boolean(inserted),
  JSON.stringify(captured.inserts))
check('saves the title', inserted?.title === 'Closing', JSON.stringify(inserted))
check('saves the text, trimmed', inserted?.body === 'Closing this ticket now.', JSON.stringify(inserted))
check('a new template is active', inserted?.is_active === true, JSON.stringify(inserted))

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

const composer = [...el.querySelectorAll('textarea')]
  .find((t) => t.getAttribute('placeholder') === 'Add a comment…')
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
check('copying leaves the comment box alone', composer.value === '', JSON.stringify(composer.value))
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
  composer.value === 'Could you send a screenshot of the error?', composer.value)
check('picking does not post', commentInserts().length === 0, JSON.stringify(commentInserts()))
check('the picker goes back to its prompt', picker()?.textContent.includes('Insert template'),
  picker()?.textContent)

// ---- into a draft: inserted at the caret, nothing lost ----
await setValue(composer, 'Hi Sam,\n\nThanks.')
composer.setSelectionRange(8, 8)
await pick('Fixed')
check('inserts at the caret, keeping the draft around it',
  composer.value === 'Hi Sam,\nThis is fixed and will ship in the next release.\nThanks.',
  JSON.stringify(composer.value))

// ---- still the author's to edit and post ----
await setValue(composer, composer.value + ' Cheers')
await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Comment'))
await settle()
const posted = commentInserts().at(-1)?.row
check('the edited text is what gets posted',
  posted?.body === 'Hi Sam,\nThis is fixed and will ship in the next release.\nThanks. Cheers',
  JSON.stringify(posted))

done()
