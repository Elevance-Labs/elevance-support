import { reporter } from './setup.js'
import {
  slaStatus, slaBand, canTransition, allowedStatuses, effectiveStatusType,
  canEditRequestFields, statusColor, STATUS_TYPE_COLORS, STATUS_TYPES,
} from '../src/lib/sla.js'

const { check, done } = reporter()
const HR = 3_600_000, DAY = 86_400_000
const now = Date.now()
const at = (msAgo) => new Date(now - msAgo).toISOString()

const STATUSES = [
  { id: '1', name: 'New',         status_type: 'new',         is_active: true },
  { id: '2', name: 'Triaged',     status_type: 'in_progress', is_active: true },
  { id: '3', name: 'In Progress', status_type: 'in_progress', is_active: true },
  { id: '4', name: 'On Hold',     status_type: 'paused',      is_active: true },
  { id: '5', name: 'Waiting',     status_type: 'paused',      is_active: true },
  { id: '6', name: 'Done',        status_type: 'closed',      is_active: true },
]

// ---------------- status type registered ----------------
check('paused is a status type', STATUS_TYPES.includes('paused'))
check('four status types', STATUS_TYPES.length === 4, STATUS_TYPES.join(', '))

// ---------------- hardcoded colours ----------------
check('New is grey',        STATUS_TYPE_COLORS.new === '#6b7280', STATUS_TYPE_COLORS.new)
check('In Progress is blue', STATUS_TYPE_COLORS.in_progress === '#1976d2', STATUS_TYPE_COLORS.in_progress)
check('Paused is orange',   STATUS_TYPE_COLORS.paused === '#ef6c00', STATUS_TYPE_COLORS.paused)
check('Closed is green',    STATUS_TYPE_COLORS.closed === '#2e7d32', STATUS_TYPE_COLORS.closed)
check('all four colours differ', new Set(Object.values(STATUS_TYPE_COLORS)).size === 4)
check('status colour comes from its type, not the status',
  statusColor(STATUSES, 'Triaged') === statusColor(STATUSES, 'In Progress'),
  `${statusColor(STATUSES, 'Triaged')} vs ${statusColor(STATUSES, 'In Progress')}`)
check('two paused statuses share the orange',
  statusColor(STATUSES, 'On Hold') === '#ef6c00' && statusColor(STATUSES, 'Waiting') === '#ef6c00')
check('unknown status falls back', statusColor(STATUSES, 'Nope') === '#9ca3af')

// ---------------- transitions ----------------
check('New -> Paused allowed',         canTransition('new', 'paused'))
check('In Progress -> Paused allowed', canTransition('in_progress', 'paused'))
check('Closed -> Paused BLOCKED',      !canTransition('closed', 'paused'))

// pause is transparent: leaving is judged against the pre-pause status
const pausedFromNew = [
  { id: 'e1', to_status: 'New',     created_at: at(3 * DAY) },
  { id: 'e2', to_status: 'On Hold', created_at: at(2 * DAY) },
]
const pausedFromProgress = [
  { id: 'e1', to_status: 'New',         created_at: at(5 * DAY) },
  { id: 'e2', to_status: 'In Progress', created_at: at(4 * DAY) },
  { id: 'e3', to_status: 'On Hold',     created_at: at(2 * DAY) },
]
check('effective type of a ticket paused from New is new',
  effectiveStatusType(STATUSES, 'On Hold', pausedFromNew) === 'new')
check('effective type of a ticket paused from In Progress is in_progress',
  effectiveStatusType(STATUSES, 'On Hold', pausedFromProgress) === 'in_progress')
check('effective type of an unpaused ticket is its own',
  effectiveStatusType(STATUSES, 'In Progress', pausedFromProgress) === 'in_progress')
check('paused with no history falls back to new',
  effectiveStatusType(STATUSES, 'On Hold', []) === 'new')

const names = (l) => l.map((s) => s.name)
const fromPausedNew = names(allowedStatuses(STATUSES, 'On Hold', pausedFromNew))
check('paused from New can return to New', fromPausedNew.includes('New'), fromPausedNew.join(', '))
check('paused from New can go forward', fromPausedNew.includes('In Progress'))

const fromPausedProgress = names(allowedStatuses(STATUSES, 'On Hold', pausedFromProgress))
check('paused from In Progress can resume work',
  fromPausedProgress.includes('In Progress'), fromPausedProgress.join(', '))
check('paused from In Progress can close', fromPausedProgress.includes('Done'))
check('pausing is NOT a backdoor to New',
  !fromPausedProgress.includes('New'), fromPausedProgress.join(', '))
