/**
 * Status types and SLA calculation.
 *
 * Every status belongs to one of three status types. A ticket may move within
 * its own type or forward to a later one, never backward:
 *
 *   new (0) ──▶ in_progress (1) ──▶ closed (2)
 *
 * Two things gate a move out of `new`, and both are enforced by the database
 * too: a severity (how bad it is) and an assignee (who has it). See
 * `needsSeverity` and `needsAssignee` below — they differ over `closed`.
 *
 * The SLA clock starts when the ticket is submitted and stops the moment it
 * reaches a status of type `closed`. Its target comes from the ticket's
 * severity: an untriaged ticket keeps counting but is measured against nothing,
 * and once a severity is assigned the target applies to the whole elapsed time,
 * not to the part of it since triage.
 */

import { toMillis } from './format'
import { hasAssignees } from './assignees'

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

/**
 * Status types a ticket may not enter until a severity has been assigned.
 *
 * Triage has to happen before work does: nobody starts on a ticket, or parks
 * one, without having said how bad it is. `closed` is deliberately not gated —
 * a request can always be answered or rejected outright without triage.
 */
export const SEVERITY_REQUIRED_TYPES = ['in_progress', 'paused']

/** Whether entering this status type needs a severity on the ticket first. */
export const needsSeverity = (statusType) =>
  SEVERITY_REQUIRED_TYPES.includes(statusType)

/** A severity counts as assigned only if it is a non-blank name. */
export const hasSeverity = (severity) =>
  typeof severity === 'string' && severity.trim() !== ''

/**
 * Whether entering this status type needs somebody on the ticket first.
 *
 * Everything but `new` does — including `closed`, which is where this parts
 * company with the severity gate above. An untriaged request can be rejected
 * outright, because nobody had to judge it to say no; but somebody did say no,
 * and the ticket should record who.
 */
export const needsAssignee = (statusType) =>
  Boolean(statusType) && statusType !== 'new'

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
 *
 * `severity` is the ticket's severity and `assignees` the people on it, each
 * checked only against the types that need one. Omitting either means "not
 * being checked here" rather than "the ticket has none" — the database is the
 * real guard, and defaulting to a block would quietly freeze every caller that
 * doesn't know about these gates yet.
 */
export function canTransition(fromType, toType, { severity, assignees } = {}) {
  if (!fromType || !toType) return true
  if (severity !== undefined && needsSeverity(toType) && !hasSeverity(severity)) return false
  if (assignees !== undefined && needsAssignee(toType) && !hasAssignees({ assignee_ids: assignees }))
    return false
  if (toType === 'paused') return fromType !== 'closed'
  if (fromType === 'paused') return true   // caller should pass the effective type
  return statusRank(toType) >= statusRank(fromType)
}

/**
 * The statuses a ticket may move to. Pass the timeline so a paused ticket is
 * judged against the status it was paused from, and the ticket's severity and
 * assignees so the ones that need them are withheld until they are set.
 *
 * A ticket that is still New is offered no New status at all — not even the one
 * it is sitting in. New means nobody has looked at it yet, so opening it and
 * saving it as New is the one outcome worth making awkward: the choice on the
 * table is to triage it and start, park it, or answer it outright. The database
 * allows New → New (a ticket has to be able to sit in the queue), so this is a
 * nudge in the one place a human is making the decision, not a rule.
 */
export function allowedStatuses(
  statuses, currentStatus, events = [], { severity, assignees } = {},
) {
  const fromType = effectiveStatusType(statuses, currentStatus, events)
  const stuckInNew = fromType === 'new'
  return statuses.filter((s) => {
    if (stuckInNew && s.status_type === 'new') return false
    // Otherwise the current value always stays selectable, so an inactive or
    // unrecognised status never disappears from under the person reading it.
    return s.name === currentStatus
      || (s.is_active && canTransition(fromType, s.status_type, { severity, assignees }))
  })
}

/**
 * SLA target hours by severity name — the join every SLA reading needs, in one
 * place so the Issues grid, the Board, the ticket and the reports cannot
 * disagree about what a ticket was committed to.
 */
export const slaHoursBySeverity = (severities = []) =>
  Object.fromEntries(severities.map((s) => [s.name, s.sla_hours]))

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
