/**
 * The Elevance suite: the sibling apps, where each one lives, and handing a
 * signed-in person from one to the next.
 *
 * Each app has its own database and its own session, so "switching" is a link.
 * What makes it feel like one sign-in is the `sso` parameter: the link carries
 * the person's company email, and an app that opens with no session uses it as
 * Google's `login_hint`. Google already knows them, so it answers without
 * showing a screen. The email is only ever a hint — who gets in is still
 * decided by Google and by the receiving app's own database.
 */

/** `folder` is each app's folder beside the others on the shared origin. */
export const SUITE_APPS = [
  { id: 'work', name: 'Work', description: 'Projects, sprints and calendar', folder: 'elevance-work' },
  { id: 'support', name: 'Support', description: 'Customer tickets and SLAs', folder: 'elevance-support' },
  { id: 'people', name: 'People', description: 'Leave, reviews and payroll', folder: 'elevance-people' },
]

export const SSO_PARAM = 'sso'

/**
 * Every app with its address. By default an app is the sibling folder beside
 * this one (`appBase` is this app's own folder, as an absolute URL); a build
 * can name another address per app, for a custom domain or local development.
 */
export function suiteLinks(current, appBase, overrides = {}) {
  return SUITE_APPS.map((app) => ({
    ...app,
    url: asFolder(overrides[app.id]) || new URL(`../${app.folder}/`, appBase).href,
    current: app.id === current,
  }))
}

/**
 * An app's address as its folder: `…/elevance-work` and `…/elevance-work/` are
 * the same place, but only the second is where the app is served from, and a
 * link to the first costs a redirect that need not keep the hand-over.
 */
function asFolder(address) {
  const value = (address ?? '').trim()
  if (!value) return ''
  const url = new URL(value)
  if (!url.pathname.endsWith('/') && !url.pathname.split('/').pop().includes('.')) url.pathname += '/'
  return url.href
}

/** An address on `domain`; any well-formed address when no domain is named. */
export function isCompanyEmail(email, domain) {
  const value = (email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false
  return !domain || value.endsWith(`@${domain.toLowerCase()}`)
}

/** The link to another app, carrying who is asking when that is a company account. */
export function switchUrl(url, email, domain) {
  if (!isCompanyEmail(email, domain)) return url
  const target = new URL(url)
  target.searchParams.set(SSO_PARAM, email.trim().toLowerCase())
  return target.href
}

/** The email a sibling app handed over in the address, or null. */
export function ssoHint(search, domain) {
  const value = new URLSearchParams(search).get(SSO_PARAM)
  return isCompanyEmail(value, domain) ? value.trim().toLowerCase() : null
}
