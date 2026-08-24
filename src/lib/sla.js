/**
 * Status types and SLA calculation.
 *
 * Every status belongs to one of three status types. A ticket may move within
 * its own type or forward to a later one, never backward:
 *
 *   new (0) ──▶ in_progress (1) ──▶ closed (2)
 *
 * The SLA clock starts when the ticket is submitted and stops the moment it
 * reaches a status of type `closed`.
 */

import { toMillis } from './format'

export const STATUS_TYPES = ['new', 'in_progress', 'paused', 'closed']

export const STATUS_TYPE_LABELS = {
  new: 'New',
  in_progress: 'In Progress',
  paused: 'Paused',
  closed: 'Closed',
}

/**
 * Statuses are coloured by their type, not individually — so every "in progress"
 * status looks the same wherever it appears, whatever it is called.
 */
export const STATUS_TYPE_COLORS = {
  new: '#6b7280',          // grey
  in_progress: '#1976d2',  // blue
  paused: '#ef6c00',       // orange
  closed: '#2e7d32',       // green
}

/** Colour for a status name, via its type. */
export const statusColor = (statuses, name) =>
  STATUS_TYPE_COLORS[statusTypeOf(statuses, name)] ?? '#9ca3af'

// Paused deliberately has no rank: it suspends whatever the ticket was doing
// rather than being a step in the workflow.
const RANK = { new: 0, in_progress: 1, closed: 2 }

export const statusRank = (statusType) => RANK[statusType] ?? -1

/** Look up a status name's type from the configured status list. */
export const statusTypeOf = (statuses, name) =>
  statuses.find((s) => s.name === name)?.status_type ?? null

/**
 * The type a ticket is really in, ignoring any pause: the most recent status
 * that wasn't paused. Pausing is a suspension, so it must not become a way to
 * move backwards — a ticket paused while In Progress still cannot return to New.
 *
 * `events` is the status timeline, oldest first.
 */
export function effectiveStatusType(statuses, currentStatus, events = []) {
  const current = statusTypeOf(statuses, currentStatus)
  if (current !== 'paused') return current

  for (let i = events.length - 1; i >= 0; i--) {
    const t = statusTypeOf(statuses, events[i].to_status)
    if (t && t !== 'paused') return t
  }
  return 'new'
}

/**
 * A move is allowed when the target's type is the same as, or later than, the
 * current one. Pausing is always available (except from closed, which is
 * finished), and leaving a pause is judged against the type the ticket was in
 * before it was paused. Unknown statuses are permitted so a misconfigured list
 * can't lock a ticket in place.
 */
export function canTransition(fromType, toType) {
  if (!fromType || !toType) return true
  if (toType === 'paused') return fromType !== 'closed'
  if (fromType === 'paused') return true   // caller should pass the effective type
  return statusRank(toType) >= statusRank(fromType)
}

/**
 * The statuses a ticket may move to. Pass the timeline so a paused ticket is
 * judged against the status it was paused from.
 */
export function allowedStatuses(statuses, currentStatus, events = []) {
  const fromType = effectiveStatusType(statuses, currentStatus, events)
  return statuses.filter(
    (s) =>
      s.name === currentStatus ||             // always keep the current value selectable
      (s.is_active && canTransition(fromType, s.status_type)),
  )
}

/**
 * Request fields are editable by admins/managers, only while the ticket is
 * effectively "new" — pausing a new ticket doesn't quietly lock them.
 */
export function canEditRequestFields(profile, statuses, currentStatus, events = []) {
  const role = profile?.role
  if (role !== 'admin' && role !== 'manager') return false
  return effectiveStatusType(statuses, currentStatus, events) === 'new'
}

/**
 * SLA colour bands, by fraction of the target consumed.
 *
 *   under 40%   blue     on track
 *   40% – 70%   yellow   watch
 *   70% – 100%  orange   at risk
 *   over 100%   red      breached
 *
 * Boundaries sit at the start of each band: exactly 40% is yellow, exactly 70%
 * is orange. Only going *past* the target counts as a breach, so a ticket
 * sitting at exactly 100% is still orange.
 */
