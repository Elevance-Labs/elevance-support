import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/users')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const React = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { AuthContext } = await import('../src/context/AuthContext')
const Users = (await import('../src/pages/Users')).default
const { DEPARTMENTS } = await import('../src/lib/users.js')

const { check, done } = reporter()
const D = dom.window.document
const ADMIN = { id: 'user-1', role: 'admin', full_name: 'Ada Lovelace' }

async function mount(profile, extra = {}) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  const Stub = ({ children }) =>
    React.createElement(AuthContext.Provider,
      { value: { session: {}, profile, loading: false, signIn: () => {}, signOut: () => {}, ...extra } },
      children)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter><Stub>
        <ConfigProvider><Users /></ConfigProvider>
      </Stub></MemoryRouter></ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
  return el
}

const body = () => D.body.textContent
const click = async (node) => {
  await act(async () => {
    node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
}
const fieldFor = (label) => [...D.querySelectorAll('.MuiFormLabel-root')]
  .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  ?.closest('.MuiFormControl-root')

const page = await mount(ADMIN)

// ---------------- the roster ----------------
check('the table has a Department column', (() => {
  const heads = [...page.querySelectorAll('thead th')].map((h) => h.textContent.trim())
  return heads.includes('Department')
})(), [...page.querySelectorAll('thead th')].map((h) => h.textContent.trim()).join(' | '))

check('every row shows a department', (() => {
  const rows = [...page.querySelectorAll('tbody tr')]
  return rows.length >= 3
    && rows.every((r) => DEPARTMENTS.some((d) => r.textContent.includes(d)))
})(), [...page.querySelectorAll('tbody tr')].map((r) => r.textContent.slice(0, 60)).join(' | '))

check('the department shown is the one on the account', (() => {
  const row = [...page.querySelectorAll('tbody tr')]
    .find((r) => r.textContent.includes('Ada Lovelace'))
  return row?.textContent.includes('Engineering')
})())

// ---------------- adding somebody ----------------
await click([...D.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add user'))
check('the add dialog opens', body().includes('Add user'))
check('it asks for a department', Boolean(fieldFor('Department')))
check('the field is required', Boolean(fieldFor('Department')?.querySelector('.MuiFormLabel-root')?.textContent.includes('*')),
  fieldFor('Department')?.querySelector('.MuiFormLabel-root')?.textContent ?? '(no label)')
check('it says what a department is for',
  body().includes('two different departments'))

// A new account starts on a real department rather than an empty field somebody
// can skip past — the column is `not null` in the database.
check('it starts on a department rather than blank',
  DEPARTMENTS.includes(fieldFor('Department')?.querySelector('input')?.value),
  fieldFor('Department')?.querySelector('input')?.value ?? '(empty)')

const combo = fieldFor('Department')?.querySelector('[role="combobox"]')
await act(async () => {
  combo?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
  combo?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 30))
})
const options = [...D.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())
check('it offers exactly the five departments, in order',
  options.join(',') === DEPARTMENTS.join(','), options.join(','))
check('the list is hardcoded, not read from the configuration lists',
  !options.includes('Bug') && !options.includes('Critical'), options.join(','))

// ---------------- who may email customers ----------------
const grantSwitch = () => [...D.querySelectorAll('label')]
  .find((l) => l.textContent.includes('Can email customers'))?.querySelector('input')
check('an admin is offered the email grant', grantSwitch() && !grantSwitch().disabled)
check('a new account starts without it', grantSwitch()?.checked === false)

await mount({ id: 'mgr', role: 'manager', full_name: 'Max Manager' })
const graceEdit = [...D.querySelectorAll('tbody tr')]
  .find((r) => r.textContent.includes('grace.hopper@co.com'))
  ?.querySelector('[data-testid="EditIcon"]')?.closest('button')
await click(graceEdit)
check('a manager sees the grant but cannot change it',
  grantSwitch()?.disabled === true && body().includes('Only admins can change who may email customers'))

// ---------------- an admin granting it to themselves ----------------
// The signed-in profile is read once at sign-in, so the page has to reload it
// after a change to your own account — or the grant you just gave yourself
// stays invisible to the rest of the app until a page reload.
const sent = []
global.fetch = async (_url, opts) => {
  sent.push(JSON.parse(opts.body))
  return { ok: true, json: async () => ({ ok: true }) }
}
let reloaded = 0
const ada = { id: 'user-1', role: 'admin', full_name: 'Ada Lovelace', email: 'ada@co.com' }
await mount(ada, { refreshProfile: async () => { reloaded++ } })
const ownEdit = [...D.querySelectorAll('tbody tr')]
  .find((r) => r.textContent.includes('ada@co.com'))
  ?.querySelector('[data-testid="EditIcon"]')?.closest('button')
await click(ownEdit)
check('an admin may change their own grant', grantSwitch() && !grantSwitch().disabled)
await act(async () => { grantSwitch().click() })
await click([...D.querySelectorAll('button')].find((b) => b.textContent === 'Save'))
check('the grant goes to admin-users for their own account',
  sent.at(-1)?.action === 'update' && sent.at(-1)?.id === 'user-1' && sent.at(-1)?.can_email === true,
  JSON.stringify(sent.at(-1)))
check('and their own profile is reloaded, so it takes effect at once', reloaded === 1, `reloaded ${reloaded}x`)

// Editing somebody else leaves your own profile alone.
const kayRow = [...D.querySelectorAll('tbody tr')]
  .find((r) => r.textContent.includes('kay@co.com'))
await click(kayRow?.querySelector('[data-testid="EditIcon"]')?.closest('button'))
await click([...D.querySelectorAll('button')].find((b) => b.textContent === 'Save'))
check("editing someone else does not reload your profile",
  sent.at(-1)?.id === 'user-3' && reloaded === 1, `last save ${sent.at(-1)?.id}, reloaded ${reloaded}x`)

done()
