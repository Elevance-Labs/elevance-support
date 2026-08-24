import { reporter } from './setup.js'
import {
  RANGES, UNSET, ageing, bucketUnit, countBy, decorate, inRange, median,
  needsAttention, openBySlaBand, rangeStart, slaByType, summarise, volumeSeries,
} from '../src/lib/reports.js'

const { check, done } = reporter()

const HR = 3_600_000, DAY = 86_400_000
// A fixed instant, so "3 days ago" means the same thing on every run.
const NOW = new Date('2026-06-15T12:00:00Z').getTime()
const ago = (ms) => new Date(NOW - ms).toISOString()

const STATUS_TYPES = { New: 'new', Triaged: 'in_progress', Done: 'closed' }
const SLA_HOURS = { Bug: 8, Question: 24, 'Feature Request': null }

const ISSUES = [
  // closed inside target: 4h of an 8h target
  { id: 'a', ref: 1, type: 'Bug', product: 'Mobile App', area: 'Billing', priority: 'High',
    status: 'Done', submitted_date: ago(2 * DAY), closed_at: ago(2 * DAY - 4 * HR) },
  // closed past target: 20h of an 8h target
  { id: 'b', ref: 2, type: 'Bug', product: 'Mobile App', area: 'Billing', priority: 'High',
    status: 'Done', submitted_date: ago(3 * DAY), closed_at: ago(3 * DAY - 20 * HR) },
  // open, 6h into an 8h target — at risk, not yet breached
  { id: 'c', ref: 3, type: 'Bug', product: 'Web', area: 'Search', priority: 'Low',
    status: 'Triaged', submitted_date: ago(6 * HR), closed_at: null },
  // open, 5 days into a 24h target — breached
  { id: 'd', ref: 4, type: 'Question', product: 'Web', area: null, priority: 'Low',
    status: 'New', submitted_date: ago(5 * DAY), closed_at: null },
  // open, type has no target at all
  { id: 'e', ref: 5, type: 'Feature Request', product: null, area: 'Search', priority: null,
    status: 'New', submitted_date: ago(40 * DAY), closed_at: null },
]

const rows = decorate(ISSUES, {
  statusTypeByName: STATUS_TYPES, slaHoursByType: SLA_HOURS, now: NOW,
})

// ---------------- decoration ----------------
check('closed tickets are recognised by status type',
  rows.filter((r) => r.isClosed).map((r) => r.id).join(',') === 'a,b')
check('SLA rides along on every row', rows.every((r) => r.sla != null))
check('a type without a target gets no SLA state',
  rows.find((r) => r.id === 'e').sla.state === 'none')
check('the open breach is spotted', rows.find((r) => r.id === 'd').sla.state === 'breached')
check('under target while open is not a breach',
  rows.find((r) => r.id === 'c').sla.state === 'at_risk')

// ---------------- the headline numbers ----------------
const stats = summarise(rows)
check('total counts every ticket', stats.total === 5, String(stats.total))
check('open and closed split the total', stats.open === 3 && stats.closed === 2)
check('breaches counted across open and closed', stats.breached === 2, String(stats.breached))
check('only open breaches in the open figure', stats.openBreached === 1)
// 4 measurable tickets (Bug ×3, Question ×1), 2 of them breached
check('met % measured only over tickets with a target',
  stats.measured === 4 && stats.slaMetPct === 50, `${stats.measured}/${stats.slaMetPct}`)
check('median close time is the middle of the closed ones',
  stats.medianResolutionMs === 12 * HR, String(stats.medianResolutionMs / HR))

const noTargets = summarise(decorate(ISSUES, { statusTypeByName: STATUS_TYPES, now: NOW }))
check('no configured targets reports "—", not 100%', noTargets.slaMetPct === null)

// ---------------- ranges ----------------
check('all time has no start', rangeStart(null, NOW) === null)
check('a 7-day range spans 7 whole days, today included',
  rangeStart(7, NOW) === new Date('2026-06-09T00:00:00Z').getTime()
  || new Date(rangeStart(7, NOW)).getDate() === 9)
