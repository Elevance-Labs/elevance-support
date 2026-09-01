import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/embed/ACME/form')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const EmbedForm = (await import('../src/pages/EmbedForm')).default
const CreateIssueDialog = (await import('../src/components/CreateIssueDialog')).default
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { captured } = await import('./mockSupabase.js')

const { check, done } = reporter()
const D = dom.window.document

async function mount(ui, route = '/embed/ACME/form') {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[route]}>
          <ConfigProvider withUsers={false}>
            <ProjectProvider>
              <Routes>
                <Route path="/embed/:key/form" element={ui} />
                <Route path="*" element={ui} />
              </Routes>
            </ProjectProvider>
          </ConfigProvider>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
  return el
}

const labels = () => [...D.querySelectorAll('.MuiFormLabel-root')]
  .map((l) => l.textContent.replace(/\s*\*$/, '').trim())

const valueOf = (label) => {
  const lab = [...D.querySelectorAll('label')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  if (!lab) return null
  return D.getElementById(lab.getAttribute('for'))?.value ?? null
}

// ---------- the reported bug: Source URL must be on the form ----------
await mount(<EmbedForm />)
check('Source URL is on the blank form', labels().includes('Source URL'), labels().join(', '))

// With a referrer present (the iframe case), the field must still be visible —
// pre-filled, not hidden. This is what was broken.
Object.defineProperty(dom.window.document, 'referrer', {
  value: 'https://acme.com/billing', configurable: true,
})
await mount(<EmbedForm />)
check('Source URL still visible when a referrer exists',
  labels().includes('Source URL'), labels().join(', '))
check('Source URL pre-filled from the referrer',
  valueOf('Source URL') === 'https://acme.com/billing', String(valueOf('Source URL')))

// An explicitly supplied source_url is a deliberate choice, so it still hides.
await mount(<EmbedForm />, '/embed/ACME/form?source_url=https%3A%2F%2Fx.com%2Fa')
check('explicit ?source_url= still hides the field',
  !labels().includes('Source URL'), labels().join(', '))

// ---------- priority: optional, but pre-selected ----------
await mount(<EmbedForm />)
const priorityBox = () => {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === 'Priority')
  return { label: lab, el: lab ? D.getElementById(lab.id.replace(/-label$/, '')) : null }
}
check('Priority is on the form', Boolean(priorityBox().label))
check('Priority is NOT marked required',
  !priorityBox().label.textContent.includes('*'), priorityBox().label.textContent)
check('Priority pre-selects the first active option',
  priorityBox().el?.textContent === 'High', String(priorityBox().el?.textContent))
check('an inactive priority is never auto-selected',
  priorityBox().el?.textContent !== 'Retired')

// the pre-selection is a starting point, not a lock
check('Priority remains a normal editable select',
  priorityBox().el?.getAttribute('aria-disabled') !== 'true')

// an explicitly supplied priority still wins over the pre-selection
await mount(<EmbedForm />, '/embed/ACME/form?priority=Medium')
check('supplied ?priority= overrides the pre-selection',
  priorityBox().el?.textContent === 'Medium', String(priorityBox().el?.textContent))

// ---------- Create Issue dialog ----------
await mount(<CreateIssueDialog open onClose={() => {}} onCreated={() => {}} />)
const dialogText = () => D.querySelector('[role="dialog"]')?.textContent ?? ''
check('dialog opens with a Create issue title', dialogText().includes('Create issue'))
check('dialog shows the full form, nothing hidden', (() => {
  const L = labels()
  return ['Type', 'Product', 'Area', 'Priority', 'Title', 'Description',
          'Company', 'Requester name', 'Requester email', 'Source URL']
    .every((f) => L.includes(f))
})(), labels().join(', '))

// ---------- staff-only fields ----------
check('dialog has a Source picker', labels().includes('Source'), labels().join(', '))
check('dialog has Labels', labels().includes('Labels'), labels().join(', '))
check('dialog has a Submitted date', labels().includes('Submitted'), labels().join(', '))
check('Submitted defaults to now',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valueOf('Submitted') ?? ''), String(valueOf('Submitted')))
check('the attachment rule is spelled out',
  dialogText().includes("attach the customer's own request"), dialogText().slice(-400))

