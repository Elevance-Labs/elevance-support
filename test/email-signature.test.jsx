/**
 * The email signature on /profile: optional, the person's own, in the same
 * rich text the email box writes — and only for people who write to customers.
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/profile')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { captured, FIXTURES } = await import('./mockSupabase.js')
const Profile = (await import('../src/pages/Profile')).default

const { check, done } = reporter()
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
let refreshed = 0

async function render(profile) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/profile']}>
        <AuthContext.Provider value={{
          session: { user: { id: profile.id, email: profile.email } }, profile, loading: false,
          refreshProfile: async () => { refreshed++ },
        }}>
          <Profile />
        </AuthContext.Provider>
      </MemoryRouter></ThemeProvider>)
  })
  await settle()
}

const editor = () => D.querySelector('[aria-label="Email signature"]')
// Scoped to the signature's own card: the photo card has buttons too.
const button = (label) => [...(editor()?.closest('.MuiPaper-root')?.querySelectorAll('button') ?? [])]
  .find((b) => b.textContent === label)
const click = async (node) => { await act(async () => { node.click() }); await settle() }

// ---- not for everyone ----
await render(FIXTURES.profiles[0])
check('without the email grant there is no signature to set', !editor())

// ---- setting one ----
const ada = { ...FIXTURES.profiles[0], can_email: true, email_signature: null }
await render(ada)
check('with the grant, the profile offers a signature', Boolean(editor()))
check('it is optional, and says what happens without one', D.body.textContent.includes('sign with your name'))
check('nothing to save until something is written', button('Save signature')?.disabled === true)
check('and nothing to remove when none is saved', !button('Remove signature'))

await act(async () => {
  editor().innerHTML = '<div><b>Ada Lovelace</b></div><div><a href="https://gideonsystem.com">gideonsystem.com</a></div>'
  editor().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
captured.updates.length = 0
await click(button('Save signature'))
const write = captured.updates.find((u) => u.table === 'profiles')
const sig = write?.row?.email_signature
check('it is saved to your own profile, as a document',
  Array.isArray(sig?.blocks) && sig.blocks[0].runs[0].b === true
  && sig.blocks[1].runs[0].href === 'https://gideonsystem.com', JSON.stringify(write?.row))
check('and only the signature is written', Object.keys(write?.row ?? {}).join() === 'email_signature')
check('your profile is reloaded, so the email box shows it at once', refreshed === 1)

// ---- removing it ----
await render({ ...ada, email_signature: sig })
check('a saved signature is shown in the box to edit',
  editor()?.textContent.includes('Ada Lovelace') && Boolean(editor()?.querySelector('strong')))
captured.updates.length = 0
await click(button('Remove signature'))
check('removing it stores no signature at all, not an empty one',
  captured.updates.find((u) => u.table === 'profiles')?.row?.email_signature === null)

done()
