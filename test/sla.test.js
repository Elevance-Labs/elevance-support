import { reporter } from './setup.js'
import {
  canTransition, allowedStatuses, canEditRequestFields, slaStatus,
  statusTypeOf, statusRank, bandFor, slaBand,
} from '../src/lib/sla.js'
import { duration, formatDuration } from '../src/lib/format.js'

const { check, done } = reporter()
const HR = 3_600_000, DAY = 86_400_000

const STATUSES = [
  { id: '1', name: 'New',         status_type: 'new',         is_active: true, sort_order: 1 },
  { id: '2', name: 'Needs Info',  status_type: 'new',         is_active: true, sort_order: 2 },
  { id: '3', name: 'Triaged',     status_type: 'in_progress', is_active: true, sort_order: 3 },
  { id: '4', name: 'In Progress', status_type: 'in_progress', is_active: true, sort_order: 4 },
  { id: '5', name: 'Done',        status_type: 'closed',      is_active: true, sort_order: 5 },
  { id: '6', name: 'Rejected',    status_type: 'closed',      is_active: true, sort_order: 6 },
]

// ---------------- transition rules, exactly as specified ----------------
check('within New is allowed',            canTransition('new', 'new'))
check('New -> In Progress allowed',       canTransition('new', 'in_progress'))
check('New -> Closed allowed',            canTransition('new', 'closed'))
check('within In Progress allowed',       canTransition('in_progress', 'in_progress'))
check('In Progress -> Closed allowed',    canTransition('in_progress', 'closed'))
check('within Closed allowed',            canTransition('closed', 'closed'))
check('In Progress -> New BLOCKED',       !canTransition('in_progress', 'new'))
check('Closed -> New BLOCKED',            !canTransition('closed', 'new'))
check('Closed -> In Progress BLOCKED',    !canTransition('closed', 'in_progress'))

check('rank ordering', statusRank('new') < statusRank('in_progress')
  && statusRank('in_progress') < statusRank('closed'))
check('unknown types do not lock a ticket', canTransition(null, 'new'))

// ---------------- the allowed dropdown ----------------
const names = (list) => list.map((s) => s.name)

const fromNew = names(allowedStatuses(STATUSES, 'New'))
check('from New: every status offered', fromNew.length === 6, fromNew.join(', '))

const fromProgress = names(allowedStatuses(STATUSES, 'In Progress'))
check('from In Progress: no New-type statuses',
  !fromProgress.includes('New') && !fromProgress.includes('Needs Info'), fromProgress.join(', '))
check('from In Progress: siblings and closed offered',
  fromProgress.includes('Triaged') && fromProgress.includes('Done'), fromProgress.join(', '))

const fromClosed = names(allowedStatuses(STATUSES, 'Done'))
check('from Closed: only closed statuses',
  fromClosed.every((n) => ['Done', 'Rejected'].includes(n)), fromClosed.join(', '))
check('current status always selectable',
  names(allowedStatuses(STATUSES, 'Done')).includes('Done'))

const inactive = [...STATUSES, { id: '7', name: 'Retired', status_type: 'closed', is_active: false }]
check('inactive statuses are not offered',
  !names(allowedStatuses(inactive, 'New')).includes('Retired'))

// ---------------- who may edit request fields ----------------
const admin = { role: 'admin' }, manager = { role: 'manager' }, member = { role: 'member' }
check('admin edits request fields in New',      canEditRequestFields(admin, STATUSES, 'New'))
check('manager edits request fields in New',    canEditRequestFields(manager, STATUSES, 'New'))
check('member cannot edit request fields',      !canEditRequestFields(member, STATUSES, 'New'))
check('admin cannot edit once In Progress',     !canEditRequestFields(admin, STATUSES, 'In Progress'))
check('admin cannot edit once Closed',          !canEditRequestFields(admin, STATUSES, 'Done'))
check('editable in any New-type status',        canEditRequestFields(admin, STATUSES, 'Needs Info'))
check('no profile means no edit',               !canEditRequestFields(null, STATUSES, 'New'))

// ---------------- SLA calculation ----------------
const now = Date.now()
const at = (msAgo) => new Date(now - msAgo).toISOString()

const open = (msAgo, slaHours, statusType = 'in_progress') =>
  slaStatus({ submittedAt: at(msAgo), statusType, slaHours, now })

check('no SLA configured -> none', open(5 * DAY, null).state === 'none')

