import { reporter } from './setup.js'
import {
  canTransition, allowedStatuses, needsSeverity, hasSeverity,
  SEVERITY_REQUIRED_TYPES, STATUS_TYPES,
} from '../src/lib/sla.js'
import { can } from '../src/lib/permissions.js'

const { check, done } = reporter()

const STATUSES = [
  { id: '1', name: 'New',         status_type: 'new',         is_active: true },
  { id: '2', name: 'Needs Info',  status_type: 'new',         is_active: true },
  { id: '3', name: 'Triaged',     status_type: 'in_progress', is_active: true },
  { id: '4', name: 'In Progress', status_type: 'in_progress', is_active: true },
  { id: '5', name: 'On Hold',     status_type: 'paused',      is_active: true },
  { id: '6', name: 'Done',        status_type: 'closed',      is_active: true },
  { id: '7', name: 'Rejected',    status_type: 'closed',      is_active: true },
]

const names = (list) => list.map((s) => s.name)

// ---------------- which types need one ----------------
check('in_progress needs a severity', needsSeverity('in_progress'))
check('paused needs a severity',      needsSeverity('paused'))
check('new does NOT need one',        !needsSeverity('new'))
// A request can always be answered or rejected outright without triage.
check('closed does NOT need one',     !needsSeverity('closed'))
check('every gated type is a real status type',
  SEVERITY_REQUIRED_TYPES.every((t) => STATUS_TYPES.includes(t)),
  SEVERITY_REQUIRED_TYPES.join(', '))

// ---------------- what counts as assigned ----------------
check('a name counts',                hasSeverity('Critical'))
check('null does not',                !hasSeverity(null))
check('undefined does not',           !hasSeverity(undefined))
check('an empty string does not',     !hasSeverity(''))
check('whitespace does not',          !hasSeverity('   '))

// ---------------- the transition gate ----------------
check('untriaged New -> In Progress BLOCKED',
  !canTransition('new', 'in_progress', { severity: null }))
check('untriaged New -> Paused BLOCKED',
  !canTransition('new', 'paused', { severity: null }))
check('untriaged New -> Closed allowed',
  canTransition('new', 'closed', { severity: null }))
check('untriaged New -> New allowed',
  canTransition('new', 'new', { severity: null }))
check('triaged New -> In Progress allowed',
  canTransition('new', 'in_progress', { severity: 'Critical' }))
check('triaged New -> Paused allowed',
  canTransition('new', 'paused', { severity: 'Critical' }))

// The gate is a filter on top of the ladder, never a way around it.
check('a severity does not unlock moving backwards',
  !canTransition('closed', 'in_progress', { severity: 'Critical' }))
check('a severity does not let a closed ticket be paused',
  !canTransition('closed', 'paused', { severity: 'Critical' }))

// Omitting the severity means "not checking here" — the database is the real
// guard, and a permissive default keeps callers that predate severities working.
check('omitting the severity does not block anything',
  canTransition('new', 'in_progress'))

// ---------------- the dropdown ----------------
const untriaged = names(allowedStatuses(STATUSES, 'New', [], { severity: null }))
check('untriaged ticket is offered no In Progress status',
  !untriaged.includes('Triaged') && !untriaged.includes('In Progress'), untriaged.join(', '))
check('untriaged ticket is offered no Paused status',
  !untriaged.includes('On Hold'), untriaged.join(', '))
check('untriaged ticket can still be closed',
  untriaged.includes('Done') && untriaged.includes('Rejected'), untriaged.join(', '))
// Nothing New is on offer either: an untriaged ticket's only ways out are
// triage (which unlocks the rest) or an outright answer.
check('untriaged ticket is offered no New status to sit in',
  !untriaged.includes('New') && !untriaged.includes('Needs Info'), untriaged.join(', '))
check('so the only choices left are closing ones',
  untriaged.every((n) => ['Done', 'Rejected'].includes(n)), untriaged.join(', '))

const triaged = names(allowedStatuses(STATUSES, 'New', [], { severity: 'Critical' }))
check('assigning a severity opens up In Progress',
  triaged.includes('Triaged') && triaged.includes('In Progress'), triaged.join(', '))
check('assigning a severity opens up Paused',
  triaged.includes('On Hold'), triaged.join(', '))

// A ticket already in a gated status keeps its own value selectable, so losing
// its severity can never leave the dropdown with nothing in it.
const stranded = names(allowedStatuses(STATUSES, 'In Progress', [], { severity: null }))
check('the current status stays selectable even when the gate is shut',
  stranded.includes('In Progress'), stranded.join(', '))
check('a stranded ticket is offered no other gated status',
  !stranded.includes('Triaged') && !stranded.includes('On Hold'), stranded.join(', '))

// Pausing is judged against the status the ticket was paused from, and the
// severity gate rides on top of that rather than replacing it.
const pausedFromProgress = [
  { id: 'e1', to_status: 'New',         created_at: '2026-01-01T00:00:00Z' },
  { id: 'e2', to_status: 'In Progress', created_at: '2026-01-02T00:00:00Z' },
  { id: 'e3', to_status: 'On Hold',     created_at: '2026-01-03T00:00:00Z' },
]
const resumed = names(
  allowedStatuses(STATUSES, 'On Hold', pausedFromProgress, { severity: 'Critical' }))
check('a triaged paused ticket can resume', resumed.includes('In Progress'), resumed.join(', '))
check('pausing is still not a backdoor to New', !resumed.includes('New'), resumed.join(', '))

// ---------------- who may assign one ----------------
// "Internal user" is the boundary, not role: severity is what unlocks starting
// work, and members are who start work.
check('an admin may set a severity',   can.setSeverity({ role: 'admin' }))
check('a manager may set a severity',  can.setSeverity({ role: 'manager' }))
check('a member may set a severity',   can.setSeverity({ role: 'member' }))
check('nobody signed out may',         !can.setSeverity(null))
check('an undefined profile may not',  !can.setSeverity(undefined))

done()
