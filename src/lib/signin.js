/**
 * Signing in with Google: what is asked of Google, and what a failed sign-in
 * is called.
 *
 * An account is found by its email. Supabase attaches the Google identity to
 * the auth user that already has that address, so a person keeps their profile
 * and everything on it; an address with no account is refused by the database
 * (`handle_new_user`), never given a new one.
 */

/**
 * The Google Workspace domain to offer accounts from, when the build names
 * one. It narrows Google's account chooser and nothing else: who gets in is
 * decided by who has an account.
 */
export const googleDomain = () =>
  (import.meta.env?.VITE_GOOGLE_DOMAIN ?? '').trim().toLowerCase()

/**
 * The options `signInWithOAuth` is called with.
 *
 * Ordinarily Google shows its account chooser. With a `hint` — the email a
 * sibling app handed over (see `suite.js`) — it is told which account instead
 * and shown no chooser, so someone already signed in to Google comes straight
 * back signed in here.
 */
export function googleSignIn(redirectTo, domain = googleDomain(), hint = '') {
  return {
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        ...(hint ? { login_hint: hint } : { prompt: 'select_account' }),
        ...(domain ? { hd: domain } : {}),
      },
    },
  }
}

/**
 * What Supabase said when it sent the browser back without a session, or ''.
 * It arrives in the query string or the fragment, depending on the flow.
 */
export function returnedError(location) {
  const query = new URLSearchParams(location?.search ?? '')
  const hash = new URLSearchParams((location?.hash ?? '').replace(/^#/, ''))
  const pick = (name) => query.get(name) ?? hash.get(name)
  return pick('error_description') ?? pick('error') ?? ''
}

/** A returned error, in words for the person who just tried to sign in. */
export function signInErrorMessage(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  if (/banned/i.test(text)) {
    return 'This account has been disabled. Contact an administrator.'
  }
  // `handle_new_user` refusing an address nobody added surfaces as a database
  // error; a project with sign-ups switched off words it differently.
  if (/saving new user|signups? not allowed|no account/i.test(text)) {
    return 'There is no account for that Google address. Ask an administrator to add you, or to correct your email on the Users page.'
  }
  if (/access_denied|cancel/i.test(text)) return 'Sign-in was cancelled.'
  return text
}
