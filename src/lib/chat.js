// A Chat thread resource name, as `notify-issue` records it from the message
// Chat created: `spaces/<space>/threads/<thread>`.
const THREAD = /^spaces\/([^/\s]+)\/threads\/([^/\s]+)$/

/**
 * Where a ticket's Google Chat thread opens in the browser, or null when there
 * is none to open. The ticket stores the thread's API name rather than this
 * address because the address is Google's to change and not part of the API —
 * if it moves, this is the one line to update.
 */
export function chatThreadUrl(threadName) {
  const match = String(threadName ?? '').trim().match(THREAD)
  if (!match) return null
  const [, space, thread] = match.map(encodeURIComponent)
  return `https://chat.google.com/room/${space}/${thread}`
}
