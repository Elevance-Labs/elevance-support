import { reporter } from './setup.js'
import { displayName, humanize, byDisplayName } from '../src/lib/users.js'
import { initials } from '../src/lib/format.js'

const { check, done } = reporter()

check('prefers full name',
  displayName({ full_name: 'Ada Lovelace', email: 'ada@co.com' }) === 'Ada Lovelace')
check('whitespace-only name falls through',
  displayName({ full_name: '   ', email: 'ada@co.com' }) === 'Ada')
check('missing name derives from email',
  displayName({ full_name: '', email: 'jane.doe@acme.com' }) === 'Jane Doe',
  displayName({ full_name: '', email: 'jane.doe@acme.com' }))
check('null name derives from email',
  displayName({ full_name: null, email: 'grace_hopper@navy.mil' }) === 'Grace Hopper')
check('hyphens handled',
  displayName({ email: 'mary-jane@co.com' }) === 'Mary Jane')
check('trailing digits dropped',
  displayName({ email: 'jsmith2@co.com' }) === 'Jsmith', displayName({ email: 'jsmith2@co.com' }))
check('single word capitalised',
  displayName({ email: 'ada@co.com' }) === 'Ada')
check('never leaks a raw email',
  !displayName({ email: 'jane.doe@acme.com' }).includes('@'))
check('no user at all uses the fallback',
  displayName(null) === 'Unknown user')
check('custom fallback honoured',
  displayName(null, 'the intake form') === 'the intake form')
check('undefined fields use fallback',
  displayName({}) === 'Unknown user')

check('humanize is exported and pure', humanize('a.b') === 'A B')

// initials should follow the displayed name, not the email
check('initials of a derived name',
  initials(displayName({ email: 'jane.doe@acme.com' })) === 'JD',
  initials(displayName({ email: 'jane.doe@acme.com' })))

const sorted = [
  { full_name: 'Zoe' }, { email: 'ada@co.com' }, { full_name: 'Marie Curie' },
].sort(byDisplayName).map((u) => displayName(u))
check('sorts by displayed name', JSON.stringify(sorted) === '["Ada","Marie Curie","Zoe"]',
  JSON.stringify(sorted))

done()