export const SLA_BANDS = [
  { state: 'on_track', from: 0,    label: 'On track',      color: '#1565c0', contrastText: '#ffffff' },
  { state: 'watch',    from: 0.40, label: 'Watch',         color: '#f9a825', contrastText: 'rgba(0,0,0,0.87)' },
  { state: 'at_risk',  from: 0.70, label: 'At risk',       color: '#ef6c00', contrastText: '#ffffff' },
  { state: 'breached', from: 1.00, label: 'SLA breached',  color: '#c62828', contrastText: '#ffffff' },
]

const NO_SLA = {
  state: 'none', label: 'No SLA', color: '#78909c', contrastText: '#ffffff',
}

/** The band a consumed-fraction falls into. */
export function bandFor(ratio) {
  if (ratio == null) return NO_SLA
  // A breach is strictly past the target, so 100% exactly stays in the orange band.
  if (ratio > 1) return SLA_BANDS[3]
  let match = SLA_BANDS[0]
  for (const band of SLA_BANDS) {
    if (ratio >= band.from && band.state !== 'breached') match = band
  }
  return match
}

/** Presentation for an SLA result: colour, contrast colour and wording. */
export function slaBand(sla) {
  if (!sla || sla.state === 'none') return NO_SLA
  const band = SLA_BANDS.find((b) => b.state === sla.state) ?? NO_SLA
  // A closed ticket that never breached is reported as met, keeping its band colour.
  if (sla.isClosed && sla.state !== 'breached') return { ...band, label: 'Met SLA' }
  // A paused ticket keeps its band colour but says the clock is stopped.
  if (sla.isPaused) return { ...band, label: `${band.label} · paused` }
  return band
}

/**
 * Work out where a ticket stands against its type's SLA.
 *
 * Returns:
 *   state    'none' | 'on_track' | 'watch' | 'at_risk' | 'breached'
 *   elapsedMs   time on the clock (frozen once closed, excluding pauses)
 *   targetMs    the SLA target, or null when the type has none
 *   overdueMs   how far past target, when breached
 *   isClosed    whether the clock has stopped for good
 *   isPaused    whether the clock is currently suspended
 *   pausedMs    total time excluded because the ticket was paused
 */
export function slaStatus({
  submittedAt,
  closedAt = null,
  statusType = null,
  slaHours = null,
  pausedMs = 0,
  pausedSince = null,
  now = Date.now(),
}) {
  const start = submittedAt ? toMillis(submittedAt) : null
  const isClosed = statusType === 'closed'
  const isPaused = statusType === 'paused'

  // A closed ticket without a recorded closed_at falls back to now, so the
  // clock never keeps ticking on something that is finished.
  const end = isClosed ? (closedAt ? toMillis(closedAt) : now) : now

  // Time spent paused doesn't count against the SLA: `pausedMs` is what has
  // already been banked by earlier pauses, plus whatever the current pause has
  // run for so far.
  const banked = Number(pausedMs) || 0
  const openPause = isPaused && pausedSince
    ? Math.max(now - toMillis(pausedSince), 0)
    : 0
  const excluded = banked + openPause

  const gross = start == null || Number.isNaN(start) ? 0 : Math.max(end - start, 0)
  const elapsedMs = Math.max(gross - excluded, 0)

  if (!slaHours || slaHours <= 0) {
    return {
      state: 'none', elapsedMs, targetMs: null, overdueMs: 0,
      isClosed, isPaused, pausedMs: excluded, ratio: null,
    }
  }

  const targetMs = slaHours * 3600_000
  const ratio = elapsedMs / targetMs
  const breached = elapsedMs > targetMs

  return {
    state: bandFor(ratio).state,
    elapsedMs,
    targetMs,
    overdueMs: breached ? elapsedMs - targetMs : 0,
    isClosed,
    isPaused,
    pausedMs: excluded,
    ratio,
  }
}
