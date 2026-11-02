/**
 * Grouping the Issues list: which group a ticket lands in, and the order the
 * groups read in.
 */
import { reporter } from './setup.js'
import { DEFAULT_GROUP_BY, groupIssues, isGroupBy } from '../src/lib/grouping.js'

const { check, done } = reporter()

const rows = [
  { id: 1, status: 'Done', severity: 'S2', company: 'Wupi', assignee_ids: ['ada'] },
  { id: 2, status: 'Open', severity: null, company: null, assignee_ids: ['ada', 'grace'] },
  { id: 3, status: 'Open', severity: 'S1', company: 'Acme', assignee_ids: [] },
  { id: 4, status: 'Legacy', severity: 'S1', company: 'Acme', assignee_ids: ['grace'] },
]
const shape = (groups) => groups.map((g) => `${g.label}:${g.rows.map((r) => r.id).join('')}`).join(' | ')

check('status is the default', DEFAULT_GROUP_BY === 'status' && isGroupBy('status'))
check('an unknown choice is not a grouping', !isGroupBy('type') && !isGroupBy(null))
check('none means no groups', groupIssues(rows, 'none') === null)

check('statuses follow the configured order; one it does not name comes after',
  shape(groupIssues(rows, 'status', { order: ['Open', 'Done'] })) === 'Open:23 | Done:1 | Legacy:4',
  shape(groupIssues(rows, 'status', { order: ['Open', 'Done'] })))
check('severity follows its list, untriaged last',
  shape(groupIssues(rows, 'severity', { order: ['S1', 'S2'] })) === 'S1:34 | S2:1 | Not triaged:2')
check('companies read alphabetically, none last',
  shape(groupIssues(rows, 'company')) === 'Acme:34 | Wupi:1 | No company:2')

const names = { ada: 'Ada', grace: 'Grace' }
const byPerson = groupIssues(rows, 'assignee', { nameOf: (id) => names[id] })
check('a ticket on two people is under both, unassigned last',
  shape(byPerson) === 'Ada:12 | Grace:24 | Unassigned:3', shape(byPerson))
check('a group keeps the id as its key, the name as its label',
  byPerson[0].key === 'ada' && byPerson[0].label === 'Ada')
check('only groups with a ticket in them', groupIssues([], 'status').length === 0)

done()
