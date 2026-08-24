const BASE = import.meta.env.VITE_JIRA_BASE_URL ?? ''

/** Link to a Jira ticket, or null when no base URL is configured. */
export const jiraUrl = (ticket) =>
  ticket && BASE ? `${BASE.replace(/\/$/, '')}/browse/${ticket}` : null
