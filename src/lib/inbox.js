/**
 * The Inbox: a project's email, read by person rather than by ticket.
 *
 * The database keeps the pieces — `contacts` (a name and notes), the addresses
 * that belong to each (`project_contacts`), and the emails on the project's
 * tickets (`email_messages`). This module puts them together: which emails
 * are whose, who spoke last, which company someone is with, which tickets an
 * email to them is likely about. Pure, so it is tested without a page.
 *
 * An email belongs to everyone on it but us: the sender and the copied on one
 * we received, the recipients and the copied on one we sent. So a message
 * Jane sent with her boss on Cc is in both their conversations.
 *
 * Someone who wrote in but was never kept as an address (a customer's
 * colleague replying, say) still gets an entry of their own, marked unsaved,
 * so the email is not lost from view — and can be saved from there.
 */

import { isEmail } from './email'
import { toMillis } from './format'
import { statusTypeOf } from './sla'

const norm = (value) => String(value ?? '').trim().toLowerCase()

/** The key an entry is selected by: its contact id, or the address for an unsaved one. */
export const entryKey = (contactId, email) => (contactId ? contactId : `email:${norm(email)}`)

/** Everyone on a message except the team itself, lower-cased, once each. */
export function participants(message) {
  const list = message?.direction === 'inbound'
    ? [message.from_email, ...(message.cc_emails ?? [])]
    : [...(message?.to_emails ?? []), ...(message?.cc_emails ?? [])]
  return [...new Set(list.map(norm).filter(Boolean))]
}

const newer = (a, b) => (toMillis(b) || 0) - (toMillis(a) || 0)

/**
 * What a person is called. A contact always has a name — the database names
 * it from the address when nothing better is known — so the fallbacks are for
 * an unsaved sender with no display name, and a row the trigger has not yet
 * filed.
 */
export function contactName(entry) {
  const own = String(entry?.name ?? '').trim()
  return own || (entry?.emails?.[0]?.email ?? 'Unknown')
}

/**
 * Every person in the project, with their conversation:
 *
 *   { key, id, saved, name, notes, emails: [{ email, last_seen_at }],
 *     messageIds, last, company, issueIds, ownIssueIds, copiedIssueIds }
 *
 * `ownIssueIds` are the tickets they asked for (requester); `copiedIssueIds`
 * the ones they are only on the emails of — copied in, mostly — newest first;
 * both only among `issues` (the page loads the open ones). `issueIds` is
 * every ticket they are on, loaded or not.
 *
 * Ordered by the last email either way, newest first; people with no email
 * yet come after, most recently met first. `messages` may arrive in any order.
 */
export function buildInbox({ contacts = [], addresses = [], messages = [], issues = [] } = {}) {
  const entries = new Map()
  const byEmail = new Map()

  for (const c of contacts) {
    entries.set(c.id, {
      key: c.id, id: c.id, saved: true, name: c.name ?? null, notes: c.notes ?? '',
      emails: [], messageIds: [], last: null, company: null, issueIds: [], ownIssueIds: [],
    })
  }
  for (const a of addresses) {
    const email = norm(a.email)
    if (!email) continue
    // An address the trigger has not yet filed is a contact of its own.
    const key = a.contact_id && entries.has(a.contact_id) ? a.contact_id : entryKey(null, email)
    if (!entries.has(key)) {
      entries.set(key, {
        key, id: null, saved: true, name: null, notes: '',
        emails: [], messageIds: [], last: null, company: null, issueIds: [], ownIssueIds: [],
      })
    }
    entries.get(key).emails.push({ email, last_seen_at: a.last_seen_at ?? null })
    byEmail.set(email, key)
  }

  // Newest first, so each entry's first message is its last word.
  const ordered = [...messages].sort((a, b) => newer(a.created_at, b.created_at))
  for (const m of ordered) {
    const keys = new Set()
    for (const email of participants(m)) {
      let key = byEmail.get(email)
      // Only a sender earns an unsaved entry: whoever a customer copied is
      // theirs to involve, not someone the team has dealt with.
      if (!key && m.direction === 'inbound' && email === norm(m.from_email) && isEmail(email)) {
        key = entryKey(null, email)
        entries.set(key, {
          key, id: null, saved: false, name: m.from_name?.includes('@') ? null : (m.from_name ?? null),
          notes: '', emails: [{ email, last_seen_at: m.created_at }],
          messageIds: [], last: null, company: null, issueIds: [], ownIssueIds: [],
        })
        byEmail.set(email, key)
      }
      if (key) keys.add(key)
    }
    for (const key of keys) {
      const e = entries.get(key)
      e.messageIds.push(m.id)
      e.last ??= m
      if (m.issue_id && !e.issueIds.includes(m.issue_id)) e.issueIds.push(m.issue_id)
    }
  }

  // A person's company is the one on the newest ticket they asked for.
  const byRecency = [...issues].sort((a, b) =>
    newer(a.submitted_date ?? a.created_at, b.submitted_date ?? b.created_at))
  for (const i of byRecency) {
    const key = byEmail.get(norm(i.requester_email))
    if (!key) continue
    const e = entries.get(key)
    if (!e.issueIds.includes(i.id)) e.issueIds.push(i.id)
    e.ownIssueIds.push(i.id)
    if (!e.company && i.company) e.company = { name: i.company, code: i.company_code ?? null }
  }

  // Nothing open of their own: the company on the newest ticket they asked
  // for that an email was on — the list rows carry it (`m.issues`), since
  // closed tickets are not loaded.
  for (const m of ordered) {
    const t = m.issues
    if (!t?.company) continue
    const key = byEmail.get(norm(t.requester_email))
    const e = key && entries.get(key)
    if (e && !e.company) e.company = { name: t.company, code: t.company_code ?? null }
  }

  const when = Object.fromEntries(issues.map((i) => [i.id, i.submitted_date ?? i.created_at]))
  for (const e of entries.values()) {
    e.copiedIssueIds = e.issueIds.filter((id) => !e.ownIssueIds.includes(id) && id in when)
      .sort((a, b) => newer(when[a], when[b]))
    e.emails.sort((a, b) => newer(a.last_seen_at, b.last_seen_at))
  }
  return [...entries.values()]
    .filter((e) => e.emails.length)
    .sort((a, b) => {
      if (a.last || b.last) return newer(a.last?.created_at, b.last?.created_at)
      return newer(a.emails[0]?.last_seen_at, b.emails[0]?.last_seen_at)
    })
}