check('the current paused status stays selectable', fromPausedProgress.includes('On Hold'))
check('can switch between two paused statuses', fromPausedProgress.includes('Waiting'))

const fromClosed = names(allowedStatuses(STATUSES, 'Done', []))
check('a closed ticket cannot be paused',
  !fromClosed.includes('On Hold'), fromClosed.join(', '))

// request fields follow the effective type
const admin = { role: 'admin' }
check('pausing a New ticket keeps request fields editable',
  canEditRequestFields(admin, STATUSES, 'On Hold', pausedFromNew))
check('pausing an In Progress ticket leaves them locked',
  !canEditRequestFields(admin, STATUSES, 'On Hold', pausedFromProgress))

// ---------------- the SLA clock ----------------
const sla = (o) => slaStatus({ slaHours: 24, now, ...o })

const noPause = sla({ submittedAt: at(12 * HR), statusType: 'in_progress' })
check('no pause: 12h of 24h counted', Math.round(noPause.elapsedMs / HR) === 12,
  String(noPause.elapsedMs / HR))

// 12h old, 6h of it already banked as paused -> 6h counted
const banked = sla({ submittedAt: at(12 * HR), statusType: 'in_progress', pausedMs: 6 * HR })
check('banked pause is subtracted', Math.round(banked.elapsedMs / HR) === 6,
  String(banked.elapsedMs / HR))
check('banked pause is reported', Math.round(banked.pausedMs / HR) === 6)
check('subtracting a pause can pull a ticket back under target',
  noPause.ratio > banked.ratio)

// currently paused: the open pause counts too
const live = sla({
  submittedAt: at(12 * HR), statusType: 'paused',
  pausedMs: 2 * HR, pausedSince: at(4 * HR),
})
check('an open pause is subtracted as well',
  Math.round(live.elapsedMs / HR) === 6, String(live.elapsedMs / HR))
check('paused ticket is flagged paused', live.isPaused)
check('paused ticket is not flagged closed', !live.isClosed)
check('paused label says so', slaBand(live).label.includes('paused'), slaBand(live).label)

// the clock genuinely stops: same ticket, two different "now"s
const t0 = slaStatus({
  submittedAt: at(12 * HR), statusType: 'paused', slaHours: 24,
  pausedMs: 0, pausedSince: at(4 * HR), now,
})
const t1 = slaStatus({
  submittedAt: at(12 * HR), statusType: 'paused', slaHours: 24,
  pausedMs: 0, pausedSince: at(4 * HR), now: now + 3 * HR,
})
check('elapsed does not advance while paused',
  t0.elapsedMs === t1.elapsedMs, `${t0.elapsedMs} vs ${t1.elapsedMs}`)

// and resumes afterwards: unpaused, 6h banked
const resumed = slaStatus({
  submittedAt: at(12 * HR), statusType: 'in_progress', slaHours: 24,
  pausedMs: 6 * HR, pausedSince: null, now,
})
const resumedLater = slaStatus({
  submittedAt: at(12 * HR), statusType: 'in_progress', slaHours: 24,
  pausedMs: 6 * HR, pausedSince: null, now: now + 3 * HR,
})
check('elapsed advances again once resumed',
  resumedLater.elapsedMs - resumed.elapsedMs === 3 * HR,
  String((resumedLater.elapsedMs - resumed.elapsedMs) / HR))

// pause time is excluded from a closed ticket too
const closedWithPause = slaStatus({
  submittedAt: at(10 * DAY), closedAt: at(5 * DAY), statusType: 'closed',
  slaHours: 24, pausedMs: 4 * DAY, now,
})
check('pause is excluded from a closed ticket',
  Math.round(closedWithPause.elapsedMs / DAY) === 1, String(closedWithPause.elapsedMs / DAY))
check('a closed-and-paused ticket is not labelled paused',
  !slaBand(closedWithPause).label.includes('paused'), slaBand(closedWithPause).label)

// guards
check('elapsed never goes negative',
  sla({ submittedAt: at(1 * HR), statusType: 'in_progress', pausedMs: 99 * DAY }).elapsedMs === 0)
check('missing pause fields behave like no pause',
  sla({ submittedAt: at(6 * HR), statusType: 'in_progress' }).pausedMs === 0)
check('pausedSince without a paused status is ignored',
  Math.round(sla({ submittedAt: at(6 * HR), statusType: 'in_progress', pausedSince: at(3 * HR) })
    .elapsedMs / HR) === 6)

done()
