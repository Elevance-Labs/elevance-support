/**
 * Companies are a list, not a text box: one customer must be one row in every
 * report, whoever logged the ticket.
 *
 * Two identifiers do two jobs. The **name** is what people read and what a
 * ticket stores. The **code** is short, lower case and stable — it is what an
 * embed link carries (`?company=wupi`), so a company that gets renamed keeps its
 * own history.
 */
import { appOrigin } from './projects'

/** Active companies first-class; the rest are only kept for old tickets. */
export const activeCompanies = (companies = []) => companies.filter((c) => c.is_active)

/**
 * Resolve whatever a link or a form gave us to a company: its code first (that
 * is what links carry), then its name. Case-insensitive both ways, because a
 * URL people hand-edit will not respect ours.
 */
export function findCompany(companies = [], value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return null
  return companies.find((c) => c.code?.toLowerCase() === v)
    ?? companies.find((c) => c.name?.toLowerCase() === v)
    ?? null
}

/** The display name for a value that may be a code, a name, or neither. */
export const companyName = (companies, value) =>
  findCompany(companies, value)?.name ?? (value ?? '')

/**
 * Options for a company filter: the configured list, plus any company already
 * on a ticket. Tickets logged before the list existed carry free text, and a
 * filter that cannot select them would hide them for good.
 */
export function companyOptions(companies = [], rows = []) {
  const names = new Set(activeCompanies(companies).map((c) => c.name))
  for (const r of rows) if (r.company) names.add(r.company)
  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * Where a company's public ticket list lives. The company travels as a query
 * parameter, the same one an embed link carries, so `?company=wupi` means the
 * same thing in both places. Like a share link, it holds no secret.
 */
export const companyTicketsPath = (code) =>
  `/tickets?company=${encodeURIComponent(code)}`

export const companyTicketsUrl = (code, origin = appOrigin()) =>
  code ? `${origin}${companyTicketsPath(code)}` : null

/** What the company page may group its list by. */
export const TICKET_GROUPS = [
  { field: 'status', label: 'Status' },
  { field: 'product', label: 'Product' },
  { field: 'area', label: 'Area' },
]

/**
 * The company page's default order: by status, in the order given (the
 * workflow's), keeping each status's tickets in the order they arrived in.
 * A status the list doesn't know sorts after the ones it does.
 */
export function sortByStatus(tickets = [], order = []) {
  const rank = (t) => {
    const i = order.indexOf(t.status)
    return i === -1 ? order.length : i
  }
  // Array.prototype.sort is stable, so equal ranks stay as they came.
  return [...tickets].sort((a, b) => rank(a) - rank(b))
}

/**
 * Narrow a ticket list to those mentioning `query` in the title, description or
 * requester's name. Case-insensitive; a blank query keeps everything.
 */
export function searchTickets(tickets = [], query = '') {
  const q = query.trim().toLowerCase()
  if (!q) return tickets
  return tickets.filter((t) =>
    [t.title, t.description, t.requester_name]
      .some((v) => (v ?? '').toLowerCase().includes(q)))
}

/**
 * Split a ticket list into named groups, keeping each group's tickets in the
 * order they arrived in.
 *
 * `order` ranks the group names — statuses come in workflow order rather than
 * alphabetically. Names it doesn't mention follow, A–Z; tickets with nothing
 * in the field go last, under a null name. No `field` is one unnamed group.
 */
export function groupTickets(tickets = [], field, order = []) {
  if (!field) return [{ name: null, tickets }]

  const byName = new Map()
  for (const t of tickets) {
    const name = t[field] || null
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(t)
  }

  const rank = (name) => {
    if (name === null) return Infinity
    const i = order.indexOf(name)
    return i === -1 ? order.length : i
  }
  return [...byName.keys()]
    .sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)))
    .map((name) => ({ name, tickets: byName.get(name) }))
}
