/**
 * Dashboard aggregations.
 *
 * The Dashboard answers one question — what is open in this project right now,
 * and what should someone pick up next — so everything here counts **only the
 * tickets that are not done**. A closed ticket has no queue position, no
 * running clock and no share of "what is left"; folding it into a percentage
 * would answer a different question (see `reports.js`, which does).
 *
 * Rows arrive decorated by `decorate()` in `reports.js`: `isClosed` and `sla`
 * are joins the raw ticket cannot make on its own. Pure functions only — no
 * React, no Supabase. The page fetches, this counts.
 */

import { UNSET } from './reports'

/** Still in flight: anything whose status type isn't `closed`, pauses included. */
export const notDone = (rows) => rows.filter((r) => !r.isClosed)

/**
 * How much of its target a ticket has to have used before the Dashboard calls
 * it out.
 *
 * Deliberately tighter than the `at_risk` band (70%): the band is a colour on a
 * ticket you are already looking at, this is a list you are meant to work
 * through — and one that starts at 70% fills up with tickets that are still
 * comfortably fine.
 */
export const BREACHING_RATIO = 0.75

/**
 * Most urgent first: the largest share of the target consumed, then the longest
 * on the clock. A ticket with no target sorts last — nothing has been promised
 * about it yet, so it cannot be more urgent than something that has.
 */
export function byUrgency(a, b) {
  const left = a.sla?.ratio ?? null
  const right = b.sla?.ratio ?? null
  if (left == null && right == null) return (b.sla?.elapsedMs ?? 0) - (a.sla?.elapsedMs ?? 0)
  if (left == null) return 1
  if (right == null) return -1
  return right - left
}

/**
 * One person's open tickets, most urgent first.
 *
 * No `userId` means nobody's queue rather than everybody's: the page renders
 * before the profile has loaded, and showing the whole project for that frame
 * would be a lie about whose work it is.
 */
export function myIssues(rows, userId) {
  if (!userId) return []
  return notDone(rows).filter((r) => r.assignee_id === userId).sort(byUrgency)
}

/**
 * Open tickets that have used at least `ratio` of their target — the ones to
 * act on before they breach, and the ones that already did.
 *
 * An untriaged ticket is never here: with no severity there is no target, and a
 * ticket cannot be late for a promise nobody made. It shows up as untriaged on
 * the tiles instead, which is the thing to fix about it.
 */
export function breachingSla(rows, { ratio = BREACHING_RATIO } = {}) {
  return notDone(rows)
    .filter((r) => r.sla?.ratio != null && r.sla.ratio >= ratio)
    .sort(byUrgency)
}

/**
 * Count by a field, with each slice's share of the whole.
 *
 * `field` is a column name or a function, so a breakdown can group by something
 * the row doesn't carry — an assignee's display name lives on the profile, not
 * the ticket. Empty values collapse into one named slice rather than vanishing:
 * "unassigned" is a real state of the queue and the one worth acting on.
 *
 * `order` is the sequence to read the slices in — the configured workflow, for
 * a breakdown by status, where biggest-first would shuffle the stages of a
 * process. Anything not in it falls to the back, biggest first.
 *
 * Shares are rounded independently, so a three-way split reads 33/33/33 rather
 * than 34/33/33: two identical counts showing two different percentages is the
 * worse error on a breakdown than a column that sums to 99.
 */
export function breakdown(rows, field, { unset = UNSET, order = [] } = {}) {
  const pick = typeof field === 'function' ? field : (r) => r[field]
  const counts = new Map()
  for (const row of rows) {
    const name = pick(row) || unset
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  const total = rows.length
  const rank = (name) => {
    const i = order.indexOf(name)
    return i === -1 ? order.length : i
  }

  return [...counts]
    .map(([name, value]) => ({
      name, value, pct: total ? Math.round((value / total) * 100) : 0,
    }))
    .sort((a, b) => rank(a.name) - rank(b.name)
      || b.value - a.value
      || a.name.localeCompare(b.name))
}

/**
 * The headline counts behind the tiles. Every one of them is a count of open
 * work, so a tile and a breakdown on the same page always add up.
 *
 * `breaching` counts everything at or past the threshold, breaches included —
 * it is one list, so splitting it across two tiles would make the reader add.
 */
export function summarise(rows, userId, { ratio = BREACHING_RATIO } = {}) {
  const open = notDone(rows)
  return {
    open: open.length,
    mine: myIssues(rows, userId).length,
    unassigned: open.filter((r) => !r.assignee_id).length,
    untriaged: open.filter((r) => !r.severity).length,
    breaching: breachingSla(rows, { ratio }).length,
    breached: open.filter((r) => r.sla?.state === 'breached').length,
  }
}
