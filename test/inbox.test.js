/**
 * The Inbox's grouping: whose emails are whose, who spoke last, which company
 * someone is with, which tickets an email to them is about.
 */
import { reporter } from './setup.js'
import {
  buildInbox, contactName, defaultRecipient, groupByCompany, moveTargets, NO_COMPANY, ownerOf,
  participants, searchInbox, splitTickets, ticketOptions,
} from '../src/lib/inbox.js'

const { check, done } = reporter()
const at = (h) => new Date(Date.UTC(2026, 10, 1, h)).toISOString()

const STATUSES = [
  { name: 'New', status_type: 'new' },
  { name: 'Doing', status_type: 'in_progress' },
  { name: 'Done', status_type: 'closed' },
]

// Every contact has a name (the database makes one from the address when
// nothing better is known); an address has none of its own.
const contacts = [
  { id: 'c-jane', name: 'Jane Doe', notes: 'VIP' },
  { id: 'c-boss', name: 'The Boss', notes: null },
  { id: 'c-quiet', name: 'Quiet', notes: null },
]
const addresses = [
  { email: 'Jane@Acme.com', contact_id: 'c-jane', last_seen_at: at(1) },
  { email: 'jane@gmail.com', contact_id: 'c-jane', last_seen_at: at(5) },
  { email: 'boss@acme.com', contact_id: 'c-boss', last_seen_at: at(2) },
  { email: 'quiet@else.com', contact_id: 'c-quiet', last_seen_at: at(3) },
  // Not yet filed under a contact by the trigger.
  { email: 'loose@acme.com', contact_id: null, last_seen_at: at(0) },
]
const issues = [
  { id: 'i-1', number: 1, title: 'Old', status: 'Done', company: 'Acme', company_code: 'acme',
    requester_email: 'jane@acme.com', submitted_date: at(0) },
  { id: 'i-2', number: 2, title: 'Open one', status: 'Doing', company: 'Acme Corp', company_code: 'acme',
    requester_email: 'JANE@gmail.com', submitted_date: at(4) },
  { id: 'i-3', number: 3, title: 'Someone else', status: 'New', company: 'Globex',
    requester_email: 'sam@globex.com', submitted_date: at(6) },
]
const messages = [
  { id: 'm-1', issue_id: 'i-1', direction: 'outbound', to_emails: ['jane@acme.com'], cc_emails: [],
    from_email: 'help@us.com', created_at: at(7) },
  { id: 'm-2', issue_id: 'i-1', direction: 'inbound', from_email: 'Jane@Acme.com', from_name: 'Jane',
    to_emails: ['t-x@mg.us.com'], cc_emails: ['boss@acme.com', 'stranger@acme.com'], created_at: at(9) },
  { id: 'm-3', issue_id: 'i-3', direction: 'inbound', from_email: 'new@globex.com', from_name: 'New Person',
    to_emails: ['t-y@mg.us.com'], cc_emails: [], created_at: at(8) },
]

// ---- who is on a message ----
check('a received email is the sender and the copied — not us',
  participants(messages[1]).join() === 'jane@acme.com,boss@acme.com,stranger@acme.com')
check('a sent one is the recipients and the copied — not the support address',
  participants(messages[0]).join() === 'jane@acme.com')

const inbox = buildInbox({ contacts, addresses, messages, issues })
const byKey = Object.fromEntries(inbox.map((e) => [e.key, e]))
const jane = byKey['c-jane']

// ---- people ----
check('one entry per contact, its addresses under it',
  jane.emails.map((a) => a.email).sort().join() === 'jane@acme.com,jane@gmail.com')
check("a contact's addresses are newest first", jane.emails[0].email === 'jane@gmail.com')
check('a contact is called by its name', contactName(jane) === 'Jane Doe' && contactName(byKey['c-boss']) === 'The Boss')
check('an address carries no name of its own', jane.emails.every((a) => !('name' in a)))
check('an address not yet under a contact goes by the address',
  contactName(byKey['email:loose@acme.com']) === 'loose@acme.com')
check('an address not yet under a contact is someone of its own',
  byKey['email:loose@acme.com']?.saved === true && byKey['email:loose@acme.com'].id === null)

// ---- their emails ----
check('every email Jane was on is in her conversation, whichever case it was addressed in',
  jane.messageIds.join() === 'm-2,m-1')
