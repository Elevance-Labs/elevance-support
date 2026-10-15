// Picking from the addresses a project has met: what a box suggests, and how
// a pick completes the Cc line.
import { reporter } from './setup.js'
import {
  completeRecipient, contactLabel, MAX_SUGGESTIONS, suggestContacts, typedRecipient,
} from '../src/lib/contacts.js'

const { check, done } = reporter()

// Newest first, as the database hands them over.
const CONTACTS = [
  { email: 'boss@acme.com', name: null },
  { email: 'jane@acme.com', name: 'Jane Doe' },
  { email: 'ops@globex.com', name: 'Ops Desk' },
]
const emails = (list) => list.map((c) => c.email).join()

// Suggestions complete what has been started; they are not a list to browse.
check('nothing typed suggests nothing', suggestContacts(CONTACTS, '').length === 0)
check('nor does only space', suggestContacts(CONTACTS, '   ').length === 0)
check('one character is enough, newest first',
  emails(suggestContacts(CONTACTS, 'o')) === 'boss@acme.com,jane@acme.com,ops@globex.com')
check('matches anywhere in the address',
  emails(suggestContacts(CONTACTS, 'acme')) === 'boss@acme.com,jane@acme.com')
check('or in the name', emails(suggestContacts(CONTACTS, 'desk')) === 'ops@globex.com')
// Addresses are one person whatever case they are typed in.
check('ignores case in what is typed', emails(suggestContacts(CONTACTS, 'JANE@ACME')) === 'jane@acme.com')
check('ignores surrounding space', emails(suggestContacts(CONTACTS, '  jane ')) === 'jane@acme.com')
check('leaves out what is excluded, ignoring case',
  emails(suggestContacts(CONTACTS, 'o', { exclude: ['Jane@Acme.com', ' BOSS@acme.com '] })) === 'ops@globex.com')
check('nothing matching is an empty list', suggestContacts(CONTACTS, 'zzz').length === 0)
check('no contacts is an empty list', suggestContacts(undefined, 'a').length === 0)
const many = Array.from({ length: 20 }, (_, i) => ({ email: `p${i}@x.com` }))
check('capped', suggestContacts(many, 'x').length === MAX_SUGGESTIONS)

check('a known name is shown with the address', contactLabel(CONTACTS[1]) === 'Jane Doe <jane@acme.com>')
check('no name is just the address', contactLabel(CONTACTS[0]) === 'boss@acme.com')

check('the address being typed is the last one', typedRecipient('a@x.com, bo') === 'bo')
check('after a separator nothing is being typed', typedRecipient('a@x.com, ') === '')
check('semicolons separate too', typedRecipient('a@x.com;bo') === 'bo')
check('an empty line', typedRecipient('') === '' && typedRecipient(undefined) === '')

check('a pick replaces what was being typed',
  completeRecipient('a@x.com, bo', 'boss@acme.com') === 'a@x.com, boss@acme.com, ')
check('and fills an empty line', completeRecipient('', 'boss@acme.com') === 'boss@acme.com, ')
check('and adds to a finished one', completeRecipient('a@x.com, ', 'b@y.com') === 'a@x.com, b@y.com, ')

done()
