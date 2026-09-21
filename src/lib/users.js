/**
 * How a person is shown anywhere in the UI.
 *
 * Always prefers their full name. When a profile has no name yet — accounts
 * created straight from the Supabase dashboard start out that way — a readable
 * name is derived from the email's local part rather than showing the raw
 * address, so "jane.doe@acme.com" reads as "Jane Doe".
 */
export function displayName(user, fallback = 'Unknown user') {
  const name = user?.full_name?.trim()
  if (name) return name

  const local = user?.email?.split('@')[0]
  if (local) return humanize(local)

  return fallback
}

/** "jane.doe", "jane_doe", "jane-doe2" -> "Jane Doe" */
export function humanize(local) {
  const words = local
    .replace(/\d+$/, '')          // trailing digits are noise: jsmith2 -> jsmith
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return words.length ? words.join(' ') : local
}

/**
 * The departments a person can belong to.
 *
 * A fixed list rather than a configuration one, unlike types or severities:
 * these are the shape of the organisation, not vocabulary the team tunes. The
 * database says the same thing in a check constraint on `profiles.department`,
 * so adding a sixth is a migration and an edit here, in that order.
 */
export const DEPARTMENTS = ['Product', 'Design', 'Support', 'Engineering', 'Quality']

/**
 * A person's department. Falls back to null rather than guessing: the column is
 * `not null` in the database, so a blank one means a row this app has not read
 * properly, and quietly calling that "Support" would be a lie the pair rule
 * then acts on.
 */
export const departmentOf = (user) => user?.department?.trim() || null

/** Sort helper so lists order by what the user actually sees. */
export const byDisplayName = (a, b) =>
  displayName(a).localeCompare(displayName(b))
