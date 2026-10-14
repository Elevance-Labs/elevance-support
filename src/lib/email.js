/**
 * The email conversation with a ticket's requester: what the thread is called,
 * which order it reads in, and how a message's delivery is described.
 *
 * Sending and receiving happen in the `email-send` and `email-webhook`
 * functions; this is only what the Conversation tab needs to draw the thread
 * and check a draft before it leaves. `ticketSubject` is mirrored in
 * `email-send`, which is what actually names the email — a Deno function
 * cannot import from src/.
 */

import { docFromText, isEmptyDoc, normalizeDoc } from './richText'
import { displayName } from './users'

/** How many people one email may copy. Mirrored in `email-send`. */
export const MAX_CC = 10

// One @, no spaces, a dot in the domain: catches a typo, not a policy.
const EMAIL = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/

export const isEmail = (value) => EMAIL.test(String(value ?? '').trim())

/**
 * "a@x.com, b@y.com; c@z.com" → the addresses, lower-cased and de-duplicated,
 * plus whatever in the box was not an address — so the box can say which one
 * is wrong rather than that something is.
 */
export function parseRecipients(text) {
  const parts = String(text ?? '').split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean)
  const valid = [...new Set(parts.filter(isEmail).map((p) => p.toLowerCase()))]
  const invalid = parts.filter((p) => !isEmail(p))
  return { valid, invalid }
}

/**
 * The subject of every email on a ticket: `[GDT-32] Ticket title`, the same on
 * the first message and every reply — no "Re:", nothing carried over from what
 * the customer called it. The reference is how both sides find the ticket.
 * Mirrored in `email-send`, which is what actually names the email.
 */
export const ticketSubject = (ref, title) =>
  `[${ref}] ${String(title ?? '').replace(/\s+/g, ' ').trim()}`.trim()

const stamp = (m) => String(m?.created_at ?? '')

/** Newest first — the order the Conversation tab reads in, as comments do. */
export const newestFirst = (messages = []) =>
  [...messages].sort((a, b) => stamp(b).localeCompare(stamp(a)))

/** The words a delivery status is shown with, and the chip colour for it. */
export const DELIVERY = {
  sent:      { label: 'Sent',      color: 'default', hint: 'Handed to the mail service; not yet confirmed delivered.' },
  delivered: { label: 'Delivered', color: 'success', hint: "Accepted by the customer's mail server." },
  failed:    { label: 'Not delivered', color: 'error', hint: 'The mail service gave up on this message.' },
  received:  { label: 'Received',  color: 'info',    hint: 'Sent to us by the customer.' },
}

export const deliveryOf = (message) => DELIVERY[message?.status] ?? DELIVERY.sent

/** What a message shows as its text: what was written, not the quoted history. */
export const messageText = (message) =>
  (message?.stripped_text ?? message?.body_text ?? '').trim()

/**
 * What an email from this person is signed with: their saved signature, or
 * their name when they have none. Mirrors signatureOf() in `email-send`, which
 * is what actually appends it — the composer only shows it, so that what the
 * sender sees under their text is what the customer reads.
 */
export function signatureDoc(profile) {
  const saved = normalizeDoc(profile?.email_signature)
  return isEmptyDoc(saved) ? docFromText(`— ${displayName(profile, 'Support')}`) : saved
}
