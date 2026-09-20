import { reporter } from './setup.js'
import { decorate, UNSET, UNTRIAGED } from '../src/lib/reports.js'
import {
  BREACHING_RATIO, breachingSla, breakdown, myIssues, notDone, summarise,
} from '../src/lib/dashboard.js'

const { check, done } = reporter()

const HR = 3_600_000, DAY = 86_400_000
// A fixed instant, so "3 days ago" means the same thing on every run.
const NOW = new Date('2026-06-15T12:00:00Z').getTime()
const ago = (ms) => new Date(NOW - ms).toISOString()

const STATUS_TYPES = { New: 'new', Triaged: 'in_progress', 'On Hold': 'paused', Done: 'closed' }
// The target hangs off the severity, so an untriaged ticket has none, and a
// severity with no configured target gives its tickets none either.
const SLA_HOURS = { High: 8, Moderate: 24 }

const ME = 'user-1', OTHER = 'user-2'

const ISSUES = [
  // mine, 7.2h of an 8h target — 90% gone, the most urgent open ticket
  { id: 'a', number: 1, title: 'Export spins', severity: 'High', status: 'Triaged',
    assignee_id: ME, submitted_date: ago(7.2 * HR), closed_at: null },
  // mine, 2h of an 8h target — 25%, nowhere near
  { id: 'b', number: 2, title: 'Typo on invoice', severity: 'High', status: 'New',
    assignee_id: ME, submitted_date: ago(2 * HR), closed_at: null },
  // mine, untriaged and very old: no target, so it can never be "breaching"
  { id: 'c', number: 3, title: 'Odd log line', severity: null, status: 'New',
    assignee_id: ME, submitted_date: ago(40 * DAY), closed_at: null },
  // someone else's, 5 days into a 24h target — breached
  { id: 'd', number: 4, title: 'Payments down', severity: 'Moderate', status: 'Triaged',
    assignee_id: OTHER, submitted_date: ago(5 * DAY), closed_at: null },
  // unassigned and paused: still open, and the pause does not remove it
  { id: 'e', number: 5, title: 'Waiting on customer', severity: 'Moderate', status: 'On Hold',
    assignee_id: null, submitted_date: ago(2 * DAY), closed_at: null, paused_ms: 2 * DAY },
  // mine, but closed — done work is not queue work anywhere on this page
  { id: 'f', number: 6, title: 'Old bug', severity: 'High', status: 'Done',
    assignee_id: ME, submitted_date: ago(9 * DAY), closed_at: ago(8 * DAY) },
]

const rows = decorate(ISSUES, {
  statusTypeByName: STATUS_TYPES, slaHoursBySeverity: SLA_HOURS, now: NOW,
})
const ids = (list) => list.map((r) => r.id).join(',')

// ---------------- what counts as still open ----------------
check('closed tickets are dropped', ids(notDone(rows)) === 'a,b,c,d,e')
check('a paused ticket is still open', notDone(rows).some((r) => r.id === 'e'))

// ---------------- my issues ----------------
const mine = myIssues(rows, ME)
check('only my open tickets', mine.every((r) => r.assignee_id === ME))
check('my closed ticket is not in my queue', !mine.some((r) => r.id === 'f'))
check('most of the target consumed comes first', ids(mine) === 'a,b,c')
check('a ticket with no target sorts last', mine[mine.length - 1].id === 'c')
check('no user means no queue, not everyone\'s', myIssues(rows, null).length === 0)
check('a user with nothing assigned gets an empty list',
  myIssues(rows, 'nobody').length === 0)
// The row carries what the card draws: a title, a severity and a clock.
check('each row carries what the card shows',
  mine.every((r) => r.title != null && 'severity' in r && r.sla.elapsedMs >= 0))

// ---------------- breaching SLA ----------------
const hot = breachingSla(rows)
check('the threshold is 75%', BREACHING_RATIO === 0.75)
check('only tickets at or past 75% of target', ids(hot) === 'd,a')
check('already-breached tickets are included', hot.some((r) => r.sla.state === 'breached'))
check('a 25%-consumed ticket is left out', !hot.some((r) => r.id === 'b'))
check('an untriaged ticket is never breaching', !hot.some((r) => r.id === 'c'))
check('closed tickets are never breaching', !hot.some((r) => r.id === 'f'))
// 70% is the at_risk band; the Dashboard deliberately starts later than it.
check('the threshold is adjustable',
  ids(breachingSla(rows, { ratio: 0.2 })) === 'd,a,b')

// ---------------- breakdowns ----------------
const open = notDone(rows)
const byStatus = breakdown(open, 'status', { order: ['New', 'Triaged', 'On Hold'] })
check('status counts are right',
  JSON.stringify(byStatus.map((d) => [d.name, d.value]))
    === JSON.stringify([['New', 2], ['Triaged', 2], ['On Hold', 1]]))
check('statuses read in workflow order, not by size',
  byStatus.map((d) => d.name).join(',') === 'New,Triaged,On Hold')
check('shares are of the open tickets only',
  byStatus.map((d) => d.pct).join(',') === '40,40,20')
check('closed tickets are not in the denominator',
  byStatus.reduce((n, d) => n + d.value, 0) === 5)

const byAssignee = breakdown(open, (r) => (r.assignee_id === ME ? 'Ada' : r.assignee_id),
  { unset: 'Unassigned' })
check('a breakdown can group by something off the row',
  JSON.stringify(byAssignee.map((d) => [d.name, d.value, d.pct]))
    === JSON.stringify([['Ada', 3, 60], ['Unassigned', 1, 20], ['user-2', 1, 20]]),
  JSON.stringify(byAssignee))
// Equal counts are tied, so the name breaks it — the order has to be stable
// between renders, not whatever the rows happened to arrive in.
check('ties are broken by name', byAssignee[1].name < byAssignee[2].name)
check('unassigned work is named, not dropped',
  byAssignee.some((d) => d.name === 'Unassigned'))

const bySeverity = breakdown(open, 'severity', { unset: UNTRIAGED })
check('untriaged tickets get their own slice',
  bySeverity.some((d) => d.name === UNTRIAGED && d.value === 1))
check('severities are biggest first',
  bySeverity.map((d) => d.value).every((v, i, all) => i === 0 || all[i - 1] >= v))

check('an empty breakdown is empty, not a division by zero',
  breakdown([], 'status').length === 0)
check('a missing value falls back to Unspecified',
  breakdown([{ status: null }], 'status')[0].name === UNSET)
// Equal counts must never show two different percentages.
const thirds = breakdown([{ s: 'a' }, { s: 'b' }, { s: 'c' }], 's')
check('a three-way split reads 33/33/33',
  thirds.map((d) => d.pct).join(',') === '33,33,33')

// ---------------- the tiles ----------------
const stats = summarise(rows, ME)
check('open counts exclude closed work', stats.open === 5)
check('my count matches my list', stats.mine === mine.length)
check('unassigned is counted', stats.unassigned === 1)
check('untriaged is counted', stats.untriaged === 1)
check('breaching matches the list', stats.breaching === hot.length)
check('breached is a subset of breaching', stats.breached === 1 && stats.breached <= stats.breaching)
check('the tiles and the status breakdown agree',
  stats.open === byStatus.reduce((n, d) => n + d.value, 0))

done()
