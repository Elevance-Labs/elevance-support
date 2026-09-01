import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
  { url: 'http://localhost/embed/ACME/form' })
global.window = dom.window; global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.getComputedStyle = dom.window.getComputedStyle
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
global.cancelAnimationFrame = (id) => clearTimeout(id)
dom.window.requestAnimationFrame = global.requestAnimationFrame
dom.window.cancelAnimationFrame = global.cancelAnimationFrame
global.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const EmbedForm = (await import('../src/pages/EmbedForm')).default

async function render(route) {
  const el = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => {
    root.render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[route]}>
          <ConfigProvider withUsers={false}>
            <Routes>
              <Route path="/embed/:key/form" element={<EmbedForm />} />
            </Routes>
          </ConfigProvider>
        </MemoryRouter>
      </ThemeProvider>
    )
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  return el
}

// MUI v9 renders a select's label as a <div class="MuiFormLabel-root">, not a <label>,
// so collect field names from the shared FormLabel class instead.
const labels = (el) => [...el.querySelectorAll('.MuiFormLabel-root')]
  .map((l) => l.textContent.replace(/\s*\*$/, '').trim())
let fail = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`)
  if (!cond) fail++
}

// 1. Blank form shows every field
let el = await render('/embed/ACME/form')
let L = labels(el)
check('blank: shows all 10 fields', L.length === 10, `got ${L.length}: ${L.join(', ')}`)
check('blank: has Type', L.includes('Type'))
check('blank: has Company', L.includes('Company'))

// 2. Only submission fields hide when prefilled; request fields stay visible
el = await render('/embed/ACME/form?type=Bug&company=Acme&email=a%40b.com&product=Mobile%20App')
L = labels(el)
check('prefill: Company HIDDEN (submission field)', !L.includes('Company'), L.join(', '))
check('prefill: Requester email HIDDEN (alias, submission field)',
  !L.includes('Requester email'), L.join(', '))
check('prefill: Type still SHOWN', L.includes('Type'), L.join(', '))
check('prefill: Product still SHOWN', L.includes('Product'), L.join(', '))
check('prefill: Title still shown', L.includes('Title'), L.join(', '))
check('prefill: Area still shown',  L.includes('Area'), L.join(', '))

// a pre-filled request field carries its value into the visible input
const valueOf = (root, label) => {
  const lab = [...root.querySelectorAll('.MuiFormLabel-root')]
    .find((l) => l.textContent.replace(/\s*\*$/, '').trim() === label)
  if (!lab) return null
  const el2 = root.ownerDocument.getElementById(lab.id.replace(/-label$/, ''))
  return el2?.textContent ?? el2?.value ?? null
}
check('prefill: Type is pre-selected, not blank',
  (valueOf(el, 'Type') ?? '').includes('Bug'), String(valueOf(el, 'Type')))

// 3. The Request section stays even when every request field is supplied
el = await render('/embed/ACME/form?type=Bug&product=Mobile%20App&area=Billing&priority=High')
check('section: "Request details" still shown when fully prefilled',
  el.textContent.includes('Request details'))
check('all four request fields remain editable',
  ['Type', 'Product', 'Area', 'Priority'].every((f) => labels(el).includes(f)),
  labels(el).join(', '))

// 3b. The submission section collapses when all of its fields are supplied
el = await render('/embed/ACME/form?company=Acme&requester_name=Jane&email=j%40a.com&source_url=https%3A%2F%2Fa.com')
check('section: "Submission details" heading gone when fully supplied',
  !el.textContent.includes('Submission details'), 'heading still present')

// 4. Hidden values still submit
const { captured } = await import('./mockSupabase.js')
captured.inserts.length = 0
el = await render('/embed/ACME/form?type=Bug&company=Acme')
const form = el.querySelector('form')
const setVal = (label, v) => {
  const lab = [...el.querySelectorAll('label')].find((l) => l.textContent.replace(/\s*\*$/, '') === label)
  const input = el.querySelector(`#${lab.getAttribute('for')}`)
  const setter = Object.getOwnPropertyDescriptor(
    input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype
                                 : dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(input, v)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}
await act(async () => {
  setVal('Title', 'Cannot export invoice')
  setVal('Requester name', 'Dana')
})
await act(async () => {
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 30))
})
const issue = captured.inserts.find((i) => i.table === 'issues')?.row
check('submit: issue inserted', Boolean(issue), 'no insert captured')
check('submit: pre-filled (visible) type carried through', issue?.type === 'Bug', JSON.stringify(issue))
check('submit: hidden company carried through', issue?.company === 'Acme', JSON.stringify(issue))
check('submit: a company on the list also sends its code',
  issue?.company_code === 'acme', JSON.stringify(issue))
check('submit: typed title carried through', issue?.title === 'Cannot export invoice', JSON.stringify(issue))
// The client deliberately does NOT send a status: a database trigger assigns the
// first status of type "new", so the public form and the dashboard agree.
check('submit: client sends no status (trigger assigns it)',
  issue && !('status' in issue), JSON.stringify(issue))
check('submit: source_url sent as null when blank', issue?.source_url === null)
// The public form claims nothing about how the request arrived, nor how it
// should be triaged — the database stamps `Form`, and labels are the team's.
check('submit: client sends no source (the trigger stamps Form)',
  !('source' in (issue ?? {})), JSON.stringify(issue))
check('submit: client sends no labels', !('labels' in (issue ?? {})), JSON.stringify(issue))
check('submit: the public form has no Source picker or Submitted date',
  ![...dom.window.document.querySelectorAll('.MuiFormLabel-root')]
    .map((l) => l.textContent.replace(/\s*\*$/, '').trim())
    .some((t) => t === 'Source' || t === 'Submitted' || t === 'Labels'))
// The key in the path decides the project; the form never asks and never guesses.
check('submit: filed against the project named by the key in the URL',
  issue?.project_id === 'proj-1', JSON.stringify(issue))
check('the project name is shown on the form', el.textContent.includes('Acme Support'))

// 4b. A company arrives by its code — the short identifier an embed link carries.
captured.inserts.length = 0
el = await render('/embed/ACME/form?company=wupi')
check('a company code hides the field, like any supplied company',
  ![...el.querySelectorAll('.MuiFormLabel-root')]
    .map((l) => l.textContent.replace(/\s*\*$/, '').trim()).includes('Company'))
await act(async () => {
  const lab = [...el.querySelectorAll('label')]
    .find((l) => l.textContent.replace(/\s*\*$/, '') === 'Title')
  const input = el.querySelector(`#${lab.getAttribute('for')}`)
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    .call(input, 'Pallets not scanning')
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
await act(async () => {
  el.querySelector('form').dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 30))
})
const byCode = captured.inserts.find((i) => i.table === 'issues')?.row
check('a code is stored as the company display name',
  byCode?.company === "Wilbert's U-Pull-It", JSON.stringify(byCode?.company))
check('and the code travels with it', byCode?.company_code === 'wupi', JSON.stringify(byCode))

// 5. A key that matches no project refuses to take submissions
el = await render('/embed/ZZZ/form')
check('unknown key: no form is offered', !el.querySelector('form'))
check('unknown key: says what went wrong', el.textContent.includes('doesn')
  && el.textContent.includes('ZZZ'), el.textContent.slice(0, 200))

process.exit(fail ? 1 : 0)
