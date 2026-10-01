import { reporter } from './setup.js'
import {
  assigneesOf, canJoin, departmentsTaken, hasAssignees, isAssignedTo, MAX_ASSIGNEES,
  normalizeAssignees, sameAssignees, sharedDepartment,
} from '../src/lib/assignees.js'
import { DEPARTMENTS, departmentOf } from '../src/lib/users.js'
import { can } from '../src/lib/permissions.js'
import { allowedStatuses, canTransition, needsAssignee } from '../src/lib/sla.js'

const { check, done } = reporter()

const ADA = 'user-1', GRACE = 'user-2', KAY = 'user-3'
const admin   = { id: 'a', role: 'admin' }
const manager = { id: 'm', role: 'manager' }
const member  = { id: 'u', role: 'member' }

// ---------------- the shape of an assignee set ----------------
check('two is the cap', MAX_ASSIGNEES === 2)
check('a ticket with nobody reads as empty', assigneesOf({ assignee_ids: [] }).length === 0)
check('a row that predates the column reads as empty, not as a crash',
  assigneesOf({}).length === 0 && assigneesOf(null).length === 0)
check('nulls inside the array are dropped',
  assigneesOf({ assignee_ids: [ADA, null] }).join(',') === ADA)

check('nobody on it', !hasAssignees({ assignee_ids: [] }))
check('somebody on it', hasAssignees({ assignee_ids: [ADA] }))
check('two on it', hasAssignees({ assignee_ids: [ADA, GRACE] }))

check('the first name counts as assigned', isAssignedTo({ assignee_ids: [ADA, GRACE] }, ADA))
check('the second name counts just as much',
  isAssignedTo({ assignee_ids: [ADA, GRACE] }, GRACE))
check('somebody else is not on it', !isAssignedTo({ assignee_ids: [ADA] }, GRACE))
check('no user is never assigned', !isAssignedTo({ assignee_ids: [ADA] }, null))

// ---------------- normalising what a picker hands over ----------------
check('blanks are dropped', normalizeAssignees([ADA, '', null]).join(',') === ADA)
check('the same person twice is once',
  normalizeAssignees([ADA, ADA]).join(',') === ADA)
check('a third pick is refused rather than stored',
  normalizeAssignees([ADA, GRACE, KAY]).join(',') === `${ADA},${GRACE}`)
// Order is a decision: the first name is who the ticket is mainly on.
check('the order picked is the order kept',
  normalizeAssignees([GRACE, ADA]).join(',') === `${GRACE},${ADA}`)
check('an empty pick stays empty', normalizeAssignees([]).length === 0)

check('the same people in the same order are the same set',
  sameAssignees([ADA, GRACE], [ADA, GRACE]))
check('swapping who is first is a real change',
  !sameAssignees([ADA, GRACE], [GRACE, ADA]))
check('adding a second person is a change', !sameAssignees([ADA], [ADA, GRACE]))

// ---------------- who may change who is on a ticket ----------------
const unowned = { assignee_ids: [] }
const owned = { assignee_ids: [ADA] }

check('anyone signed in may pick up an unowned ticket', can.setAssignees(member, unowned))
check('a manager may too', can.setAssignees(manager, unowned))
check('signed out, nobody may', !can.setAssignees(null, unowned))
check('a member may NOT change an owned ticket', !can.setAssignees(member, owned))
check('a manager may change an owned ticket', can.setAssignees(manager, owned))
check('an admin may change an owned ticket', can.setAssignees(admin, owned))
// Taking yourself off a ticket is still changing an owned one.
check('a member cannot unassign themselves either',
  !can.setAssignees({ id: ADA, role: 'member' }, owned))
// The rota splits by role *and* by time; see test/schedules.test.js.
check('an admin and a manager run the rota, a member does not',
  can.manageSchedules(admin) && can.manageSchedules(manager) && !can.manageSchedules(member))

// ---------------- departments: a pair is two of them ----------------
const ada   = { id: ADA,   full_name: 'Ada Lovelace',  department: 'Engineering' }
const grace = { id: GRACE, full_name: 'Grace Hopper',  department: 'Quality' }
const kay   = { id: KAY,   full_name: 'Kay Antonelli', department: 'Engineering' }
// A row this app has not read properly. Never guessed at — the pair rule acts
// on the answer, so "unknown" must not quietly become "Support".
const unknown = { id: 'user-4', full_name: 'No Department' }