check('the range presets are the four offered', RANGES.length === 4)
check('inRange keeps only tickets submitted since the start',
  inRange(rows, rangeStart(7, NOW)).map((r) => r.id).join(',') === 'a,b,c,d')
check('a null start keeps everything', inRange(rows, null).length === 5)

// ---------------- breakdowns ----------------
const byProduct = countBy(rows, 'product')
check('counts come back biggest first',
  byProduct[0].name === 'Mobile App' || byProduct[0].name === 'Web')
check('a missing value is labelled, not dropped',
  byProduct.some((d) => d.name === UNSET && d.value === 1))
check('every ticket lands in exactly one bucket',
  byProduct.reduce((n, d) => n + d.value, 0) === 5)

const many = Array.from({ length: 12 }, (_, i) => ({
  product: `P${i}`, submitted_date: ago(DAY), status: 'New',
}))
const folded = countBy(decorate(many, { statusTypeByName: STATUS_TYPES, now: NOW }), 'product', { topN: 5 })
check('the long tail folds into Other rather than growing the chart',
  folded.length === 5 && folded[4].name === 'Other' && folded[4].value === 8,
  `${folded.length} rows, tail ${folded[4].value}`)

// ---------------- ageing ----------------
const ages = ageing(rows, NOW)
check('ageing covers only open tickets',
  ages.reduce((n, d) => n + d.value, 0) === 3, String(ages.reduce((n, d) => n + d.value, 0)))
check('6h old sits under a day', ages[0].value === 1)
check('5 days old sits in the 3–7 day band', ages[2].value === 1)
check('40 days old sits in the last band', ages[4].value === 1)

// ---------------- SLA bands & per-type table ----------------
const bands = openBySlaBand(rows)
const bandValue = (state) => bands.find((b) => b.state === state).value
check('open tickets are placed in their current band',
  bandValue('at_risk') === 1 && bandValue('breached') === 1 && bandValue('none') === 1)

const table = slaByType(rows)
const bug = table.find((t) => t.name === 'Bug')
check('the per-type table is sorted by volume', table[0].name === 'Bug')
check('a type splits into open and closed', bug.total === 3 && bug.open === 1 && bug.closed === 2)
check('the type carries its target', bug.targetMs === 8 * HR)
check('one breach in three Bugs is 67% met', bug.metPct === 67, String(bug.metPct))
check('a type with no target reports no percentage',
  table.find((t) => t.name === 'Feature Request').metPct === null)

// ---------------- volume over time ----------------
const series = volumeSeries(rows, { from: rangeStart(7, NOW), to: NOW, unit: 'day' })
check('a 7-day span draws 7 buckets', series.length === 7, String(series.length))
check('quiet days are drawn as zero, not skipped',
  series.every((b) => typeof b.submitted === 'number' && typeof b.closed === 'number'))
check('submissions inside the span are all counted',
  series.reduce((n, b) => n + b.submitted, 0) === 4)
check('closures are counted on the day they closed',
  series.reduce((n, b) => n + b.closed, 0) === 2)
// The chart and the tiles must agree about what "in the range" means.
const shortStart = rangeStart(2, NOW)
check('tickets older than the span are left out',
  volumeSeries(rows, { from: shortStart, to: NOW, unit: 'day' })
    .reduce((n, b) => n + b.submitted, 0) === inRange(rows, shortStart).length)

check('short spans bucket by day', bucketUnit(NOW - 30 * DAY, NOW) === 'day')
check('a year buckets by week', bucketUnit(NOW - 200 * DAY, NOW) === 'week')
check('multiple years bucket by month', bucketUnit(NOW - 800 * DAY, NOW) === 'month')

// ---------------- what needs attention ----------------
const worst = needsAttention(rows)
check('the most-consumed open ticket comes first', worst[0].id === 'd')
check('open tickets without a target are left off',
  worst.every((r) => r.sla.ratio != null) && worst.length === 2)
check('closed tickets never appear', worst.every((r) => !r.isClosed))

// ---------------- median ----------------
check('median of an empty set is null, not zero', median([]) === null)
check('median of an even set averages the middle two', median([1, 3, 5, 9]) === 4)
check('median of an odd set is the middle', median([5, 1, 3]) === 3)

done()
