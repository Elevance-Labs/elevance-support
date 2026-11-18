/**
 * A check-in walks the open tickets one by one and will not move on from one
 * until a status change or a comment is on it. The rules, without the UI.
 */
import { reporter } from './setup.js'
import { can } from '../src/lib/permissions.js'
import {
  advance, canAdvance, checkInProgress, checkInQueue, checkInSummary, currentId, goBack,
  isAddressed, isLast, recordAction, startCheckIn,
} from '../src/lib/checkIn.js'

const { check, done } = reporter()

// ---- who may run one ----
check('an admin runs check-ins',    can.checkIn({ id: 'a', role: 'admin' }))
check('a manager runs check-ins',   can.checkIn({ id: 'm', role: 'manager' }))
check('a member does not',          !can.checkIn({ id: 'u', role: 'member' }))
check('nor does nobody',            !can.checkIn(null))

// ---- which tickets ----
const TYPES = { New: 'new', Doing: 'in_progress', 'On Hold': 'paused', Done: 'closed' }
const typeOf = (name) => TYPES[name]
const at = (days) => new Date(Date.UTC(2026, 0, days)).toISOString()
const queue = checkInQueue([
  { id: 'new-old',  status: 'New',     submitted_date: at(1) },
  { id: 'doing-new', status: 'Doing',  submitted_date: at(20) },
  { id: 'done',     status: 'Done',    submitted_date: at(2) },
  { id: 'held',     status: 'On Hold', submitted_date: at(15) },
  { id: 'doing-old', status: 'Doing',  submitted_date: at(5) },
  { id: 'doing-old', status: 'Doing',  submitted_date: at(5) }, // on two people, listed twice
  { id: 'retired',  status: 'Retired status', submitted_date: at(3) },
  { id: 'new-undated', status: 'New', submitted_date: null, number: 2 },
  { id: 'new-mid',  status: 'New',     submitted_date: at(10) },
  null,
], typeOf)
const order = queue.map((i) => i.id).join()
check('in progress, then paused, then new, oldest first within each; closed left out',
  order === 'doing-old,doing-new,held,new-old,new-mid,new-undated,retired', order)
check('each ticket once', new Set(queue.map((i) => i.id)).size === queue.length)
check('an undated ticket goes after the dated ones of its kind',
  order.indexOf('new-undated') > order.indexOf('new-mid'), order)
check('an unknown status counts as open, and comes last', order.endsWith('retired'), order)
const shuffled = checkInQueue([...queue].reverse(), typeOf).map((i) => i.id).join()
check('whatever order the page hands it, the check-in comes out the same',
  shuffled === order, shuffled)
check('nothing to walk from nothing', checkInQueue(undefined, typeOf).length === 0)

// ---- held until something is captured ----
let s = startCheckIn(['a', 'c', 'd'])
check('starts on the first ticket', currentId(s) === 'a')
check('with nothing captured, it cannot move on', !canAdvance(s))
check('and advancing is refused', currentId(advance(s)) === 'a')
check('back from the first goes nowhere', goBack(s).index === 0)

s = recordAction(s, 'a', 'comment')
check('a comment captures the ticket', isAddressed(s, 'a') && canAdvance(s))
const again = recordAction(s, 'a', 'comment')
check('the same action twice is kept once', again.actions.a.length === 1)
check('an unknown action is ignored', recordAction(s, 'c', 'viewed') === s)
check('a ticket outside the check-in is ignored', recordAction(s, 'zz', 'comment') === s)

s = advance(s)
check('then moves on', currentId(s) === 'c' && checkInProgress(s).position === 2)
check('the next one is held in its turn', !canAdvance(s))
s = goBack(s)
check('back to an earlier one', currentId(s) === 'a')
s = advance(s)
check('and forward again without being held', currentId(s) === 'c')

s = recordAction(s, 'c', 'status')
s = recordAction(s, 'c', 'comment')
check('both actions are kept, in order', s.actions.c.join() === 'status,comment')
s = advance(s)
check('the last ticket knows it is last', isLast(s) && currentId(s) === 'd')
check('progress counts what was captured',
  checkInProgress(s).addressed === 2 && checkInProgress(s).total === 3)

// ---- what it came to ----
const early = checkInSummary(s)
check('ended early, the summary names what was missed',
  !early.complete && early.missed.join() === 'd' && early.addressed === 2, JSON.stringify(early))
check('and counts each kind of action',
  early.statusChanges === 1 && early.comments === 2 && early.deleted === 0, JSON.stringify(early))
s = recordAction(s, 'd', 'deleted')
check('advancing past the last stays put', advance(s) === s)
const full = checkInSummary(s)
check('a deleted ticket counts as dealt with', full.complete && full.deleted === 1, JSON.stringify(full))

done()