/** Entries matching what was typed: in the name, an address or the company. */
export function searchInbox(entries = [], query = '') {
  const q = norm(query)
  if (!q) return entries
  return entries.filter((e) =>
    norm(contactName(e)).includes(q)
    || e.emails.some((a) => a.email.includes(q) || norm(a.name).includes(q))
    || norm(e.company?.name).includes(q))
}

/** The label of the group for people with no company. */
export const NO_COMPANY = 'No company'

/**
 * Entries under their company, companies A–Z with nobody's last; each group
 * keeps the order it was given (last email first).
 */
export function groupByCompany(entries = []) {
  const groups = new Map()
  for (const e of entries) {
    const name = e.company?.name ?? NO_COMPANY
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(e)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_COMPANY) - (b === NO_COMPANY) || a.localeCompare(b))
    .map(([company, list]) => ({ company, entries: list }))
}

/**
 * Tickets about this person, split the way the contact panel shows them:
 * `own` (asked for from one of their addresses) and `copied` (anyone
 * else's). Newest first.
 */
export function splitTickets(entry, tickets = []) {
  const mine = new Set((entry?.emails ?? []).map((a) => a.email))
  const sorted = [...tickets].sort((a, b) =>
    newer(a.submitted_date ?? a.created_at, b.submitted_date ?? b.created_at))
  return {
    own: sorted.filter((i) => mine.has(norm(i.requester_email))),
    copied: sorted.filter((i) => !mine.has(norm(i.requester_email))),
  }
}

/** Whether a ticket's status is a closed one. */
export const isClosed = (statuses, issue) => statusTypeOf(statuses, issue?.status) === 'closed'

/**
 * The tickets an email to this person can be filed against, for the picker:
 * their own open ones first — tickets they asked for or have emailed about,
 * newest first — marked `suggested`, then every other ticket in the project.
 * An email always belongs to a ticket; these are only the likely ones.
 */
export function ticketOptions(entry, issues = [], statuses = []) {
  const theirs = new Set(entry?.issueIds ?? [])
  const recent = [...issues].sort((a, b) =>
    newer(a.submitted_date ?? a.created_at, b.submitted_date ?? b.created_at))
  const suggested = recent.filter((i) => theirs.has(i.id) && !isClosed(statuses, i))
  const rest = recent.filter((i) => !suggested.includes(i))
  return [
    ...suggested.map((i) => ({ ...i, suggested: true })),
    ...rest.map((i) => ({ ...i, suggested: false })),
  ]
}

/**
 * Which of a person's addresses an email goes to: the one that asked for the
 * ticket, when it is theirs; else the one they last emailed from or were
 * written to at; else their newest.
 */
export function defaultRecipient(entry, issue, messages = []) {
  const mine = (entry?.emails ?? []).map((e) => e.email)
  if (!mine.length) return ''
  const requester = norm(issue?.requester_email)
  if (mine.includes(requester)) return requester
  const last = [...messages].sort((a, b) => newer(a.created_at, b.created_at))
    .flatMap(participants).find((p) => mine.includes(p))
  return last ?? mine[0]
}

/**
 * Where an address may be moved: every other saved contact, by name. Moving
 * a contact's only address out into a contact of its own would change
 * nothing, so `split` says whether "New contact" is worth offering.
 */
export function moveTargets(entries = [], from) {
  return {
    targets: entries
      .filter((e) => e.saved && e.id && e.key !== from?.key)
      .sort((a, b) => contactName(a).localeCompare(contactName(b))),
    split: (from?.emails?.length ?? 0) > 1,
  }
}

/** The contact an address already sits under, when it is someone else's. */
export const ownerOf = (entries = [], email, except) => {
  const e = norm(email)
  return entries.find((x) => x.key !== except?.key && x.saved && x.emails.some((a) => a.email === e)) ?? null
}