// ---------- company is picked, never typed ----------
const selectOptions = async (label) => {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  const box = D.getElementById(lab.id.replace(/-label$/, ''))
  await act(async () => {
    box.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    box.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  const opts = [...D.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())
  await act(async () => {
    D.querySelector('.MuiBackdrop-root')?.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  return opts
}
const sourceOptions = () => selectOptions('Source')

check('Company is a picker, not a free text box', (() => {
  const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === 'Company')
  return D.getElementById(lab.id.replace(/-label$/, ''))?.getAttribute('role') === 'combobox'
})())
const companies = await selectOptions('Company')
check('Company lists the configured companies',
  companies.includes("Wilbert's U-Pull-It") && companies.includes('Acme'), companies.join(', '))
check('an inactive company is not offered',
  !companies.includes('Former Customer'), companies.join(', '))

const opts = await sourceOptions()
check('Source offers the configured channels', opts.includes('Email') && opts.includes('Call'),
  opts.join(', '))
check('Source never offers Form — the database stamps that', !opts.includes('Form'), opts.join(', '))
check('dialog also pre-selects the first priority',
  (() => {
    const lab = [...D.querySelectorAll('.MuiFormLabel-root')]
      .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === 'Priority')
    return D.getElementById(lab.id.replace(/-label$/, ''))?.textContent === 'High'
  })())
check('dialog Source URL is empty by default (no referrer guess)',
  valueOf('Source URL') === '', String(valueOf('Source URL')))
check('dialog submit button says Create issue',
  [...D.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create issue'))

// submitting from the dialog writes an issue and reports it
captured.inserts.length = 0
let createdId = null
await mount(<CreateIssueDialog open onClose={() => {}} onCreated={(id) => { createdId = id }} />)
const setVal = (label, v) => {
  const lab = [...D.querySelectorAll('label')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  const input = D.getElementById(lab.getAttribute('for'))
  const proto = input.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, v)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}
const submitForm = async () => {
  await act(async () => {
    D.querySelector('form').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
}
await act(async () => {
  setVal('Title', 'Customer emailed about billing')
  setVal('Requester name', 'Jane')
  setVal('Requester email', 'jane@acme.com')
  setVal('Source URL', 'https://mail.google.com/thread/123')
})

// The evidence rule is the point of the internal form: no attachment, no ticket.
await submitForm()
check('no attachment means no ticket',
  !captured.inserts.some((i) => i.table === 'issues'), JSON.stringify(captured.inserts))
check('and it says why', dialogText().includes("original request"), dialogText().slice(-300))

// Attach the customer's email, then submit for real.
const fileInput = D.querySelector('input[type="file"]')
const file = new dom.window.File(['from: jane'], 'jane-email.png', { type: 'image/png' })
Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
await act(async () => {
  fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
})
await submitForm()
const issue = captured.inserts.find((i) => i.table === 'issues')?.row
check('dialog creates an issue', Boolean(issue), JSON.stringify(captured.inserts))
check('dialog carries the typed title',
  issue?.title === 'Customer emailed about billing', JSON.stringify(issue))
check('dialog carries the requester, not the staff member',
  issue?.requester_email === 'jane@acme.com', JSON.stringify(issue))
check('dialog carries a manually entered source URL',
  issue?.source_url === 'https://mail.google.com/thread/123', JSON.stringify(issue))
check('dialog carries the attachment',
  captured.uploads.some((u) => u.bucket === 'attachments'), JSON.stringify(captured.uploads))
check('a staff ticket carries a submitted date it was given',
  typeof issue?.submitted_date === 'string', JSON.stringify(issue?.submitted_date))
check('a staff ticket sends labels', Array.isArray(issue?.labels), JSON.stringify(issue))
check('a staff ticket never claims Form', issue?.source !== 'Form', JSON.stringify(issue?.source))
check('onCreated fires so the list can refresh', createdId !== null)
check('confirmation replaces the form', (D.querySelector('[role="dialog"]')?.textContent ?? '')
  .includes('Ticket created'))

done()
