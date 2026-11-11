/**
 * The login page: Google is the only way in. It asks for nothing to be typed,
 * hands off to Google, and says why when a sign-in came back refused.
 */
import { setupDom, reporter } from './setup.js'
// A sign-in the database refused: the address matched no account.
const dom = setupDom('http://localhost/?error=server_error&error_description=Database+error+saving+new+user')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthProvider } = await import('../src/context/AuthContext')
const { captured } = await import('./mockSupabase.js')
const Login = (await import('../src/pages/Login')).default

const { check, done } = reporter()
const D = dom.window.document

const el = D.createElement('div')
D.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/login']}>
      <AuthProvider><Login /></AuthProvider>
    </MemoryRouter></ThemeProvider>)
})
await act(async () => { await new Promise((r) => setTimeout(r, 30)) })

check('asks for nothing to be typed', el.querySelectorAll('input').length === 0,
  [...el.querySelectorAll('input')].map((i) => i.type).join(','))
const button = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Sign in with Google'))
check('offers Google', Boolean(button), el.textContent)

// The router has long since replaced the address; the reason must survive it.
check('says why the last sign-in was refused',
  el.textContent.includes('no account for that Google address'), el.textContent)

await act(async () => {
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 30))
})
const call = captured.auth.at(-1)
check('hands off to Google', call?.call === 'signInWithOAuth' && call?.provider === 'google',
  JSON.stringify(call))
check('and asks to come back to the app', call?.options?.redirectTo === 'http://localhost/',
  call?.options?.redirectTo)
check('never asks for a password', !captured.auth.some((c) => c.call === 'signInWithPassword'))
check('a new attempt clears the old refusal',
  !el.textContent.includes('no account for that Google address'), el.textContent)

done()