check('the boss sees the one he was copied on', byKey['c-boss'].messageIds.join() === 'm-2')
check('the last email is the newest either way', jane.last.id === 'm-2' && jane.last.direction === 'inbound')
check('nobody copied by a customer becomes someone of their own', !byKey['email:stranger@acme.com'])
const stranger = byKey['email:new@globex.com']
check('a sender we never kept still shows, unsaved, under their display name',
  stranger?.saved === false && contactName(stranger) === 'New Person' && stranger.messageIds.join() === 'm-3')
check('people with an email come first, by the last one; then the rest by when they were met',
  inbox.map((e) => e.key).join() === 'c-jane,c-boss,email:new@globex.com,c-quiet,email:loose@acme.com',
  inbox.map((e) => e.key).join())

// ---- their tickets, in two lists ----
check('their own tickets are the ones they asked for, newest first, whichever address',
  jane.ownIssueIds.join() === 'i-2,i-1', jane.ownIssueIds.join())
check('a ticket of their own is never also one they were copied on', jane.copiedIssueIds.length === 0)
check("someone copied on another's ticket has it in the second list, not the first",
  byKey['c-boss'].copiedIssueIds.join() === 'i-1' && byKey['c-boss'].ownIssueIds.length === 0)

// ---- closed tickets, fetched later, split the same way ----
const fetched = splitTickets(jane, [issues[0], issues[2], issues[1]])
check('fetched tickets split into theirs (any of their addresses, any case) and the rest, newest first',
  fetched.own.map((i) => i.id).join() === 'i-2,i-1' && fetched.copied.map((i) => i.id).join() === 'i-3')

// ---- a company with nothing open: from the ticket an email was on ----
const onlyEmails = buildInbox({
  contacts: [{ id: 'c-old', name: 'Old Customer' }],
  addresses: [{ email: 'old@initech.com', contact_id: 'c-old', last_seen_at: at(1) }],
  messages: [
    { id: 'x-1', issue_id: 'i-closed', direction: 'inbound', from_email: 'old@initech.com', cc_emails: [],
      created_at: at(2), issues: { company: 'Initech', company_code: 'ini', requester_email: 'Old@Initech.com' } },
    { id: 'x-2', issue_id: 'i-other', direction: 'outbound', to_emails: ['x@y.com'], cc_emails: ['old@initech.com'],
      created_at: at(3), issues: { company: 'Elsewhere', requester_email: 'x@y.com' } },
  ],
  issues: [],
})
check("with no open ticket, a person's company comes from a ticket of theirs an email was on — not one they were copied on",
  onlyEmails[0].company?.name === 'Initech', JSON.stringify(onlyEmails[0].company))

// ---- companies ----
check("a person's company is the one on their newest ticket", jane.company?.name === 'Acme Corp')
check('someone who never asked for anything has none', byKey['c-boss'].company === null)
const groups = groupByCompany(inbox)
check('grouped by company, A–Z, nobody\'s last',
  groups.map((g) => g.company).join() === `Acme Corp,${NO_COMPANY}`, groups.map((g) => g.company).join())
check('search finds a company, a name or an address',
  searchInbox(inbox, 'acme corp').length === 1 && searchInbox(inbox, 'boss').length === 1
  && searchInbox(inbox, 'GMAIL').length === 1 && searchInbox(inbox, '').length === inbox.length)

// ---- tickets an email to them can be about ----
const options = ticketOptions(jane, issues, STATUSES)
check('their open tickets are suggested first', options[0].id === 'i-2' && options[0].suggested)
check('a closed one of theirs is not suggested, but can still be picked',
  options.find((o) => o.id === 'i-1')?.suggested === false)
check('every other ticket in the project can be picked', options.some((o) => o.id === 'i-3' && !o.suggested))
check('it goes to the address that asked for the ticket',
  defaultRecipient(jane, issues[1], messages) === 'jane@gmail.com')
check('else to the one they last emailed from',
  defaultRecipient(jane, issues[2], messages) === 'jane@acme.com')

// ---- moving addresses ----
const { targets, split } = moveTargets(inbox, jane)
check('an address moves to any other saved contact', targets.every((t) => t.key !== 'c-jane' && t.id)
  && targets.length === 2)
check('a contact with two addresses can split one out', split)
check('one with a single address cannot — it would change nothing', !moveTargets(inbox, byKey['c-boss']).split)
check('an address someone else already has is named as theirs',
  ownerOf(inbox, 'BOSS@acme.com', jane)?.key === 'c-boss' && ownerOf(inbox, 'jane@acme.com', jane) === null)

done()
