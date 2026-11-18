/**
 * A check-in: going through the open tickets one at a time, as a team, and
 * not moving on from one until what was said about it is written on it — a
 * status change, or a comment. The point is that next steps agreed out loud
 * end up on the ticket rather than in somebody's memory.
 *
 * Nothing here is stored. A check-in is a way of running a meeting over the
 * ticket's own record: what it leaves behind is the comments and the status
 * events, which the ticket already keeps.
 */

import { toMillis } from './format'

/** What counts as having dealt with a ticket, and how each reads afterwards. */
export const CHECK_IN_ACTIONS = {
  status: 'Status changed',
  comment: 'Comment added',
  // An admin may delete a ticket mid check-in; there is nothing left to wait on.
  deleted: 'Deleted',
}

/**
 * The order a check-in takes open work in: the pipeline read from its far end
 * — what is being worked, then what is stuck, then what has not started. A
 * status whose type is unknown goes last.
 */
export const CHECK_IN_ORDER = ['in_progress', 'paused', 'new']

/**
 * The tickets a check-in walks through: the open ones among `issues`, each
 * once, in `CHECK_IN_ORDER` by status type and oldest submitted first within
 * each. The page decides *which* tickets (its filters); the order is the
 * check-in's own, so a meeting runs the same from the Board as from Issues,
 * however either is sorted. `statusTypeOf` maps a status name to its type; a
 * ticket whose status is unknown counts as open, since nobody has said it is
 * done.
 */
export function checkInQueue(issues, statusTypeOf) {
  const seen = new Set()
  const queue = []
  for (const i of issues ?? []) {
    if (!i || seen.has(i.id)) continue
    if (statusTypeOf(i.status) === 'closed') continue
    seen.add(i.id)
    queue.push(i)
  }
  const rank = (i) => {
    const r = CHECK_IN_ORDER.indexOf(statusTypeOf(i.status))
    return r < 0 ? CHECK_IN_ORDER.length : r
  }
  // A ticket with no submission date has no age to judge, so it goes after
  // the dated ones; the number settles a tie, so the order is always the same.
  const age = (i) => {
    const t = toMillis(i.submitted_date)
    return Number.isFinite(t) ? t : Infinity
  }
  return queue.sort((a, b) => rank(a) - rank(b)
    || age(a) - age(b)
    || (a.number ?? 0) - (b.number ?? 0))
}

/** A check-in just started over `ids`: on the first ticket, nothing done yet. */
export const startCheckIn = (ids) => ({ ids: [...ids], index: 0, actions: {} })

/** The ticket the check-in is on. */
export const currentId = (state) => state.ids[state.index] ?? null

/** What has been done to a ticket during this check-in, in the order it happened. */
export const actionsOf = (state, id) => state.actions[id] ?? []

/** Whether a ticket has had a status change or a comment yet. */
export const isAddressed = (state, id) => actionsOf(state, id).length > 0

/** Records `action` against a ticket. Repeats are kept once. */
export function recordAction(state, id, action) {
  if (!CHECK_IN_ACTIONS[action] || !state.ids.includes(id)) return state
  const done = actionsOf(state, id)
  if (done.includes(action)) return state
  return { ...state, actions: { ...state.actions, [id]: [...done, action] } }
}

/** Whether the ticket on screen has been dealt with, so the check-in may move on. */
export const canAdvance = (state) => isAddressed(state, currentId(state))

/** Whether this is the last ticket, so moving on finishes the check-in. */
export const isLast = (state) => state.index >= state.ids.length - 1

/**
 * On to the next ticket — only once this one has been dealt with. Every ticket
 * behind the current one has been, so stepping forward again after stepping
 * back is never held up.
 */
export function advance(state) {
  if (!canAdvance(state) || isLast(state)) return state
  return { ...state, index: state.index + 1 }
}

/** Back to the previous ticket, to add to what was said about it. */
export const goBack = (state) =>
  state.index > 0 ? { ...state, index: state.index - 1 } : state

/** How far through: tickets dealt with, out of how many. */
export function checkInProgress(state) {
  const addressed = state.ids.filter((id) => isAddressed(state, id)).length
  return { addressed, total: state.ids.length, position: state.index + 1 }
}

/**
 * What a check-in came to: how many tickets got a status change, a comment,
 * were deleted, and which were never dealt with — the ones still waiting when
 * it was ended early.
 */
export function checkInSummary(state) {
  const count = (action) => state.ids.filter((id) => actionsOf(state, id).includes(action)).length
  const missed = state.ids.filter((id) => !isAddressed(state, id))
  return {
    total: state.ids.length,
    addressed: state.ids.length - missed.length,
    statusChanges: count('status'),
    comments: count('comment'),
    deleted: count('deleted'),
    missed,
    complete: missed.length === 0,
  }
}
