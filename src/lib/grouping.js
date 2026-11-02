/**
 * Grouping the Issues list: which fields a list may be grouped by, which group
 * a ticket falls in, and the order the groups read in.
 *
 * Pure — the page decides how a group is drawn and whether it is folded away.
 */

import { assigneesOf } from './assignees'

export const GROUP_BY = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'severity', label: 'Severity' },
  { value: 'company', label: 'Company' },
  { value: 'assignee', label: 'Assignee' },
]

export const DEFAULT_GROUP_BY = 'status'

export const isGroupBy = (value) => GROUP_BY.some((g) => g.value === value)

/** What a ticket with nothing in the field is filed under. */
const EMPTY = {
  status: 'No status',
  severity: 'Not triaged',
  company: 'No company',
  assignee: 'Unassigned',
}

// A ticket on two people is in both their groups, as it is on both their
// queues — so this yields a list of keys, never just one.
const KEYS = {
  status: (r) => [r.status ?? ''],
  severity: (r) => [r.severity ?? ''],
  company: (r) => [r.company ?? ''],
  assignee: (r) => (assigneesOf(r).length ? assigneesOf(r) : ['']),
}

/**
 * Tickets in groups: `[{ key, label, rows }]`, or null for `none`.
 *
 * `order` is the configured list (status or severity rows, by name) the
 * groups follow; anything it does not name comes after, alphabetically, and
 * the empty group is always last. `nameOf` labels an assignee group.
 * Tickets keep the order they arrived in within a group. Only groups with a
 * ticket in them are returned.
 */
export function groupIssues(rows, by, { order = [], nameOf = (id) => id } = {}) {
  const keysOf = KEYS[by]
  if (!keysOf) return null
  const groups = new Map()
  for (const r of rows) {
    for (const key of keysOf(r)) {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
  }
  const label = (key) => (key === '' ? EMPTY[by] : by === 'assignee' ? nameOf(key) || 'Unknown' : key)
  const rank = new Map(order.map((name, i) => [name, i]))
  return [...groups.entries()]
    .map(([key, items]) => ({ key, label: label(key), rows: items }))
    .sort((a, b) => {
      if (a.key === '' || b.key === '') return (a.key === '') - (b.key === '')
      const ra = rank.get(a.key) ?? Infinity
      const rb = rank.get(b.key) ?? Infinity
      if (ra !== rb) return ra - rb
      return a.label.localeCompare(b.label)
    })
}
