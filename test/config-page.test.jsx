import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/config')
const D = dom.window.document

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const Configuration = (await import('../src/pages/Configuration')).default

const { check, done } = reporter()

const el = dom.window.document.createElement('div')
dom.window.document.body.appendChild(el)
await act(async () => {
  createRoot(el).render(
    <ThemeProvider theme={theme}><MemoryRouter initialEntries={['/config']}>
      <ConfigProvider withUsers={false}><Configuration /></ConfigProvider>
    </MemoryRouter></ThemeProvider>)
})
await act(async () => { await new Promise((r) => setTimeout(r, 30)) })

const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
check('renders without crashing', el.textContent.includes('Configuration'))
check('has 7 tabs', tabs.length === 7, `got ${tabs.length}: ${tabs.join(', ')}`)
for (const t of ['Types', 'Products', 'Areas', 'Priorities', 'Statuses', 'Labels', 'Sources'])
  check(`tab "${t}"`, tabs.includes(t), tabs.join(', '))

// default tab = Type, seeded with Bug + Question from the mock
const rowText = () => [...el.querySelectorAll('tbody tr')].map((r) => r.textContent)
check('lists items for active tab', rowText().some((r) => r.includes('Bug')), rowText().join(' | '))
check('has Add button', el.textContent.includes('Add Type'), el.textContent.slice(0, 200))
check('singular button label, not "Add Types"', !el.textContent.includes('Add Types'))
check('each row has edit + delete', el.querySelectorAll('tbody tr button').length >= 2)

// switching tabs swaps the list
const productTab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Products')
await act(async () => {
  productTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
check('switching to Product shows its items',
  rowText().some((r) => r.includes('Mobile App')), rowText().join(' | '))
check('switching away hides Type items',
  !rowText().some((r) => r.includes('Bug')), rowText().join(' | '))

// Add opens a modal
const addBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Add'))
await act(async () => {
  addBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
})
const dialog = dom.window.document.querySelector('[role="dialog"]')
check('Add opens a modal', Boolean(dialog))
check('modal title uses singular', dialog?.textContent.startsWith('Add Product'),
  dialog?.textContent.slice(0, 40))
// statuses are coloured by type, so they no longer carry their own colour
{
  const statusTab = [...D.querySelectorAll('[role="tab"]')]
    .find((t) => t.textContent.trim() === 'Statuses')
  await act(async () => {
    statusTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  const heads = [...el.querySelectorAll('thead th')].map((h) => h.textContent.trim())
  check('Statuses tab has a Status type column', heads.includes('Status type'), heads.join(', '))
  check('Statuses tab has NO Colour column', !heads.includes('Colour'), heads.join(', '))
  check('Statuses tab lists a Paused status',
    [...el.querySelectorAll('tbody tr')].some((r) => r.textContent.includes('Paused')),
    [...el.querySelectorAll('tbody tr')].map((r) => r.textContent).join(' | '))

  const typesTab = [...D.querySelectorAll('[role="tab"]')]
    .find((t) => t.textContent.trim() === 'Types')
  await act(async () => {
    typesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
  })
  const typeHeads = [...el.querySelectorAll('thead th')].map((h) => h.textContent.trim())
  check('other tabs keep their Colour column', typeHeads.includes('Colour'), typeHeads.join(', '))
}

check('modal has Name field',
  dialog && [...dialog.querySelectorAll('.MuiFormLabel-root')].some((l) => l.textContent.includes('Name')),
  dialog ? [...dialog.querySelectorAll('.MuiFormLabel-root')].map(l=>l.textContent).join(', ') : 'no dialog')

done()
