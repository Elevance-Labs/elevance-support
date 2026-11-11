/**
 * The suite: the switcher that leads to the sibling apps, and arriving from
 * one. Each app keeps its own session, so the hand-over is a link carrying the
 * person's email, which the receiving app gives Google as a hint.
 */
import { setupDom, reporter } from './setup.js'
// A build may name the Google Workspace domain (VITE_GOOGLE_DOMAIN), and only
// that domain's addresses are then handed over — so the person arriving here
// is on whichever domain this run was configured with.
const HOME = (import.meta.env.VITE_GOOGLE_DOMAIN ?? '').trim().toLowerCase() || 'co.com'
const ME = `ada@${HOME}`
const SSO = `?sso=${encodeURIComponent(ME)}`
// Arriving from a sibling app, signed out here.
const dom = setupDom(`http://localhost/?sso=Ada@${HOME.toUpperCase()}`)

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { suiteLinks, switchUrl, ssoHint, isCompanyEmail } = await import('../src/lib/suite.js')
const { googleSignIn } = await import('../src/lib/signin.js')
const { AuthProvider } = await import('../src/context/AuthContext')
const { captured } = await import('./mockSupabase.js')
const Login = (await import('../src/pages/Login')).default
const AppSwitcher = (await import('../src/components/AppSwitcher')).default

const { check, done } = reporter()
const D = dom.window.document

// ---------------- where the apps are ----------------
const links = suiteLinks('support', 'https://elevance-labs.github.io/elevance-support/')
check('the suite is Work, Support and People', links.map((l) => l.name).join() === 'Work,Support,People')
check('each app is the sibling folder beside this one',
  links.map((l) => l.url).join() ===
    'https://elevance-labs.github.io/elevance-work/,https://elevance-labs.github.io/elevance-support/,https://elevance-labs.github.io/elevance-people/',
  links.map((l) => l.url).join())
check('only this app is marked current', links.filter((l) => l.current).map((l) => l.id).join() === 'support')
check('an address given without its closing slash is still the folder',
  suiteLinks('support', 'http://localhost:5173/', { work: 'https://x.test/elevance-work' })
    .find((l) => l.id === 'work')?.url === 'https://x.test/elevance-work/')
check('a build can place an app elsewhere',
  suiteLinks('support', 'http://localhost:5173/', { work: ' http://localhost:5174/ ' })
    .find((l) => l.id === 'work')?.url === 'http://localhost:5174/')

// ---------------- the hand-over link ----------------
check('a link carries who is asking',
  switchUrl('https://x.test/elevance-work/', 'Ada@Co.com', 'co.com') === 'https://x.test/elevance-work/?sso=ada%40co.com')
check('an outside address is not handed over',
  switchUrl('https://x.test/a/', 'ada@gmail.com', 'co.com') === 'https://x.test/a/')
check('nor is a missing one', switchUrl('https://x.test/a/', undefined, 'co.com') === 'https://x.test/a/')
check('the hint is read back, lower-cased', ssoHint('?sso=Ada%40Co.com', 'co.com') === 'ada@co.com')
check('an outside address in the link is ignored', ssoHint('?sso=mallory%40evil.test', 'co.com') === null)
check('so is anything that is not an address', ssoHint('?sso=1', '') === null && ssoHint('', '') === null)
check('a look-alike domain is not the company', !isCompanyEmail('ada@notco.com', 'co.com'))
check('with no domain named, any address will do', isCompanyEmail('ada@anywhere.test', ''))

// ---------------- what Google is asked, with a hint ----------------
const hinted = googleSignIn('https://app.example/', 'co.com', 'ada@co.com').options.queryParams
check('a hint names the account', hinted.login_hint === 'ada@co.com')
check('and asks for no account chooser', !('prompt' in hinted))
check('still narrowed to the domain', hinted.hd === 'co.com')

// ---------------- arriving from a sibling, signed out ----------------
const el = D.createElement('div')
D.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/login']}>
      <AuthProvider><Login /></AuthProvider>
    </MemoryRouter></ThemeProvider>)
})
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })

const call = captured.auth.at(-1)
check('it goes straight to Google, without a click',
  call?.call === 'signInWithOAuth' && call?.provider === 'google', JSON.stringify(captured.auth))
check('naming the account that was handed over',
  call?.options?.queryParams?.login_hint === ME, JSON.stringify(call?.options))
check('with no account chooser', call && !('prompt' in call.options.queryParams))
check('the hint is taken out of the address', !dom.window.location.search.includes('sso'), dom.window.location.href)
check('and Google is asked to come back without it', call?.options?.redirectTo === 'http://localhost/')
check('the sign-in button is not offered while Google takes over',
  [...el.querySelectorAll('button')].every((b) => b.disabled), el.textContent)

// ---------------- the switcher ----------------
const host = D.createElement('div')
D.body.appendChild(host)
await act(async () => {
  createRoot(host).render(
    <ThemeProvider theme={theme}><AppSwitcher current="support" email={ME.toUpperCase()} /></ThemeProvider>)
})
const opener = host.querySelector('[aria-label="Switch app"]')
check('the switcher is one icon button', Boolean(opener))
await act(async () => {
  opener.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 40))
})
const entries = [...D.querySelectorAll('[aria-label="Elevance apps"] > *')]
check('it lists the three apps',
  entries.map((e) => e.querySelector('.MuiListItemText-primary')?.textContent).join() === 'Work,Support,People',
  entries.map((e) => e.textContent).join(' | '))
const here = entries.find((e) => e.getAttribute('aria-current') === 'page')
check('this app is marked, and is not a link',
  here?.textContent.includes('SupportYou are here') && !here.hasAttribute('href'), here?.outerHTML.slice(0, 160))
const others = entries.filter((e) => e !== here).map((e) => e.getAttribute('href') ?? '')
// Where this run's build places the siblings: their folders, unless it names addresses.
const placed = suiteLinks('support', 'http://localhost/', { work: import.meta.env.VITE_SUITE_WORK_URL, support: import.meta.env.VITE_SUITE_SUPPORT_URL, people: import.meta.env.VITE_SUITE_PEOPLE_URL })
  .filter((l) => !l.current).map((l) => `${l.url}${SSO}`)
check('the others are links to the sibling apps, carrying the signed-in email',
  others.join() === placed.join() && others.length === 2, `${others.join(' | ')} vs ${placed.join(' | ')}`)

done()
