/**
 * Companies are a list, not a text box: one customer must be one row in every
 * report, whoever logged the ticket.
 *
 * Two identifiers do two jobs. The **name** is what people read and what a
 * ticket stores. The **code** is short, lower case and stable — it is what an
 * embed link carries (`?company=wupi`), so a company that gets renamed keeps its
 * own history.
 */

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
