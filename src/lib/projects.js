/**
 * Projects: the shape of a project key, how a ticket is identified, and the
 * URLs that carry the key.
 *
 * A project key is a 3–4 letter code — ACME, BILL, OPS. It prefixes every
 * ticket number in the project (ACME-42), and it addresses the project's embed
 * form and its share links. Because it is public in all three places, it can
 * never be changed once a project exists; the database enforces that too.
 */

export const PROJECT_STATUSES = ['incoming', 'in_progress', 'closed']

export const PROJECT_STATUS_LABELS = {
  incoming: 'Incoming',
  in_progress: 'In Progress',
  closed: 'Closed',
}

/** Reuses the status-type palette, so a project reads like a ticket does. */
export const PROJECT_STATUS_COLORS = {
  incoming: '#6b7280',     // grey
  in_progress: '#1976d2',  // blue
  closed: '#2e7d32',       // green
}

export const KEY_PATTERN = /^[A-Z]{3,4}$/

/**
 * What the key field does to whatever is typed into it: upper case, letters
 * only, at most four. Applied as the user types so the field can never hold
 * something the database would reject.
 */
export const normalizeKey = (input = '') =>
  input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)

export const isValidKey = (key) => KEY_PATTERN.test(key ?? '')

/**
 * How a ticket is named everywhere: "ACME-42".
 *
 * `number` counts within the project, so each project starts at 1. Falls back
 * to the bare number when the project isn't loaded yet, which is better than
 * rendering "undefined-42" for a frame.
 */
export function issueRef(project, issue) {
  const n = issue?.number
  if (n == null) return ''
  return project?.key ? `${project.key}-${n}` : `#${n}`
}

/**
 * Where this deployment lives, as a URL prefix the paths below hang off.
 *
 * Usually just the origin, but a GitHub Pages project site is served from
 * /<repo>/, and a public link that drops that segment is a dead link — so the
 * build's base path is part of the address, not decoration.
 */
export const appOrigin = () =>
  window.location.origin + (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')

/** Where a project's embeddable intake form lives. */
export const embedFormPath = (key) => `/embed/${key}/form`

export const embedFormUrl = (key, origin = appOrigin()) =>
  key ? `${origin}${embedFormPath(key)}` : null

/**
 * Where a ticket's share link points: the same key and number the ticket is
 * called everywhere else, so ACME-42 is reachable at `/i/ACME/42`. The link is
 * therefore constructible by hand from the ticket reference alone.
 *
 * That is a deliberate trade. Ticket numbers run 1, 2, 3… per project, so these
 * links are guessable and the public view of every ticket in a project can be
 * walked by counting. See "Share links" in README.md.
 */
export const publicIssuePath = (key, number) => `/i/${key}/${number}`

export function publicIssueUrl(key, number, origin = appOrigin()) {
  return key && number != null ? `${origin}${publicIssuePath(key, number)}` : null
}

/** The `{key}/{number}` pair a share link carries, or null if the path is not one. */
export function parseIssueRef(key, number) {
  if (!isValidKey(key)) return null
  if (!/^\d+$/.test(String(number ?? ''))) return null
  return { key, number: Number(number) }
}

/** Sort helper: projects read alphabetically wherever they are listed. */
export const byName = (a, b) => (a?.name ?? '').localeCompare(b?.name ?? '')
