/**
 * Search (Cmd/Ctrl+S) and the header's keyboard shortcuts — the same two keys
 * the other Elevance apps use: S searches, K creates. Here Create always means
 * a ticket, so K opens the Create issue form directly.
 *
 * Tickets are found by the database (RLS decides which ones you may see), the
 * way the link picker finds them: a reference, a bare number, or words of the
 * title — see `parseTicketQuery` in links.js.
 */

/** At most this many tickets in the results. */
export const SEARCH_LIMIT = 8

/** Cmd on a Mac, Ctrl elsewhere. */
export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

/** "⌘S" on a Mac, "Ctrl+S" elsewhere. */
export const shortcutLabel = (key) => (isMac() ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`)

/** Is this keydown Cmd/Ctrl + key, with neither Alt nor Shift? */
export const isShortcut = (e, key) =>
  Boolean(e?.metaKey || e?.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key ?? '').toLowerCase() === key

/**
 * Where a ticket opens for a signed-in user: the Issues page, its project
 * selected — the same address a notification or a share link leads to.
 */
export function ticketPath(issue) {
  const project = issue?.project_id ? `&project=${encodeURIComponent(issue.project_id)}` : ''
  return `/issues?issue=${encodeURIComponent(issue.id)}${project}`
}
