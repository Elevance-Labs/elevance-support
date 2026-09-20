import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const React = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { AuthContext } = await import('../src/context/AuthContext')
const IssueDetail = (await import('../src/components/IssueDetail')).default
const { FIXTURES, captured } = await import('./mockSupabase.js')

const { check, done } = reporter()
const D = dom.window.document
const ADMIN = { id: 'user-1', role: 'admin', full_name: 'Ada Lovelace' }

/**
 * A ticket keeps the classification it arrived with. What the team files it
 * under can move; what the request said never does. These are the two halves
 * of that, as the ticket dialog shows them:
 *
 *   - type and priority are drawn, not offered, and never leave in an update
 *   - product and area are offered to anyone signed in, and say what they were
 *     submitted as once the two no longer agree
 */
async function render(profile, issueOverrides = {}) {
  Object.assign(FIXTURES.issue, issueOverrides)
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
        <ConfigProvider><ProjectProvider>
          <IssueDetail issueId="issue-1" open onClose={() => {}} onSaved={() => {}} />
        </ProjectProvider></ConfigProvider>
      </Stub></MemoryRouter></ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
}

const body = () => D.body.textContent

/** The form control carrying a given visible label, if it is one at all. */
const fieldFor = (label) => {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  return lab?.closest('.MuiFormControl-root')
}

async function save() {
  captured.updates.length = 0
  await act(async () => {
    ;[...D.querySelectorAll('button')]
      .find((b) => b.textContent.trim().startsWith('Save changes'))
      ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  return captured.updates.find((u) => u.table === 'issues')?.row ?? {}
}

// ---------------- the request is shown, never offered ----------------
await render(ADMIN, {
  status: 'In Progress', severity: 'Critical',
  type: 'Bug', priority: 'High',
  product: 'Mobile App', area: 'Billing',
  submitted_type: 'Bug', submitted_priority: 'High',
  submitted_product: 'Mobile App', submitted_area: 'Billing',
})

check('the request type is on the ticket', body().includes('Bug'), body().slice(0, 300))
check('so is the priority it was submitted with', body().includes('High'))
check('but neither is a field to change', !fieldFor('Type') && !fieldFor('Priority'),
  `type=${Boolean(fieldFor('Type'))} priority=${Boolean(fieldFor('Priority'))}`)
check('the lock is explained where the fields are',
  body().includes('recorded as the request was submitted')
  || D.body.innerHTML.includes('recorded as the request was submitted'))

// Where the team files it is a different matter, and stays open.
check('product is still a field', Boolean(fieldFor('Product')))
check('area is still a field', Boolean(fieldFor('Area')))

// Nothing says "submitted as" while the two still agree — it would be noise on
// every ticket that was simply filed correctly.
check('no "submitted as" note while nothing has moved',
  !body().includes('Submitted as'), body().slice(0, 600))

// An update must not carry a frozen field at all: the database rejects a write
// to one even when the value is unchanged, which would fail the whole save.
const sent = await save()
check('saving sends no type', !('type' in sent), JSON.stringify(Object.keys(sent)))
check('saving sends no priority', !('priority' in sent), JSON.stringify(Object.keys(sent)))
check('saving sends no submitted_* snapshot',
  !Object.keys(sent).some((k) => k.startsWith('submitted_')), JSON.stringify(Object.keys(sent)))
check('saving still sends the filing', sent.product === 'Mobile App' && sent.area === 'Billing',
  JSON.stringify([sent.product, sent.area]))
check('saving still sends the severity', sent.severity === 'Critical', String(sent.severity))

// ---------------- once the team has re-filed it ----------------
// Filed under Core Platform when it arrived, worked under Mobile App since.
await render(ADMIN, {
  product: 'Mobile App', submitted_product: 'Core Platform',
  area: 'Billing', submitted_area: 'Onboarding',
})

check('a re-filed product says what was submitted',
  body().includes('Submitted as Core Platform'), body().slice(0, 800))
check('so does a re-filed area',
  body().includes('Submitted as Onboarding'), body().slice(0, 800))
check('the current value is the one in the field, not the original',
  fieldFor('Product')?.textContent.includes('Mobile App'),
  fieldFor('Product')?.textContent ?? 'no field')

// ---------------- a ticket from before the snapshot existed ----------------
// Null means unknown, not unchanged, so it must not claim the ticket was
// submitted as whatever it currently says.
await render(ADMIN, {
  product: 'Mobile App', submitted_product: null,
  area: 'Billing', submitted_area: null,
})
check('an unknown original claims nothing',
  !body().includes('Submitted as'), body().slice(0, 800))

// ---------------- a value the configuration has since dropped ----------------
// These fields stay editable for years, and a list moves on. An old ticket must
// still read as filed under what it is filed under.
await render(ADMIN, { product: 'Retired Product', submitted_product: 'Retired Product' })
check('a product no longer on the list still shows',
  fieldFor('Product')?.textContent.includes('Retired Product'),
  fieldFor('Product')?.textContent ?? 'no field')

// ---------------- a member files as well as an admin ----------------
// Re-filing is the team's own reading of where a ticket belongs, and the people
// working it are the ones who learn it was filed wrong.
await render({ id: 'user-2', role: 'member', full_name: '' }, { product: 'Mobile App' })
const productInput = fieldFor('Product')?.querySelector('[role="combobox"]')
check('a member may re-file a ticket',
  productInput?.getAttribute('aria-disabled') !== 'true',
  productInput?.outerHTML?.slice(0, 120) ?? 'no combobox')

done()
