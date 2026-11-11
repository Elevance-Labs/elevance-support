/**
 * Signing in with Google: what Google is asked, and what a refused sign-in is
 * called. The account is found by email — an address with no account is turned
 * away by the database, and this is where that gets put into words.
 */
import { reporter } from './setup.js'
import { googleSignIn, returnedError, signInErrorMessage } from '../src/lib/signin.js'

const { check, done } = reporter()

// ---- what is asked of Google ----
const plain = googleSignIn('https://app.example/support/', '')
check('signs in with Google', plain.provider === 'google')
check('comes back to the app', plain.options.redirectTo === 'https://app.example/support/')
check('always offers the account chooser', plain.options.queryParams.prompt === 'select_account')
check('names no domain unless the build does', !('hd' in plain.options.queryParams))
check('narrows the chooser to the company domain when it does',
  googleSignIn('https://app.example/', 'co.com').options.queryParams.hd === 'co.com')

// ---- reading what came back ----
check('reads an error from the query string (PKCE)',
  returnedError({ search: '?error=server_error&error_description=Database+error+saving+new+user', hash: '' })
    === 'Database error saving new user')
check('reads an error from the fragment',
  returnedError({ search: '', hash: '#error=access_denied&error_description=User+is+banned' })
    === 'User is banned')
check('falls back to the error code', returnedError({ search: '?error=access_denied', hash: '' }) === 'access_denied')
check('an ordinary address carries no error', returnedError({ search: '?company=wupi', hash: '' }) === '')
check('nor does a successful return', returnedError({ search: '?code=abc123', hash: '' }) === '')

// ---- putting it into words ----
check('no error, no message', signInErrorMessage('') === '' && signInErrorMessage(null) === '')
check('an address nobody added is told to ask an admin',
  signInErrorMessage('Database error saving new user').includes('no account for that Google address'))
check('so is one refused because sign-ups are off',
  signInErrorMessage('Signups not allowed for this instance').includes('no account for that Google address'))
check('and it points at the fix: the email on the Users page',
  signInErrorMessage('Database error saving new user').includes('correct your email'))
check('a disabled account is told so',
  signInErrorMessage('User is banned').includes('disabled'))
check('backing out of Google is not an alarm',
  signInErrorMessage('access_denied') === 'Sign-in was cancelled.')
check('anything else is passed on as it came',
  signInErrorMessage('Something unexpected') === 'Something unexpected')

done()
