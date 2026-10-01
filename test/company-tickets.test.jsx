// The company page: one company's tickets as that company may read them, what
// must NOT come along, and how the list regroups.
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/tickets?company=acme')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const CompanyTickets = (await import('../src/pages/CompanyTickets')).default
const { captured, COMPANY_PAYLOAD } = await import('./mockSupabase.js')
const {
  companyTicketsPath, companyTicketsUrl, groupTickets, searchTickets, sortByStatus,
} = await import('../src/lib/companies.js')
const { STATUS_TYPE_COLORS } = await import('../src/lib/sla.js')

const { check, done } = reporter()
const D = dom.window.document
const body = () => D.body.textContent

async function render(path) {
  D.body.innerHTML = ''
  captured.functionCalls.length = 0
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/tickets" element={<CompanyTickets />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
}

const click = async (node) => {
  await act(async () => {
    node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}
const button = (label) =>
  [...D.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

// ---- the link itself ----
check('the company travels as a query parameter',
  companyTicketsUrl('wupi', 'https://support.example') === 'https://support.example/tickets?company=wupi',
  companyTicketsUrl('wupi', 'https://support.example'))
check('a name with spaces survives the trip',
  companyTicketsPath('Acme Ltd') === '/tickets?company=Acme%20Ltd', companyTicketsPath('Acme Ltd'))
check('no link without a company', companyTicketsUrl('', 'https://x') === null)

// ---- grouping, as a rule ----
const T = COMPANY_PAYLOAD.tickets
const ORDER = COMPANY_PAYLOAD.statuses.map((s) => s.name)
const refs = (list) => list.map((t) => `${t.project.key}-${t.number}`).join(' ')
const names = (groups) => groups.map((g) => `${g.name}:${g.tickets.length}`).join(' ')
check('ungrouped is one unnamed group holding everything',
  names(groupTickets(T, null)) === 'null:3', names(groupTickets(T, null)))
check('statuses group in workflow order, not alphabetically',
  names(groupTickets(T, 'status', ORDER)) === 'New:1 In Progress:1 Done:1',
  names(groupTickets(T, 'status', ORDER)))
check('products group alphabetically',
  names(groupTickets(T, 'product')) === 'Mobile App:2 Web Portal:1', names(groupTickets(T, 'product')))
check('a ticket with no area goes last, in a group of its own',
  names(groupTickets(T, 'area')) === 'Accounts:1 Billing:1 null:1', names(groupTickets(T, 'area')))
check('a group keeps its tickets in the order they arrived',
  groupTickets(T, 'product')[0].tickets.map((t) => t.number).join(',') === '42,12')

// ---- sorting and searching, as rules ----
check('sorting by status follows the workflow, not the date',
  refs(sortByStatus(T, ORDER)) === 'ACME-12 ACME-42 BILL-7', refs(sortByStatus(T, ORDER)))
check('within one status the order the tickets arrived in is kept',
  refs(sortByStatus(T.map((t) => ({ ...t, status: 'New' })), ORDER)) === refs(T))
check('a status the list does not know sorts last',
  refs(sortByStatus([{ ...T[0], status: 'Mystery' }, T[2]], ORDER)) === 'ACME-12 BILL-7')
check('sorting does not reorder the list it was given', refs(T) === 'BILL-7 ACME-42 ACME-12')
check('search matches the title, ignoring case',
  refs(searchTickets(T, 'EXPORT')) === 'ACME-42', refs(searchTickets(T, 'EXPORT')))
check('search matches the description',
  refs(searchTickets(T, 'two rows')) === 'BILL-7', refs(searchTickets(T, 'two rows')))
check('search matches the requester name',
  refs(searchTickets(T, 'jane')) === 'ACME-42 ACME-12', refs(searchTickets(T, 'jane')))
check('search does not reach other fields', searchTickets(T, 'Mobile App').length === 0)
check('a blank search keeps everything', searchTickets(T, '   ').length === 3)

// ---- the page ----
await render('/tickets?company=acme')

check('the page is served by the edge function, with the company from the URL',
  captured.functionCalls.length === 1
  && captured.functionCalls[0].name === 'public-company'
  && captured.functionCalls[0].body.company === 'acme',
  JSON.stringify(captured.functionCalls))
check('the company is named in the footer line',
  body().includes('This is a read-only view of Acme support tickets.'), body().slice(-120))
check('the footer says closed tickets drop off, and after how long',
  body().includes('Tickets closed more than 14 days ago are not shown.'), body().slice(-160))
check('there is no title block above the list', D.querySelector('h5') === null)
check('ungrouped, the list is headed by its count', body().includes('All tickets (3)'), body().slice(0, 200))
const searchRow = D.querySelector('input').closest('.MuiStack-root')
check('search and grouping share one row',
  searchRow.contains(button('Status')), searchRow.textContent)
check('every ticket is listed by its reference, across projects',
  ['BILL-7', 'ACME-42', 'ACME-12'].every((r) => body().includes(r)))
check('titles are listed', body().includes('Cannot export invoice') && body().includes('Refund shows twice'))
check('a row shows status, product and area',
  body().includes('In Progress') && body().includes('Mobile App · Billing'))
check('tickets come sorted by status by default',
  body().indexOf('ACME-12') < body().indexOf('ACME-42')
  && body().indexOf('ACME-42') < body().indexOf('BILL-7'))

// The status sits at the far right of its row, coloured by its type.
const summary = (ref) => [...D.querySelectorAll('.MuiAccordionSummary-root')]
  .find((n) => n.textContent.includes(ref))
const chipOf = (ref) => summary(ref).querySelector('.MuiChip-root')
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
check('the status is the last thing in the row',
  summary('ACME-42').textContent.trim().endsWith('In Progress'), summary('ACME-42').textContent)
check('statuses are colour coded by type',
  dom.window.getComputedStyle(chipOf('ACME-42')).color === rgb(STATUS_TYPE_COLORS.in_progress)
  && dom.window.getComputedStyle(chipOf('BILL-7')).color === rgb(STATUS_TYPE_COLORS.closed)
  && dom.window.getComputedStyle(chipOf('ACME-12')).color === rgb(STATUS_TYPE_COLORS.new),
  dom.window.getComputedStyle(chipOf('ACME-42')).color)
check('details stay closed until asked for', !body().includes('The export button spins forever.'))

// Open ACME-42.
await click(summary('ACME-42'))
check('an opened ticket shows its description', body().includes('The export button spins forever.'))
check('an opened ticket shows its attachments', body().includes('screenshot.png'))
check('an opened ticket shows who asked and how it arrived',
  body().includes('Jane') && body().includes('Form') && body().includes('https://acme.com/billing'))
check('opening one ticket does not open the others', !body().includes('Two rows for one refund.'))

// Everything internal must stay internal.
const leaks = {
  priority: 'High',
  severity: 'Critical',
  assignee: 'Assignee',
  comments: 'Comments',
  'status timeline': 'Status timeline',
  SLA: 'Total time elapsed',
  'requester email': 'jane@acme.com',
  'internal notes': 'Reproduced on staging.',
}
for (const [what, text] of Object.entries(leaks)) {
  check(`the page does NOT show ${what}`, !body().includes(text), `found "${text}"`)
}
check('the search box is the only thing on the page to type into',
  D.querySelector('textarea') === null && D.querySelectorAll('input').length === 1)

// ---- search, on the page ----
const type = async (text) => {
  const input = D.querySelector('input')
  const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    set.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
await type('refund')
check('searching narrows the list, and the count with it',
  body().includes('BILL-7') && !body().includes('ACME-12') && body().includes('All tickets (1)'))
await type('jane')
check('searching by requester finds tickets that do not show the name in the row',
  body().includes('ACME-42') && body().includes('ACME-12') && !body().includes('BILL-7'))
await type('zzz')
check('a search with no match says so', body().includes('No tickets match'), body().slice(0, 200))
await type('')
check('clearing the search brings everything back',
  ['BILL-7', 'ACME-42', 'ACME-12'].every((r) => body().includes(r)))

// ---- grouping, on the page ----
check('ungrouped by default: no group headings', !body().includes('Mobile App (2)'))
check('the count follows the search', body().includes('All tickets (3)'))
await click(button('Product'))
check('grouping by product puts a heading and a count on each group',
  body().includes('Mobile App (2)') && body().includes('Web Portal (1)'), body().slice(0, 300))
await click(button('Area'))
check('grouping by area names the group of tickets without one',
  body().includes('Billing (1)') && body().includes('No area (1)'), body().slice(0, 300))
await click(button('Status'))
check('grouping by status follows the workflow',
  body().indexOf('New (1)') < body().indexOf('In Progress (1)')
  && body().indexOf('In Progress (1)') < body().indexOf('Done (1)'), body().slice(0, 300))
await click(button('Status'))
check('pressing the active grouping again ungroups',
  !body().includes('New (1)') && body().includes('All tickets (3)'))

// The grouping is in the link, so a link can be sent already grouped.
await render('/tickets?company=acme&group=product')
check('a link can arrive already grouped', body().includes('Mobile App (2)'))

// ---- by name, as the embed form allows ----
await render('/tickets?company=Acme')
check('a company name works in place of its code', body().includes('All tickets (3)'))

// ---- links that don't resolve ----
await render('/tickets?company=nobody')
check('an unknown company shows a friendly dead end',
  body().includes('No such company') && !body().includes('Cannot export invoice'), body().slice(0, 120))

await render('/tickets')
check('no company at all dead-ends without calling the function',
  body().includes('No such company') && captured.functionCalls.length === 0,
  `${captured.functionCalls.length} calls`)

done()
