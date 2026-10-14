/**
 * The email conversation's rules: who may write to a customer, what the
 * thread is called, and how a draft's Cc box is read.
 */
import { reporter } from './setup.js'
import { can } from '../src/lib/permissions.js'
import {
  deliveryOf, isEmail, messageText, newestFirst, parseRecipients, ticketSubject,
} from '../src/lib/email.js'

const { check, done } = reporter()

// ---- who may write to customers: a grant, not a role ----
check('an admin without the grant may not email customers',
  !can.emailCustomer({ id: 'a', role: 'admin' }))
check('a member with the grant may',
  can.emailCustomer({ id: 'u', role: 'member', can_email: true }))
check('a disabled account with the grant may not',
  !can.emailCustomer({ id: 'u', role: 'member', can_email: true, is_active: false }))
check('nobody signed out may', !can.emailCustomer(null))
check('only an admin hands out the grant',
  can.grantEmail({ role: 'admin' }) && !can.grantEmail({ role: 'manager' })
  && !can.grantEmail({ role: 'member' }))

// ---- the subject: always "[REF] Ticket title" ----
check('the subject is the reference in brackets, then the title',
  ticketSubject('GDT-32', 'Ticket title here') === '[GDT-32] Ticket title here')
check('with no "Re:" and nothing from what the customer called it',
  !ticketSubject('GDT-32', 'Cannot export').includes('Re:'))
check('a title that spans lines stays one line', ticketSubject('GDT-32', ' Two\n lines ') === '[GDT-32] Two lines')

// ---- the Cc box ----
const cc = parseRecipients('Bob@Acme.com, bob@acme.com; carol@x.io  nope')
check('addresses are split on commas, semicolons and spaces, and de-duplicated',
  cc.valid.join() === 'bob@acme.com,carol@x.io', cc.valid.join())
check('and whatever is not an address is named', cc.invalid.join() === 'nope', cc.invalid.join())
check('an empty box is no recipients and no problem',
  parseRecipients('').valid.length === 0 && parseRecipients('').invalid.length === 0)
check('an address needs a dot in its domain', !isEmail('jane@localhost') && isEmail('jane@acme.com'))

// ---- reading a thread ----
const ordered = newestFirst([
  { id: 'a', created_at: '2026-01-01T00:00:00Z' },
  { id: 'c', created_at: '2026-01-03T00:00:00Z' },
  { id: 'b', created_at: '2026-01-02T00:00:00Z' },
])
check('the thread reads newest first', ordered.map((m) => m.id).join('') === 'cba')
check('a message shows what was written, not the quoted history',
  messageText({ stripped_text: 'Chrome.', body_text: 'Chrome.\n> old' }) === 'Chrome.')
check('and falls back to the whole text when nothing was stripped',
  messageText({ stripped_text: null, body_text: ' Hello ' }) === 'Hello')
check('a bounced send says so', deliveryOf({ status: 'failed' }).label === 'Not delivered')
check('an unknown status reads as sent, not as delivered',
  deliveryOf({ status: 'weird' }).label === 'Sent')

done()
