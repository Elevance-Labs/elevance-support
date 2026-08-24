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

/** Sort helper so lists order by what the user actually sees. */
export const byDisplayName = (a, b) =>
  displayName(a).localeCompare(displayName(b))
