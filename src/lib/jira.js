const BASE = import.meta.env.VITE_JIRA_BASE_URL ?? ''

// A Jira key: project part, a hyphen, the number. Deliberately loose about the
// project part — that vocabulary belongs to Jira, not to us.
const KEY = /[A-Za-z][A-Za-z0-9_]*-\d+/g

/**
 * The ticket key inside whatever was entered. People paste a browser URL rather
 * than typing the key, and the link we build appends to it — so pull the key
 * back out and let the rest go.
 *
 * Handles `/browse/ENG-1`, `?selectedIssue=ENG-1`, board and issue-navigator
 * paths, and a plain key. Anything with no key in it is returned trimmed, so a
 * value we don't recognise is never silently thrown away.
 */
export function jiraKey(input) {
  const text = String(input ?? '').trim()
  if (!text) return ''

  // A URL's query can name the ticket that is open while the path names the
  // board it sits on, so the parameter wins over anything in the path.
  const param = text.match(/[?&](?:selectedIssue|issueKey)=([A-Za-z][A-Za-z0-9_]*-\d+)/)
  if (param) return param[1].toUpperCase()

  const browse = text.match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/)
  if (browse) return browse[1].toUpperCase()

  // Otherwise the last key wins: in `/projects/ENG/issues/ENG-1234` the leading
  // segments describe the project, and the ticket comes last.
  const all = text.match(KEY)
  return all ? all[all.length - 1].toUpperCase() : text
}

/** Link to a Jira ticket, or null when no base URL is configured. */
export const jiraUrl = (ticket) =>
  ticket && BASE ? `${BASE.replace(/\/$/, '')}/browse/${jiraKey(ticket)}` : null
