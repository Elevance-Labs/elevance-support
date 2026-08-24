import { supabase } from './supabase'

/**
 * The read-only payload behind a share link.
 *
 * Served by the `public-issue` edge function rather than by a table read: the
 * anon key can't be allowed to select from `issues`, so the field allow-list
 * lives server-side. The function is the only thing standing between the anon
 * key and the tickets table, which matters more now that the address is a
 * guessable `{key}/{number}` — it decides what a ticket looks like from
 * outside, and it is a short list.
 *
 * Resolves to `null` when the pair doesn't match a ticket.
 */
export async function fetchPublicIssue(key, number) {
  const { data, error } = await supabase.functions.invoke('public-issue', {
    body: { key, number },
  })
  // invoke() reports any non-2xx as an error, so a missing ticket arrives here.
  if (error) {
    const status = error.context?.status
    if (status === 404 || status === 400) return null
    throw error
  }
  if (!data || data.error) return null
  return data
}

/**
 * Copy text to the clipboard, reporting whether it worked. The Clipboard API is
 * missing outside secure contexts, so callers need a way to fall back to
 * showing the link rather than silently doing nothing.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
