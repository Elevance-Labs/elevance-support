/**
 * Reporting aggregations.
 *
 * Everything the Report page draws comes out of this module, so a number in a
 * chart, a tile and a table can never disagree — they are all derived from the
 * same decorated rows.
 *
 * Pure functions only: no React, no Supabase. The page fetches, this counts.
 */

import dayjs from 'dayjs'
import { slaStatus } from './sla'

/** Date ranges offered on the page. `days: null` means every ticket ever. */
export const RANGES = [
  { key: '7d',  label: 'Last 7 days',  days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time',     days: null },
]

/** Shown instead of an empty cell when a ticket never had the field set. */
export const UNSET = 'Unspecified'

/** The instant a range starts, or null for "all time". */
export const rangeStart = (days, now = Date.now()) =>
  days == null ? null : dayjs(now).startOf('day').subtract(days - 1, 'day').valueOf()

/**
 * Attach the status type and the SLA result to every ticket once.
 *
 * Both are joins the raw row can't do on its own: the status type lives on the
 * configured status list, the SLA target on the configured request type.
 */
export function decorate(issues, {
  statusTypeByName = {}, slaHoursByType = {}, now = Date.now(),
} = {}) {
  return issues.map((issue) => {
    const statusType = statusTypeByName[issue.status] ?? null
    return {
      ...issue,
      statusType,
      isClosed: statusType === 'closed',
      submittedMs: issue.submitted_date ? new Date(issue.submitted_date).getTime() : null,
      closedMs: issue.closed_at ? new Date(issue.closed_at).getTime() : null,
      sla: slaStatus({
        submittedAt: issue.submitted_date,
        closedAt: issue.closed_at,
        statusType,
        slaHours: slaHoursByType[issue.type] ?? null,
        // Paused time is excluded from the SLA, so reports must see it too or
        // their figures drift from the Issues list and Board.
        pausedMs: issue.paused_ms,
        pausedSince: issue.paused_since,
        now,
      }),
    }
  })
}

/** Tickets submitted inside the range. `from` of null keeps everything. */
export const inRange = (rows, from) =>
  from == null ? rows : rows.filter((r) => r.submittedMs != null && r.submittedMs >= from)

export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The headline numbers.
 *
 * SLA percentages are measured over tickets whose type actually has a target —
 * counting untargeted tickets as "met" would flatter the number.
 */
export function summarise(rows) {
  const closed = rows.filter((r) => r.isClosed)
  const open = rows.filter((r) => !r.isClosed)
  const withTarget = rows.filter((r) => r.sla.targetMs != null)
  const breached = withTarget.filter((r) => r.sla.state === 'breached')
  const resolutions = closed
    .filter((r) => r.submittedMs != null && r.closedMs != null)
    .map((r) => r.closedMs - r.submittedMs)

  return {
    total: rows.length,
    open: open.length,
    closed: closed.length,
    openBreached: open.filter((r) => r.sla.state === 'breached').length,
    breached: breached.length,
    measured: withTarget.length,
    // Null rather than 100% when nothing is measurable, so the tile can say so.
    slaMetPct: withTarget.length
      ? Math.round(((withTarget.length - breached.length) / withTarget.length) * 100)
      : null,
    medianResolutionMs: median(resolutions),
  }
}

/** Day / week / month, chosen so a chart never has to draw hundreds of points. */
export function bucketUnit(from, to = Date.now()) {
  const days = dayjs(to).diff(dayjs(from), 'day')
  if (days <= 45) return 'day'
  if (days <= 400) return 'week'
  return 'month'
}

/**
 * Submitted and closed counts per bucket across the whole span, including the
 * buckets where nothing happened — a gap in a time series must read as zero,
 * not as a missing point.
 */
export function volumeSeries(rows, { from, to = Date.now(), unit = 'day' } = {}) {
  if (from == null) return []
  const end = dayjs(to).startOf(unit)
  const buckets = []
  const index = new Map()

  for (let d = dayjs(from).startOf(unit); !d.isAfter(end); d = d.add(1, unit)) {
    index.set(d.valueOf(), buckets.length)
    buckets.push({ ms: d.valueOf(), submitted: 0, closed: 0 })
  }

  const bump = (when, field) => {
    if (!when) return
    const i = index.get(dayjs(when).startOf(unit).valueOf())
    if (i != null) buckets[i][field] += 1
  }
  for (const r of rows) {
    bump(r.submitted_date, 'submitted')
    bump(r.closed_at, 'closed')
  }
  return buckets
}

/**
 * Count by a field, biggest first. Anything past `topN` folds into "Other"
 * rather than growing the chart — past eight categories colour stops working
 * and the reader stops counting.
 */
export function countBy(rows, field, { topN = 8 } = {}) {
  const counts = new Map()
  for (const r of rows) {
    const name = r[field] || UNSET
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const sorted = [...counts].map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))

  if (sorted.length <= topN) return sorted
  const head = sorted.slice(0, topN - 1)
  const tail = sorted.slice(topN - 1)
  return [...head, { name: 'Other', value: tail.reduce((n, x) => n + x.value, 0) }]
}

/** How long the still-open tickets have been waiting. Ordered bands, not a ranking. */
export const AGE_BANDS = [
  { label: 'Under 1 day', max: 1 },
  { label: '1–3 days',    max: 3 },
  { label: '3–7 days',    max: 7 },
  { label: '1–2 weeks',   max: 14 },
  { label: 'Over 2 weeks', max: Infinity },
]

export function ageing(rows, now = Date.now()) {
  const counts = AGE_BANDS.map((b) => ({ name: b.label, value: 0 }))
  for (const r of rows) {
    if (r.isClosed || r.submittedMs == null) continue
    const days = (now - r.submittedMs) / 86_400_000
    counts[AGE_BANDS.findIndex((b) => days < b.max)].value += 1
  }
  return counts
}

/** Open tickets grouped by the SLA band they are sitting in right now. */
export function openBySlaBand(rows) {
  const order = ['on_track', 'watch', 'at_risk', 'breached', 'none']
  const counts = Object.fromEntries(order.map((s) => [s, 0]))
  for (const r of rows) if (!r.isClosed) counts[r.sla.state] += 1
  return order.map((state) => ({ state, value: counts[state] }))
}

/**
 * SLA performance per request type — the table behind the SLA charts.
 * `metPct` is null for a type with no target configured; it is not zero.
 */
export function slaByType(rows) {
  const groups = new Map()
  for (const r of rows) {
    const name = r.type || UNSET
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(r)
  }

  return [...groups].map(([name, group]) => {
    const measured = group.filter((r) => r.sla.targetMs != null)
    const breached = measured.filter((r) => r.sla.state === 'breached').length
    const resolutions = group
      .filter((r) => r.isClosed && r.submittedMs != null && r.closedMs != null)
      .map((r) => r.closedMs - r.submittedMs)

    return {
      name,
      total: group.length,
      open: group.filter((r) => !r.isClosed).length,
      closed: group.length - group.filter((r) => !r.isClosed).length,
      targetMs: measured[0]?.sla.targetMs ?? null,
      breached,
      metPct: measured.length ? Math.round(((measured.length - breached) / measured.length) * 100) : null,
      medianResolutionMs: median(resolutions),
    }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** The open tickets closest to (or past) their target — the "act on this" list. */
export function needsAttention(rows, { limit = 8 } = {}) {
  return rows
    .filter((r) => !r.isClosed && r.sla.ratio != null)
    .sort((a, b) => b.sla.ratio - a.sla.ratio)
    .slice(0, limit)
}
