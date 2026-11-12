/**
 * Notifications: what each kind says, where it leads, and what a list of them
 * adds up to. The rows are written by triggers (migration 0023); this module
 * only reads them.
 *
 * The wording is mirrored in `push-send`, which says the same thing on a
 * device's lock screen — a Deno function cannot import from src/.
 */

export const NOTIFICATION_KINDS = [
  'assigned', 'mentioned', 'commented', 'status_changed', 'email_received', 'test',
]

/**
 * One line for a notification. `actor` is the display name of whoever caused
 * it, or null when nobody did (the public form, an inbound email, the rota).
 */
export function notificationSentence(n, actor) {
  const who = actor || 'Someone'
  switch (n?.kind) {
    case 'assigned':
      return actor ? `${actor} assigned you` : 'Assigned to you'
    case 'mentioned':
      return `${who} mentioned you`
    case 'commented':
      return `${who} commented`
    case 'status_changed':
      return n.detail ? `${who} moved it to ${n.detail}` : `${who} changed its status`
    case 'email_received':
      return n.detail ? `${n.detail} replied by email` : 'The customer replied by email'
    case 'test':
      return 'Notifications are working on this device.'
    default:
      return 'Something changed'
  }
}

/** A comment's text cut to a line or two, on a word where it can be. */
export function excerpt(text, max = 140) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Where a notification leads: the ticket, opened on the Issues page with its
 * project selected — the same address a share link hands a signed-in user.
 * Relative to the app's base, so it works under a GitHub Pages prefix and in
 * the service worker alike. Null when there is no ticket (a test).
 */
export function notificationPath(n) {
  const issueId = n?.issue_id ?? n?.issue?.id
  if (!issueId) return null
  const projectId = n?.issue?.project_id ?? n?.project_id
  return `issues?issue=${encodeURIComponent(issueId)}${projectId ? `&project=${encodeURIComponent(projectId)}` : ''}`
}

export const isUnread = (n) => !n?.read_at

/**
 * Who watches a ticket, from its `issue_watchers` rows: a row with
 * `watching` false is somebody who unwatched, not a watcher.
 */
export const watcherIds = (rows) =>
  (rows ?? []).filter((r) => r.watching !== false).map((r) => r.user_id)

export const unreadCount = (rows) => (rows ?? []).filter(isUnread).length

/** The unread ones about one ticket — what opening that ticket marks read. */
export const unreadForIssue = (rows, issueId) =>
  (rows ?? []).filter((n) => isUnread(n) && n.issue_id === issueId).map((n) => n.id)

/** The count an installed app wears on its icon: none at zero, 99+ past that. */
export const badgeCount = (n) => Math.max(0, Math.min(Number(n) || 0, 99))