// ---- colour bands: blue <40%, yellow 40-70%, orange 70-100%, red >100% ----
const bandAt = (pct) => bandFor(pct / 100).state
check('0% -> on track (blue)',     bandAt(0) === 'on_track', bandAt(0))
check('39% -> on track (blue)',    bandAt(39) === 'on_track', bandAt(39))
check('39.9% -> on track (blue)',  bandFor(0.399).state === 'on_track')
check('40% -> watch (yellow)',     bandAt(40) === 'watch', bandAt(40))
check('55% -> watch (yellow)',     bandAt(55) === 'watch')
check('69.9% -> watch (yellow)',   bandFor(0.699).state === 'watch')
check('70% -> at risk (orange)',   bandAt(70) === 'at_risk', bandAt(70))
check('99% -> at risk (orange)',   bandAt(99) === 'at_risk')
check('exactly 100% -> at risk, not breached', bandAt(100) === 'at_risk', bandAt(100))
check('100.1% -> breached (red)',  bandFor(1.001).state === 'breached')
check('200% -> breached (red)',    bandAt(200) === 'breached')

check('band colours are distinct', new Set(
  ['on_track', 'watch', 'at_risk', 'breached']
    .map((st) => bandFor({ on_track: 0.1, watch: 0.5, at_risk: 0.8, breached: 2 }[st]).color),
).size === 4)
check('blue for on track',   bandFor(0.1).color === '#1565c0', bandFor(0.1).color)
check('yellow for watch',    bandFor(0.5).color === '#f9a825', bandFor(0.5).color)
check('orange for at risk',  bandFor(0.8).color === '#ef6c00', bandFor(0.8).color)
check('red for breached',    bandFor(2).color === '#c62828', bandFor(2).color)
check('yellow uses dark text for contrast',
  bandFor(0.5).contrastText.startsWith('rgba(0,0,0'), bandFor(0.5).contrastText)

// ---- the same bands through a real ticket (8h target) ----
check('2h of 8h (25%) -> on track', open(2 * HR, 8).state === 'on_track', open(2*HR,8).state)
check('4h of 8h (50%) -> watch',    open(4 * HR, 8).state === 'watch', open(4*HR,8).state)
check('6h of 8h (75%) -> at risk',  open(6 * HR, 8).state === 'at_risk', open(6*HR,8).state)
check('9h of 8h -> breached',       open(9 * HR, 8).state === 'breached')
check('breached reports overdue',  Math.round(open(11 * HR, 10).overdueMs / HR) === 1,
  String(open(11 * HR, 10).overdueMs / HR))

// closed stops the clock
const closedInTime = slaStatus({
  submittedAt: at(10 * DAY), closedAt: at(9 * DAY), statusType: 'closed', slaHours: 48, now,
})
check('closed within target keeps its band colour',
  closedInTime.state === 'watch', closedInTime.state)
check('closed within target is labelled "Met SLA"',
  slaBand(closedInTime).label === 'Met SLA', slaBand(closedInTime).label)
check('closed freezes elapsed at close time',
  Math.round(closedInTime.elapsedMs / DAY) === 1, String(closedInTime.elapsedMs / DAY))
check('closed ticket is flagged closed', closedInTime.isClosed)

const closedLate = slaStatus({
  submittedAt: at(10 * DAY), closedAt: at(5 * DAY), statusType: 'closed', slaHours: 24, now,
})
check('closed after target -> breached', closedLate.state === 'breached')
check('a late close is never labelled "Met SLA"',
  slaBand(closedLate).label !== 'Met SLA', slaBand(closedLate).label)
check('a late close stays red', slaBand(closedLate).color === '#c62828')

// an open ticket keeps counting
const openTicket = open(3 * DAY, 240)
check('open ticket keeps counting', Math.round(openTicket.elapsedMs / DAY) === 3)
check('open ticket is not flagged closed', !openTicket.isClosed)

// closed with no recorded closed_at must not keep ticking
const closedNoStamp = slaStatus({
  submittedAt: at(5 * DAY), closedAt: null, statusType: 'closed', slaHours: 500, now,
})
check('closed without a timestamp still stops', closedNoStamp.isClosed)

check('missing submitted date is harmless', slaStatus({ submittedAt: null, slaHours: 5, now }).elapsedMs === 0)
check('statusTypeOf resolves', statusTypeOf(STATUSES, 'Done') === 'closed')
check('statusTypeOf unknown -> null', statusTypeOf(STATUSES, 'Nope') === null)

// ---------------- duration vs formatDuration ----------------
// duration() takes timestamps; formatDuration() takes a span already in ms.
// Passing a 0 timestamp to duration() used to yield "—" and blanked the SLA
// target and overdue readouts.
check('formatDuration handles a plain span', formatDuration(8 * HR) === '8h', formatDuration(8*HR))
check('formatDuration of zero is 0s', formatDuration(0) === '0s', formatDuration(0))
check('formatDuration of a day', formatDuration(DAY) === '1d')
check('formatDuration negative clamps', formatDuration(-5) === '0s')
check('formatDuration null is a dash', formatDuration(null) === '—')
check('duration still rejects a missing timestamp', duration(null) === '—')
check('duration accepts epoch 0 as a real timestamp',
  duration(0, 8 * HR) === '8h', duration(0, 8 * HR))

done()
