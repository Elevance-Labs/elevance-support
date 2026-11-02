/**
 * Links between tickets — the same problem arriving more than once, from two
 * people at one company or through two channels.
 *
 * A link has no direction: it is stored once per pair in `issue_links`, smaller
 * id first, and read from either end. The database orders the pair itself
 * (a trigger) and decides who may see or write one (RLS: whoever can see both
 * tickets); this is only how the dialog reads a link and picks the next one.
 */
import { isValidKey } from './projects.js'

/** How many tickets the link picker offers at once. */
export const MAX_LINK_SUGGESTIONS = 20

/**
 * The row for linking two tickets, in the order the table keeps it. The
 * trigger would swap a reversed pair anyway; ordering it here keeps what the
 * browser sends the same as what is stored.
 */
export function linkPair(a, b) {
  return a < b ? { issue_a: a, issue_b: b } : { issue_a: b, issue_b: a }
}

/** The ticket at the far end of a link, seen from `id`. */
export const otherEnd = (link, id) => (link.issue_a === id ? link.issue_b : link.issue_a)

/**
 * What a search box's text is asking for:
 *   "ACME-42"  → that ticket                   { key, number }
 *   "42", "#42" → that number, in any project  { number }
 *   anything else → a title containing it      { title }
 * Null for an empty box.
 */
export function parseTicketQuery(text) {
  const q = String(text ?? '').trim()
  if (!q) return null
  const ref = /^([A-Za-z]{3,4})-(\d+)$/.exec(q)
  if (ref && isValidKey(ref[1].toUpperCase())) {
    return { key: ref[1].toUpperCase(), number: Number(ref[2]) }
  }
  const bare = /^#?(\d+)$/.exec(q)
  if (bare) return { number: Number(bare[1]) }
  return { title: q }
}

/**
 * Text made safe to sit inside an `ilike` pattern: a typed % or _ means that
 * character, not "anything".
 */
export const escapeLike = (text) => String(text ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * What the picker offers for `issue`: never the ticket itself or one already
 * linked, and the same company's tickets first — that is where a duplicate
 * almost always comes from — then the newest.
 */
export function rankCandidates(rows, issue, linkedIds = []) {
  const skip = new Set([issue?.id, ...linkedIds])
  const company = issue?.company_code || issue?.company || null
  const sameCompany = (r) => Boolean(company) && (r.company_code || r.company || null) === company
  return (rows ?? [])
    .filter((r) => !skip.has(r.id))
    .sort((a, b) =>
      Number(sameCompany(b)) - Number(sameCompany(a))
      || String(b.submitted_date ?? '').localeCompare(String(a.submitted_date ?? '')))
    .slice(0, MAX_LINK_SUGGESTIONS)
}
