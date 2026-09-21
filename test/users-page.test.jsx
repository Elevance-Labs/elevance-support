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

async function mount(profile) {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  const Stub = ({ children }) =>
    React.createElement(AuthContext.Provider,
      { value: { session: {}, profile, loading: false, signIn: () => {}, signOut: () => {} } },
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

done()