check('the five departments are the five asked for',
  DEPARTMENTS.join(',') === 'Product,Design,Support,Engineering,Quality', DEPARTMENTS.join(','))
check('a department is read off the person', departmentOf(ada) === 'Engineering')
check('a blank department is null, not a guess',
  departmentOf(unknown) === null && departmentOf({ department: '  ' }) === null)

check('nobody shares a department with nobody', sharedDepartment([]) === null)
check('one person can never clash', sharedDepartment([ada]) === null)
check('two departments are a pair', sharedDepartment([ada, grace]) === null)
check('two of the same department are not', sharedDepartment([ada, kay]) === 'Engineering',
  String(sharedDepartment([ada, kay])))
check('the clash names the department they share',
  sharedDepartment([grace, { id: 'x', department: 'Quality' }]) === 'Quality')
check('somebody with no department cannot be the clash',
  sharedDepartment([unknown, { id: 'y' }]) === null)

check('the departments in play are reported',
  [...departmentsTaken([ada, grace])].sort().join(',') === 'Engineering,Quality')
check('an unresolved person adds no department',
  departmentsTaken([unknown]).size === 0)

// ---- who a picker may still offer ----
check('anyone may join an empty ticket', canJoin([], ada))
check('another department may join one person', canJoin([ada], grace))
check('the same department may not', !canJoin([ada], kay))
check('nobody may join a full ticket', !canJoin([ada, grace], kay))
// Otherwise a picker would have no way to take somebody off again.
check('somebody already on it always "may join"', canJoin([ada, grace], ada))
check('nothing may join as nobody', !canJoin([ada], null))
// A person whose department cannot be read is allowed through to the database,
// which is the only thing that actually knows.
check('an unresolved person is not blocked by a rule that cannot be evaluated',
  canJoin([ada], unknown))

// ---------------- no owner, no progress ----------------
check('New needs nobody', !needsAssignee('new'))
check('In Progress needs somebody', needsAssignee('in_progress'))
check('Paused needs somebody', needsAssignee('paused'))
// Where this parts company with the severity gate: an untriaged ticket may be
// closed outright, but somebody did the closing and the ticket should say who.
check('Closed needs somebody too', needsAssignee('closed'))
check('an unknown type is not gated', !needsAssignee(null))

check('an unowned ticket cannot start',
  !canTransition('new', 'in_progress', { assignees: [] }))
check('an unowned ticket cannot be closed',
  !canTransition('new', 'closed', { assignees: [] }))
check('an owned ticket can start',
  canTransition('new', 'in_progress', { assignees: [ADA] }))
check('an unowned ticket may sit in New',
  canTransition('new', 'new', { assignees: [] }))
// Omitting the option means "not checked here", not "the ticket has nobody".
check('a caller that says nothing about assignees is not blocked',
  canTransition('new', 'in_progress'))

// ---------------- what the status dropdown offers ----------------
const STATUSES = [
  { id: '1', name: 'New',         status_type: 'new',         is_active: true },
  { id: '2', name: 'In Progress', status_type: 'in_progress', is_active: true },
  { id: '3', name: 'On Hold',     status_type: 'paused',      is_active: true },
  { id: '4', name: 'Done',        status_type: 'closed',      is_active: true },
]
const names = (opts) => opts.map((o) => o.name).join(',')

const unownedOptions = allowedStatuses(STATUSES, 'New', [], {
  severity: 'High', assignees: [],
})
check('an unowned New ticket is offered nothing to move to',
  unownedOptions.length === 0, names(unownedOptions))

const ownedOptions = allowedStatuses(STATUSES, 'New', [], {
  severity: 'High', assignees: [ADA],
})
check('assigning it opens the whole ladder',
  names(ownedOptions) === 'In Progress,On Hold,Done', names(ownedOptions))

// Both gates apply at once, and each withholds its own set.
const untriagedButOwned = allowedStatuses(STATUSES, 'New', [], {
  severity: null, assignees: [ADA],
})
check('owned but untriaged can only be closed',
  names(untriagedButOwned) === 'Done', names(untriagedButOwned))

done()
