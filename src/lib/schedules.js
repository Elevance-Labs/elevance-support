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

// ---------------------------------------------------------------------------
// The hand-over: when one support day turns into the next.
//
// A project keeps its rota in a time zone and hands over at a set time. A
// schedule day D runs from D at the hand-over to D+1 at the hand-over, so with
// Asia/Karachi and 12:00 PM, "Saad, Mon–Tue" covers Mon 12:00 PM to Wed 12:00 PM PKT —
// Tuesday night included. Mirrored by `support_day()` in the database, which is
// what assigns a ticket; the defaults (UTC, midnight) are the old midnight-UTC day.
// ---------------------------------------------------------------------------

export const DEFAULT_TIME_ZONE = 'UTC'
export const DEFAULT_HANDOVER = '00:00'

/** "HH:MM" from what Postgres returns for a `time` ("12:00:00"), or ''. */
export const toTimeKey = (value) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''))
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return ''
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * "12:00 PM" from "12:00" — a time as people read it, 12-hour like every other
 * time in the app (`DATE_TIME_FORMAT`). The stored value stays 24-hour.
 */
export function formatTime(value) {
  const key = toTimeKey(value)
  if (!key) return ''
  const [h, m] = key.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Whether this browser knows a zone name. */
export function isTimeZone(zone) {
  if (!zone || typeof zone !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch { return false }
}

/** A project's hand-over, with the defaults filled in and a bad zone dropped. */
export function handoverOf(project) {
  const zone = project?.support_time_zone
  return {
    timeZone: isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE,
    handover: toTimeKey(project?.support_handover) || DEFAULT_HANDOVER,
  }
}

/** The wall clock in a zone, as milliseconds read as if it were UTC. */
function wallClock(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(at)).map((p) => [p.type, p.value]),
  )
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
}

/**
 * The schedule day a moment belongs to in a project: its date in the
 * project's zone, after taking the hand-over time off it.
 */
export function supportDay(project, at = Date.now()) {
  const { timeZone, handover } = handoverOf(project)
  const [h, m] = handover.split(':').map(Number)
  return new Date(wallClock(at, timeZone) - (h * 60 + m) * 60_000).toISOString().slice(0, 10)
}

/** Whether a project's support day turns over at midnight, as a calendar day does. */
export const handsOverAtMidnight = (project) => handoverOf(project).handover === DEFAULT_HANDOVER

/** "12:00 PM Asia/Karachi" — the hand-over, as the rota page states it. */
export function handoverLabel(project) {
  const { timeZone, handover } = handoverOf(project)
  return `${formatTime(handover)} ${timeZone}`
}

/**
 * When a schedule stops — "Fri 28 Nov 2026" (its last day) at a midnight
 * hand-over, or "Sat 29 Nov 2026, 12:00 PM" (the moment it hands over) otherwise,
 * because "until Friday" reads as Friday evening, which is the thing that
 * stopped being true.
 */
export function shiftEnds(schedule, project) {
  if (!schedule?.ends_on) return '—'
  if (handsOverAtMidnight(project)) return formatDay(schedule.ends_on)
  return `${formatDay(addDays(schedule.ends_on, 1))}, ${formatTime(handoverOf(project).handover)}`
}

/** Every zone this browser can name, UTC first. */
export function timeZones() {
  let zones = []
  try { zones = Intl.supportedValuesOf?.('timeZone') ?? [] } catch { zones = [] }
  if (!zones.length) zones = ['Asia/Karachi', 'Asia/Dubai', 'Europe/London', 'America/New_York']
  return [DEFAULT_TIME_ZONE, ...zones.filter((z) => z !== DEFAULT_TIME_ZONE)]
}

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
 * The first schedule starting after a day, or null — what the Dashboard names
 * when nobody is on today, so a gap reads as "until when" rather than "ever".
 */
export function nextSchedule(schedules = [], day) {
  const d = toDateKey(day)
  return schedules
    .filter((s) => toDateKey(s.starts_on) > d)
    .reduce((best, s) => (!best || toDateKey(s.starts_on) < toDateKey(best.starts_on) ? s : best), null)
}

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

// ---------------------------------------------------------------------------
// The calendar the rota is drawn on.
//
// Weeks start on Monday — a rota is a working week far more often than not.
// Everything below speaks in day keys, same as the rest of this module: a cell
// is a calendar day, never an instant.
// ---------------------------------------------------------------------------

export const CALENDAR_VIEWS = ['month', 'week']

/** Column headings, Monday first. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A day key moved by whole days. */
export const addDays = (day, n) => {
  const d = toDateKey(day)
  return d ? dayjs(d).add(n, 'day').format('YYYY-MM-DD') : ''
}

/** The Monday on or before a day. */
export const weekStartOf = (day) => {
  const d = dayjs(toDateKey(day))
  return d.subtract((d.day() + 6) % 7, 'day').format('YYYY-MM-DD')
}

/** "Fri", or "Friday" with `long` — what a date field shows beside its date. */
export const weekdayOf = (day, long = false) => {
  const d = toDateKey(day)
  return d ? dayjs(d).format(long ? 'dddd' : 'ddd') : ''
}

/**
 * The days a view draws, in order, for the period around `anchor`.
 *
 * A week is its seven days. A month is padded out to whole weeks at both ends,
 * so the grid is always rows of seven and the days spilling in from either
 * neighbour are still there to tap.
 */
export function calendarDays(anchor, view = 'month') {
  const a = toDateKey(anchor) || today()
  const first = view === 'week' ? weekStartOf(a) : weekStartOf(dayjs(a).startOf('month'))
  const last = view === 'week'
    ? addDays(first, 6)
    : addDays(weekStartOf(dayjs(a).endOf('month')), 6)
  const out = []
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d)
  return out
}

/** The anchor one period earlier (`-1`) or later (`1`). */
export const shiftPeriod = (anchor, view, delta) =>
  view === 'week'
    ? addDays(anchor, 7 * delta)
    : dayjs(toDateKey(anchor)).startOf('month').add(delta, 'month').format('YYYY-MM-DD')

/** Whether a day belongs to the month `anchor` is in — the rest are spill. */
export const sameMonth = (day, anchor) =>
  toDateKey(day).slice(0, 7) === toDateKey(anchor).slice(0, 7)

/** "November 2026", or for a week "16 – 22 Nov 2026" / "30 Nov – 6 Dec 2026". */
export function periodLabel(anchor, view = 'month') {
  const a = toDateKey(anchor) || today()
  if (view !== 'week') return dayjs(a).format('MMMM YYYY')
  const from = dayjs(weekStartOf(a))
  const to = from.add(6, 'day')
  if (from.year() !== to.year()) return `${from.format('D MMM YYYY')} – ${to.format('D MMM YYYY')}`
  if (from.month() !== to.month()) return `${from.format('D MMM')} – ${to.format('D MMM YYYY')}`
  return `${from.format('D')} – ${to.format('D MMM YYYY')}`
}

/** "Fri 24 Nov 2026" — one day, with its weekday. */
export const formatDay = (day) => {
  const d = toDateKey(day)
  return d ? dayjs(d).format(`ddd ${DATE_FORMAT}`) : '—'
}
