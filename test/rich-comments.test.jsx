/**
 * Comments are rich text, as the email box is: bold, italic, underline, lists
 * and links, posted as a document with its plain text beside it.
 *
 * Comments written before that are plain text, and must read, and edit, as
 * they always did. Rendered as Grace, whose plain comment `c2` is thirty
 * seconds old — still hers to edit.
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
const CommentsThread = (await import('../src/components/CommentsThread')).default

const { check, done } = reporter()
const grace = FIXTURES.profiles[1]

// One comment written as rich text, beside the two plain ones.
FIXTURES.comments.push({
  id: 'c3', issue_id: 'issue-1', author_id: 'user-1',
  body: 'Root cause:\n• Stale cache', created_at: new Date(Date.now() - 3600_000).toISOString(),
  body_doc: { blocks: [
    { type: 'p', runs: [{ text: 'Root cause', b: true }, { text: ':' }] },
    { type: 'ul', items: [[{ text: 'Stale cache' }]] },
  ] },
})

const el = D.createElement('div')
D.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter>
      <AuthContext.Provider value={{ session: {}, profile: grace, loading: false }}>
        <ConfigProvider><CommentsThread issueId="issue-1" /></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
await settle()

const composer = () => D.querySelector('[data-rich-text-editor][aria-label="Add a comment…"]')
const typeHtml = (box, html) => act(async () => {
  box.innerHTML = html
  box.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const click = async (node) => {
  await act(async () => { node.click() })
  await settle()
}
const button = (text) => [...D.querySelectorAll('button')].find((b) => b.textContent === text)

// ---- reading ----
check('a plain comment reads as the text it always was',
  [...D.querySelectorAll('p')].some((p) => p.textContent === 'Looking into this.'))
const rich = [...D.querySelectorAll('strong')].find((s) => s.textContent === 'Root cause')
check('a rich comment is drawn with its formatting', Boolean(rich)
  && rich.closest('.MuiPaper-root')?.querySelector('ul li')?.textContent === 'Stale cache')

// ---- writing ----
check('the comment box has the formatting tools',
  ['Bold', 'Italic', 'Underline', 'Bulleted list', 'Numbered list', 'Link']
    .every((l) => D.querySelector(`[aria-label="${l}"]`)))
await typeHtml(composer(), '<div>Deployed <b>2.4.1</b>, see <a href="https://status.example">status</a></div>'
  + '<ol><li>Clear cache</li></ol><div style="color:red" onclick="alert(1)">Ping me</div>')
await click(button('Comment'))
const posted = captured.inserts.filter((i) => i.table === 'comments').at(-1)?.row
check('posts the document', posted?.body_doc?.blocks?.[0]?.runs?.some((r) => r.b && r.text === '2.4.1')
  && posted.body_doc.blocks[0].runs.some((r) => r.href === 'https://status.example')
  && posted.body_doc.blocks[1]?.type === 'ol', JSON.stringify(posted?.body_doc))
check('with its plain text beside it',
  posted?.body === 'Deployed 2.4.1, see status (https://status.example)\n1. Clear cache\nPing me',
  JSON.stringify(posted?.body))
check('never as HTML', !JSON.stringify(posted).includes('<') && !JSON.stringify(posted).includes('alert')
  && !JSON.stringify(posted).includes('color'), JSON.stringify(posted))
check('the box empties once posted', composer().textContent === '', composer().textContent)

// ---- editing a comment from before rich text ----
const mine = [...D.querySelectorAll('p')].find((p) => p.textContent === 'Just posted.')
  .closest('.MuiPaper-root')
await click(mine.querySelector('[aria-label="Edit"]'))
const editBox = D.querySelector('[data-rich-text-editor][aria-label="Edit comment"]')
check('editing opens the text in a rich text box', editBox?.textContent === 'Just posted.',
  editBox?.textContent)
await typeHtml(editBox, '<div>Just posted, <i>and fixed</i>.</div>')
await click(button('Save'))
const updated = captured.updates.filter((u) => u.table === 'comments').at(-1)?.row
check('saving it writes a document, and its text',
  updated?.body === 'Just posted, and fixed.'
  && updated?.body_doc?.blocks?.[0]?.runs?.some((r) => r.i && r.text === 'and fixed'),
  JSON.stringify(updated))

done()
