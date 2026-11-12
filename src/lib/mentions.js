/**
 * @mentions in a comment: noticing that one is being typed, and who it could
 * be. The mention itself is a run in the rich text document (richText.js);
 * the database reads it and notifies that person (migration 0023).
 *
 * Who may be offered is the caller's to say — the people who can see the
 * ticket. The database checks again, so a mention of anybody else notifies
 * nobody.
 */
import { displayName } from './users'

/** How many names the picker shows at once. */
export const MAX_SUGGESTIONS = 6

// "@" at the start of the text or after a space or bracket, then up to two
// words of a name — "@gra", "@ada lo". Letters in any script.
const TYPING = /(?:^|[\s([{])@([\p{L}\p{N}._'-]{0,30}(?: [\p{L}\p{N}._'-]{0,30})?)$/u

/**
 * What is being typed after an "@", given the text before the caret: the
 * query and where its "@" is, or null when the caret is not in a mention.
 */
export function mentionQuery(before) {
  const m = TYPING.exec(String(before ?? ''))
  if (!m) return null
  return { query: m[1], at: before.length - m[1].length - 1 }
}

/**
 * The people a query could mean, best first: names that start with it, then
 * names with a word that does, then any that contain it (email included).
 * An empty query offers everyone, alphabetically.
 */
export function matchPeople(people, query, max = MAX_SUGGESTIONS) {
  const q = String(query ?? '').trim().toLowerCase()
  const scored = []
  for (const p of people ?? []) {
    const name = displayName(p).toLowerCase()
    const email = String(p.email ?? '').toLowerCase()
    let score
    if (!q) score = 3
    else if (name.startsWith(q)) score = 0
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1
    else if (name.includes(q) || email.split('@')[0].includes(q)) score = 2
    else continue
    scored.push({ p, score, name })
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
  return scored.slice(0, max).map((s) => s.p)
}

/** The text a mention of this person carries. */
export const mentionText = (person) => `@${displayName(person)}`

/**
 * Who a ticket's comment may mention: active people who can see the ticket —
 * its project's members, and every admin — but not the writer themselves.
 */
export function mentionablePeople(users, memberIds, me) {
  const members = new Set(memberIds ?? [])
  return (users ?? [])
    .filter((u) => u.is_active !== false && u.id !== me && (u.role === 'admin' || members.has(u.id)))
}
