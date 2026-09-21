/**
 * The support rota: who is on a project, and when.
 *
 * A schedule is a date range — inclusive at both ends — and the one or two
 * people on support for it. When a request arrives, the database looks up the
 * schedule covering its **submitted date** and puts those people on the ticket.
 * So a ticket logged by hand against last Tuesday lands on whoever was on last
 * Tuesday, not on today's pair.
 *
 * Two schedules in one project may never overlap: otherwise "who is on for this
 * day" has two answers and the trigger quietly picks one. The database refuses
 * an overlap outright (an exclusion constraint); `overlapping()` below is what
 * lets the dialog say so before the save rather than after it.
 *
 * Dates are the plain `YYYY-MM-DD` strings Postgres returns for a `date`
 * column, and are compared as strings throughout. That is deliberate: a rota
 * boundary is a calendar day, and parsing it into a `Date` would hand it a time
 * and a zone it does not have, moving the boundary for half the team.
 */

import dayjs from 'dayjs'

export const DATE_FORMAT = 'DD MMM YYYY'

/** A `YYYY-MM-DD` day key: what the database stores and what a date input reads. */
export const toDateKey = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
}

/** Today, as the same kind of key. */
export const today = (now = Date.now()) => dayjs(now).format('YYYY-MM-DD')

/** Whether a schedule covers a day. Both ends count. */
export function covers(schedule, day) {
  const d = toDateKey(day)
  if (!d || !schedule) return false
  return toDateKey(schedule.starts_on) <= d && d <= toDateKey(schedule.ends_on)
}

/**
 * The schedule covering a day, or null.
 *
 * Returns the first match because the database guarantees there is at most one.
 * If a second ever appeared, this would be the place that hid it — so the
 * constraint, not this function, is what makes the answer right.
 */
export const scheduleFor = (schedules = [], day) =>
  schedules.find((s) => covers(s, day)) ?? null

/**
 * Where a schedule sits relative to today: 'past', 'current' or 'upcoming'.
 *
 * The three words the Projects dialog groups by — a rota is read as "who is on
 * now, who is on next, and who was on when that ticket came in".
 */
export function phaseOf(schedule, day = today()) {
  const d = toDateKey(day)
  if (covers(schedule, d)) return 'current'
  return toDateKey(schedule?.ends_on) < d ? 'past' : 'upcoming'
}

export const PHASE_LABELS = {
  current: 'On now',
  upcoming: 'Coming up',
  past: 'Past',
}

/** Whether two ranges share a day. */
export const overlaps = (a, b) =>
  toDateKey(a?.starts_on) <= toDateKey(b?.ends_on)
  && toDateKey(b?.starts_on) <= toDateKey(a?.ends_on)

/**
 * The existing schedule a candidate would collide with, or null.
 *
 * `candidate.id` is skipped so editing a schedule doesn't find itself.
 */
export const overlapping = (schedules = [], candidate) =>
  schedules.find((s) => s.id !== candidate?.id && overlaps(s, candidate)) ?? null

/** Whether a range is one the database would accept: both ends, and in order. */
export const isValidRange = (schedule) => {
  const from = toDateKey(schedule?.starts_on)
  const to = toDateKey(schedule?.ends_on)
  return Boolean(from && to && from <= to)
}

/** "12 Jan 2026 – 18 Jan 2026", or a single day when both ends are the same. */
export function formatRange(schedule) {
  const from = toDateKey(schedule?.starts_on)
  const to = toDateKey(schedule?.ends_on)
  if (!from || !to) return '—'
  const start = dayjs(from).format(DATE_FORMAT)
  if (from === to) return start
  return `${start} – ${dayjs(to).format(DATE_FORMAT)}`
}

/** How many days a schedule runs for, counting both ends. */
export const lengthInDays = (schedule) =>
  isValidRange(schedule)
    ? dayjs(toDateKey(schedule.ends_on)).diff(dayjs(toDateKey(schedule.starts_on)), 'day') + 1
    : 0

/** Newest first: the rota is read backwards from now far more often than forwards. */
export const byStartDesc = (a, b) =>
  toDateKey(b?.starts_on).localeCompare(toDateKey(a?.starts_on))
