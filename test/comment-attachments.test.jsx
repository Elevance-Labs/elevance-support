/**
 * A comment may carry files — an image, a PDF or a video — under the same
 * rules as a request: picked or pasted, checked before anything uploads, and
 * drawn under the comment they belong to rather than on the request.
 *
 * Rendered as Grace, whose comment `c2` is thirty seconds old: still inside
 * her edit window, so deleting it is hers to do — and so is tidying its files.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

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
const D = dom.window.document
global.confirm = dom.window.confirm = () => true

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

const tiles = () => [...D.querySelectorAll('[data-attachment-name]')].map((t) => t.textContent)
const errorText = () => D.querySelector('.MuiAlert-message')?.textContent ?? ''
const postButton = () => [...D.querySelectorAll('button')].find((b) => b.textContent === 'Comment')
const composer = () => [...D.querySelectorAll('textarea')]
  .find((t) => t.getAttribute('placeholder') === 'Add a comment…')

const fakeFile = (name, type, size = 1000) => {
  const f = new dom.window.File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
async function pick(files) {
  const input = D.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
}
async function paste(file) {
  const ev = new dom.window.Event('paste', { bubbles: true })
  ev.clipboardData = { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] }
  await act(async () => { composer().dispatchEvent(ev) })
}
const click = async (node) => {
  await act(async () => { node.click() })
  await settle()
}

// ---- what is already there ----
const text = () => el.textContent
check('the newest comment is on top',
  text().indexOf('Just posted.') < text().indexOf('Looking into this.'))
check('and the composer sits above the thread, where a new comment will land',
  composer().compareDocumentPosition(
    [...el.querySelectorAll('p')].find((p) => p.textContent === 'Just posted.'),
  ) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
check("a comment's file is drawn in the thread", tiles().includes('staging.png'), tiles().join(', '))
check("the request's own file is not — it belongs above the thread",
  !tiles().includes('report.pdf'), tiles().join(', '))
check('the file is signed, not linked raw',
  [...D.querySelectorAll('img')].some((i) => i.src === 'https://signed.example/issue-1/att-2-staging.png'))

// ---- the same gate as the request form ----
await pick([fakeFile('macro.exe', 'application/x-msdownload')])
check('an unsupported type is refused', /not a PDF, image or video/.test(errorText()), errorText())
check('and nothing is queued for it', tiles().length === 1, tiles().join(', '))

await pick([fakeFile('huge.png', 'image/png', 11 * 1024 * 1024)])
check('an oversized image is refused', /larger than 10MB/.test(errorText()), errorText())

check('with no text and no file there is nothing to post', postButton().disabled)

// ---- a file alone is a comment ----
await pick([fakeFile('walkthrough.mp4', 'video/mp4', 25 * 1024 * 1024)])
check('a video under 30MB is queued', tiles().includes('walkthrough.mp4'), tiles().join(', '))
check('a file with no text can be posted', !postButton().disabled)

await click(postButton())
const comment = captured.inserts.filter((i) => i.table === 'comments').at(-1)?.row
check('the comment is posted', Boolean(comment?.id), JSON.stringify(comment))
check('with an empty body', comment?.body === '', JSON.stringify(comment))
const upload = captured.uploads.at(-1)
check('the file goes to the private attachments bucket', upload?.bucket === 'attachments', JSON.stringify(upload))
check("under the ticket's folder", upload?.path.startsWith('issue-1/'), upload?.path)
const row = captured.inserts.filter((i) => i.table === 'attachments').at(-1)?.row
check('the file is recorded against the comment', row?.comment_id === comment?.id, JSON.stringify(row))
check('and against its ticket, so reads follow the ticket', row?.issue_id === 'issue-1')
check('with its name, type and size',
  row?.file_name === 'walkthrough.mp4' && row?.mime_type === 'video/mp4' && row?.size_bytes === 25 * 1024 * 1024,
  JSON.stringify(row))
check('the composer is cleared afterwards', !tiles().includes('walkthrough.mp4'), tiles().join(', '))

// ---- a screenshot pasted into the box ----
await paste(fakeFile('image.png', 'image/png'))
check('a pasted screenshot is queued, renamed',
  tiles().some((t) => /^pasted-.*\.png$/.test(t)), tiles().join(', '))

// ---- deleting a comment tidies its files ----
const deleteButton = D.querySelector('[aria-label="Delete"]')
check('Grace may delete her fresh comment', Boolean(deleteButton))
await click(deleteButton)
check('the comment is deleted', captured.deletes.some((d) => d.table === 'comments'))
const removed = captured.removals.at(-1)
check("and its stored files go with it",
  removed?.bucket === 'attachments' && removed?.paths.join() === 'issue-1/att-2-staging.png',
  JSON.stringify(removed))

done()
