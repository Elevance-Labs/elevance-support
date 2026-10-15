/**
 * The email addresses a project has met — its requesters, and whoever the team
 * has copied on an email — offered back as suggestions in the staff form's
 * requester email and in the email Cc.
 *
 * The database keeps the list (`project_contacts`, written only by triggers,
 * read only by the project's members); this is only how a box picks from it.
 * Rows arrive newest first, and every function here keeps that order: the
 * customer the project dealt with last week comes before last year's.
 */

/** How many suggestions a box shows at once. */
export const MAX_SUGGESTIONS = 8

const norm = (value) => String(value ?? '').trim().toLowerCase()

/** "Jane <jane@acme.com>", or the bare address when no name is known. */
export const contactLabel = (contact) =>
  contact?.name ? `${contact.name} <${contact.email}>` : (contact?.email ?? '')

/**
 * The contacts matching what has been typed — anywhere in the address or the
 * name, ignoring case — leaving out the addresses in `exclude` (already
 * chosen, or the requester a Cc would only duplicate). Nothing typed suggests
 * nothing: these complete what someone has started, they are not a list to
 * pick from.
 */
export function suggestContacts(contacts, typed, { exclude = [], limit = MAX_SUGGESTIONS } = {}) {
  const q = norm(typed)
  if (!q) return []
  const skip = new Set(exclude.map(norm))
  return (contacts ?? [])
    .filter((c) => !skip.has(norm(c.email)))
    .filter((c) => norm(c.email).includes(q) || norm(c.name).includes(q))
    .slice(0, limit)
}

// The Cc box is one line of addresses separated the way parseRecipients()
// splits them; the one being typed is whatever follows the last separator.
const LAST = /[^\s,;]*$/

/** The address still being typed at the end of a recipients line. */
export const typedRecipient = (text) => String(text ?? '').match(LAST)[0]

/**
 * The recipients line with the address being typed swapped for a picked one,
 * and a separator after it, ready for the next.
 */
export const completeRecipient = (text, email) =>
  `${String(text ?? '').replace(LAST, '')}${email}, `
