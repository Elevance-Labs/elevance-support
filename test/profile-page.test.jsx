/**
 * The Profile page: what a person may change about themselves, and what they
 * may not. Name, email and role identify them to everyone else, so the page
 * must show them without offering to edit them; the photo is theirs. There is
 * no password: they sign in with Google.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/profile')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { captured, FIXTURES } = await import('./mockSupabase.js')
const Profile = (await import('../src/pages/Profile')).default

const { check, done } = reporter()

const me = { ...FIXTURES.profiles[0], avatar_url: null }
let refreshed = 0

const el = dom.window.document.createElement('div')
dom.window.document.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/profile']}>
      <AuthContext.Provider value={{
        session: { user: { id: me.id, email: me.email } },
        profile: me,
        loading: false,
        refreshProfile: async () => { refreshed++ },
      }}>
        <Profile />
      </AuthContext.Provider>
    </MemoryRouter></ThemeProvider>)
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
await settle()

// ---- identity is shown, not edited ----
check('shows the name', el.textContent.includes('Ada Lovelace'), el.textContent.slice(0, 200))
check('shows the email', el.textContent.includes('ada@co.com'))
check('shows the role', el.textContent.includes('Admin'))

const inputs = [...el.querySelectorAll('input')]
const editable = inputs.filter((i) => i.type !== 'password' && i.type !== 'file')
check('no editable name/email fields', editable.length === 0,
  editable.map((i) => i.type).join(', '))
check('says who owns name and email',
  el.textContent.includes('managed by an administrator'))

// ---- photo ----
const fileInput = el.querySelector('input[type="file"]')
check('has a file picker', Boolean(fileInput))

const pick = async (file) => {
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await settle()
}
const fakeFile = (type, size) => ({ type, size, name: 'me.png' })

await pick(fakeFile('image/png', 1024))
const upload = captured.uploads.at(-1)
check('uploads to the avatars bucket', upload?.bucket === 'avatars', JSON.stringify(upload))
check('one object per user, keyed by their id', upload?.path === `${me.id}/avatar`, upload?.path)
check('overwrites in place', upload?.opts?.upsert === true, JSON.stringify(upload?.opts))

const saved = captured.updates.at(-1)
check('saves the URL on the profile row', saved?.table === 'profiles' &&
  typeof saved?.row?.avatar_url === 'string', JSON.stringify(saved))
check('URL is cache-busted (the path never changes)',
  /\?v=\d+$/.test(saved?.row?.avatar_url ?? ''), saved?.row?.avatar_url)
check('tells the header to re-read the profile', refreshed === 1, String(refreshed))

// A file that the bucket would reject is stopped here rather than at the API.
const uploadsBefore = captured.uploads.length
await pick(fakeFile('application/pdf', 1024))
check('rejects a non-image without uploading', captured.uploads.length === uploadsBefore)
check('says why', el.textContent.includes('Choose an image file'), el.textContent.slice(-300))

await pick(fakeFile('image/png', 5 * 1024 * 1024))
check('rejects an oversized image without uploading', captured.uploads.length === uploadsBefore)
check('says why', el.textContent.includes('larger than 2 MB'), el.textContent.slice(-300))

// ---- no password ----
// Sign-in is Google's, so there is nothing here to change — and nothing for an
// unattended browser to be used to take over.
check('offers no password fields',
  el.querySelectorAll('input[type="password"]').length === 0)
check('says how they sign in', el.textContent.includes('sign in with the Google account'))
check('never touches auth', captured.auth.length === 0, JSON.stringify(captured.auth))

done()
