// Project keys, ticket identifiers, the URLs that carry a key, and the rule
// that exactly one project is always selected.
import { reporter } from './setup.js'
import {
  PROJECT_STATUSES, embedFormPath, embedFormUrl, isValidKey, issueRef,
  normalizeKey, publicIssuePath, publicIssueUrl, parseIssueRef,
} from '../src/lib/projects.js'
import { chooseProject } from '../src/context/ProjectContext.jsx'
import { can } from '../src/lib/permissions.js'

const { check, done } = reporter()

const admin   = { id: 'a', role: 'admin' }
const manager = { id: 'm', role: 'manager' }
const member  = { id: 'u', role: 'member' }

// ---- who manages projects ----
check('admin manages projects',            can.manageProjects(admin))
check('manager cannot manage projects',    !can.manageProjects(manager))
check('member cannot manage projects',     !can.manageProjects(member))
check('admin sees the Projects page',      can.seeProjects(admin))
check('manager cannot see the Projects page', !can.seeProjects(manager))
check('a signed-out visitor cannot see it', !can.seeProjects(null))

// ---- the key: three or four letters, upper case ----
check('three letters is a key',  isValidKey('ACM'))
check('four letters is a key',   isValidKey('ACME'))
check('two letters is not',      !isValidKey('AC'))
check('five letters is not',     !isValidKey('ACMES'))
check('digits are not letters',  !isValidKey('AC1'))
check('lower case is not a key', !isValidKey('acme'))
check('empty is not a key',      !isValidKey(''))
check('undefined is not a key',  !isValidKey(undefined))

// The field can never hold something the database would reject.
check('typing lower case upper-cases it', normalizeKey('acme') === 'ACME')
check('digits and punctuation are dropped', normalizeKey('ac-1me') === 'ACME')
check('a long key is cut to four', normalizeKey('acmecorp') === 'ACME')
check('spaces are dropped', normalizeKey('a c m') === 'ACM')
check('normalising an empty string is safe', normalizeKey() === '')
check('anything normalize produces is either valid or too short',
  ['acme', 'a', 'ab', 'acmecorp', '12ab34cd'].every((raw) => {
    const k = normalizeKey(raw)
    return k.length <= 4 && (k.length < 3 || isValidKey(k))
  }))

// ---- statuses ----
check('a project is incoming, in progress or closed',
  PROJECT_STATUSES.join() === 'incoming,in_progress,closed')

// ---- ticket identifiers ----
const acme = { key: 'ACME', name: 'Acme Support' }
const bill = { key: 'BILL', name: 'Billing' }
check('a ticket reads as KEY-number', issueRef(acme, { number: 42 }) === 'ACME-42')
check('numbers count within a project, so two projects can both have a 1',
  issueRef(acme, { number: 1 }) === 'ACME-1' && issueRef(bill, { number: 1 }) === 'BILL-1')
// Better a bare number for one frame than the word "undefined" in a ticket id.
check('an unloaded project falls back to the bare number',
  issueRef(null, { number: 7 }) === '#7')
check('a ticket with no number renders nothing at all',
  issueRef(acme, {}) === '' && issueRef(acme, null) === '')

// ---- URLs carry the key ----
check('the embed form is per project', embedFormPath('ACME') === '/embed/ACME/form')
check('the embed form URL is absolute',
  embedFormUrl('ACME', 'https://s.example') === 'https://s.example/embed/ACME/form')
check('no embed URL without a key', embedFormUrl(null, 'https://s.example') === null)

check('a share link is /i/{key}/{number}',
  publicIssuePath('ACME', 42) === '/i/ACME/42')
check('the share URL is absolute',
  publicIssueUrl('ACME', 42, 'https://s.example') === 'https://s.example/i/ACME/42')
check('no share URL without a number', publicIssueUrl('ACME', null, 'https://x') === null)
check('no share URL without a key',    publicIssueUrl(null, 42, 'https://x') === null)
// Numbering starts at 1, so a falsy-but-real number must still produce a link.
check('ticket 0 would still get a link', publicIssueUrl('ACME', 0, 'https://x') === 'https://x/i/ACME/0')

check('a share link matches the ticket reference exactly',
  publicIssuePath('ACME', 42) === `/i/${issueRef({ key: 'ACME' }, { number: 42 }).replace('-', '/')}`)

check('a well-formed reference parses', (() => {
  const r = parseIssueRef('ACME', '42')
  return r?.key === 'ACME' && r?.number === 42
})())
check('a bad key does not parse', parseIssueRef('acme', '42') === null)
check('a non-numeric ticket number does not parse', parseIssueRef('ACME', '4x2') === null)
check('a missing ticket number does not parse', parseIssueRef('ACME', undefined) === null)
// The token stays the thing that authorises; the key only addresses.
check('a share link never carries the row id',
  !publicIssuePath('ACME', 42).includes('issue'))

// ---- exactly one project is always selected ----
const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]

check('the remembered project wins', chooseProject(projects, 'p2') === 'p2')
check('with nothing remembered, the first is chosen',
  chooseProject(projects, null) === 'p1')
// A stale entry must not resurrect a project you have been removed from — it
// simply is not in the list any more, so the choice falls back.
check('a remembered project you can no longer see falls back to the first',
  chooseProject(projects, 'gone') === 'p1')
check('no projects means no selection', chooseProject([], 'p1') === null)
check('an absent list means no selection', chooseProject(undefined, 'p1') === null)
// There is no "all projects": the answer is always a single id or nothing.
check('the choice is always one id, never a set',
  typeof chooseProject(projects, 'p3') === 'string')

done()
