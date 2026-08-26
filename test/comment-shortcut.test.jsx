/**
 * Ctrl+Enter / Cmd+Enter posts a comment.
 *
 * The chord has to do what the button does — and nothing else has to change:
 * a plain Enter still types a newline, because a comment is a multi-line box
 * and stealing Enter would make it useless.
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
const [ada] = FIXTURES.profiles

const el = dom.window.document.createElement('div')
dom.window.document.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter>
      <AuthContext.Provider value={{ session: {}, profile: ada, loading: false }}>
        <ConfigProvider><CommentsThread issueId="issue-1" /></ConfigProvider>
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
await settle()

const composer = [...el.querySelectorAll('textarea')]
  .find((t) => t.getAttribute('placeholder') === 'Add a comment…')
check('composer is a multiline box', Boolean(composer))

const type = async (text) => {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => {
    setter.call(composer, text)
    composer.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
const press = async (init) => {
  await act(async () => {
    composer.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true, ...init,
    }))
  })
  await settle()
}
const commentInserts = () => captured.inserts.filter((i) => i.table === 'comments')

// ---- a plain Enter is still a newline ----
await type('first line')
await press({})
check('plain Enter does not post', commentInserts().length === 0,
  JSON.stringify(commentInserts()))
check('plain Enter leaves the draft alone', composer.value === 'first line', composer.value)

// ---- the chord posts ----
await press({ ctrlKey: true })
check('Ctrl+Enter posts', commentInserts().length === 1, JSON.stringify(commentInserts()))
const posted = commentInserts().at(-1)?.row
check('posts the typed body', posted?.body === 'first line', JSON.stringify(posted))
check('posts against the open ticket', posted?.issue_id === 'issue-1')
check('posts as the signed-in author', posted?.author_id === ada.id)
check('clears the box afterwards', composer.value === '', composer.value)

// ---- Cmd+Enter, for the other half of the world ----
await type('from a mac')
await press({ metaKey: true })
check('Cmd+Enter posts too', commentInserts().length === 2, String(commentInserts().length))
check('and posts the right body', commentInserts().at(-1)?.row.body === 'from a mac')

// ---- nothing to post ----
await type('   ')
await press({ ctrlKey: true })
check('a blank draft posts nothing', commentInserts().length === 2, String(commentInserts().length))

// ---- the shortcut is discoverable ----
check('the composer names the shortcut',
  /(Ctrl|⌘)\+Enter to post/.test(el.textContent), el.textContent.slice(-200))

done()
