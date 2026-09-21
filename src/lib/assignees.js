/**
 * Who is working a ticket.
 *
 * A ticket carries a set of people rather than one person: nobody, one, or two.
 * Two is the ceiling because support here is worked in pairs — someone holding
 * it and someone who can pick it up — and a list with no ceiling is a list
 * nobody owns. The cap is a check constraint in the database as well; this
 * module exists so the UI never offers a third seat rather than to be the guard.
 *
 * Everything here takes and returns plain arrays of profile ids, in the order
 * they were picked: first is the person the ticket is mainly on. Nothing is
 * sorted — the order is a decision, not a presentation detail.
 */

import { departmentOf } from './users'

/** How many people may be on one ticket, and on one schedule. */
export const MAX_ASSIGNEES = 2

/**
 * The assignees on a ticket, as an array.
 *
 * Tolerates null and a missing column: rows read before this shipped, and rows
 * a test builds by hand, both have to read as "nobody" rather than crash.
 */
export const assigneesOf = (issue) =>
  Array.isArray(issue?.assignee_ids) ? issue.assignee_ids.filter(Boolean) : []

/** Whether anyone at all is on the ticket. */
export const hasAssignees = (issue) => assigneesOf(issue).length > 0

/** Whether this person is one of the people on it. */
export const isAssignedTo = (issue, userId) =>
  Boolean(userId) && assigneesOf(issue).includes(userId)

/**
 * What a picker's selection becomes before it is stored: blanks dropped, the
 * same person never twice, at most two. Order is kept — the first one picked
 * stays first.
 */
export function normalizeAssignees(ids = []) {
  const seen = []
  for (const id of ids) {
    if (!id || seen.includes(id)) continue
    seen.push(id)
    if (seen.length === MAX_ASSIGNEES) break
  }
  return seen
}

/**
 * Whether two sets name the same people in the same order.
 *
 * Order counts: moving the second assignee to the front is a real change to who
 * the ticket is mainly on, and sending it as a no-op would silently lose it.
 */
export const sameAssignees = (a = [], b = []) =>
  a.length === b.length && a.every((id, i) => id === b[i])

/**
 * The department more than one of these people belong to, or null.
 *
 * A ticket's two assignees must come from two different departments. A pair is
 * meant to be two readings of the same problem — engineering and quality,
 * support and product — so two people from one department is not a pair, it is
 * the same reading twice. A set of one can never clash, which is why most
 * tickets never meet this rule at all.
 *
 * Takes profiles, not ids: the department lives on the person, and a caller
 * that cannot resolve somebody has no business guessing what they would clash
 * with. Anyone unresolved is skipped rather than assumed.
 *
 * The database enforces the same rule on tickets and on schedules.
 */
export function sharedDepartment(people = []) {
  const seen = new Set()
  for (const person of people) {
    const dept = departmentOf(person)
    if (!dept) continue
    if (seen.has(dept)) return dept
    seen.add(dept)
  }
  return null
}

/** The departments already spoken for by a set of people. */
export const departmentsTaken = (people = []) =>
  new Set(people.map(departmentOf).filter(Boolean))

/**
 * Whether this person may join the set: nobody already on it shares their
 * department, and there is still a seat.
 *
 * Somebody already in the set may always "join" it — that is what keeps them
 * clickable in a picker, so they can be taken off again.
 */
export function canJoin(people = [], candidate) {
  if (!candidate) return false
  if (people.some((p) => p?.id === candidate.id)) return true
  if (people.length >= MAX_ASSIGNEES) return false
  const dept = departmentOf(candidate)
  return !dept || !departmentsTaken(people).has(dept)
}
