import { reporter } from './setup.js'
import {
  byStartDesc, covers, formatRange, isValidRange, lengthInDays, overlapping,
  nextSchedule, overlaps, phaseOf, scheduleFor, toDateKey,
  addDays, calendarDays, formatDay, periodLabel, sameMonth, shiftPeriod, weekStartOf, weekdayOf,
  handoverLabel, handoverOf, handsOverAtMidnight, isTimeZone, shiftEnds, supportDay, timeZones,
  toTimeKey, formatTime,
} from '../src/lib/schedules.js'
import { can } from '../src/lib/permissions.js'

const { check, done } = reporter()

const ADA = 'user-1', GRACE = 'user-2'

// A week each, back to back, plus one much later.
const WEEK_1 = { id: 's1', starts_on: '2026-01-05', ends_on: '2026-01-11', assignee_ids: [ADA] }
const WEEK_2 = { id: 's2', starts_on: '2026-01-12', ends_on: '2026-01-18', assignee_ids: [ADA, GRACE] }
const MARCH  = { id: 's3', starts_on: '2026-03-02', ends_on: '2026-03-02', assignee_ids: [GRACE] }
const ROTA = [WEEK_1, WEEK_2, MARCH]

// ---------------- day keys ----------------
// A rota boundary is a calendar day, so it is never parsed into an instant —
// doing that would hand it a time and a zone and move the boundary for half
// the team. The TZ this suite runs under is deliberately not UTC.
check('a date column value is taken as-is', toDateKey('2026-01-05') === '2026-01-05')
check('a timestamp is cut back to its day',
  toDateKey('2026-01-05T23:30:00+05:00') === '2026-01-05')
check('nothing is an empty key', toDateKey(null) === '' && toDateKey('') === '')

// ---------------- what a range covers ----------------
check('the first day counts', covers(WEEK_1, '2026-01-05'))
check('the last day counts', covers(WEEK_1, '2026-01-11'))
check('a day inside counts', covers(WEEK_1, '2026-01-08'))
check('the day before does not', !covers(WEEK_1, '2026-01-04'))
check('the day after does not', !covers(WEEK_1, '2026-01-12'))
check('a single-day range covers exactly that day',
  covers(MARCH, '2026-03-02') && !covers(MARCH, '2026-03-03'))

// ---------------- which schedule a ticket lands in ----------------
check('a ticket submitted mid-week finds its rota',
  scheduleFor(ROTA, '2026-01-07')?.id === 's1')
check('the handover day goes to the new rota',
  scheduleFor(ROTA, '2026-01-12')?.id === 's2')
check('a day nobody is scheduled for finds nothing',
  scheduleFor(ROTA, '2026-02-01') === null)
check('an empty rota finds nothing', scheduleFor([], '2026-01-07') === null)

// ---------------- the next rota, for a day nobody is on ----------------
check('a gap finds the next rota to start',
  nextSchedule(ROTA, '2026-02-01')?.id === 's3')
check('the next rota is the soonest, whatever the list order',
  nextSchedule([MARCH, WEEK_2, WEEK_1], '2026-01-01')?.id === 's1')
check('a rota already running is not "next"',
  nextSchedule(ROTA, '2026-01-12')?.id === 's3')
check('nothing after the last rota', nextSchedule(ROTA, '2026-03-02') === null)

// ---------------- overlap ----------------
// Two schedules covering one day would make "who is on" a question with two
// answers. The database refuses it; this is what says so before the save.
check('back-to-back weeks do not overlap', !overlaps(WEEK_1, WEEK_2))
check('a range sharing one day overlaps',
  overlaps(WEEK_1, { starts_on: '2026-01-11', ends_on: '2026-01-20' }))
check('a range swallowing another overlaps',
  overlaps(WEEK_1, { starts_on: '2026-01-01', ends_on: '2026-01-31' }))
check('a range inside another overlaps',
  overlaps(WEEK_1, { starts_on: '2026-01-07', ends_on: '2026-01-08' }))

check('a clean new range finds no clash',
  overlapping(ROTA, { starts_on: '2026-01-19', ends_on: '2026-01-25' }) === null)
check('a clashing new range names what is in the way',
  overlapping(ROTA, { starts_on: '2026-01-10', ends_on: '2026-01-14' })?.id === 's1')
// Editing a schedule must not find itself and refuse to save.
check('an edit does not clash with itself',
  overlapping(ROTA, { ...WEEK_2, ends_on: '2026-01-19' }) === null)
check('an edit that grows into its neighbour still clashes',
  overlapping(ROTA, { ...WEEK_2, starts_on: '2026-01-10' })?.id === 's1')

// ---------------- past, current, upcoming ----------------
check('a range around today is current', phaseOf(WEEK_1, '2026-01-08') === 'current')
check('a range that has ended is past', phaseOf(WEEK_1, '2026-01-12') === 'past')
check('a range yet to start is upcoming', phaseOf(WEEK_2, '2026-01-08') === 'upcoming')
// Both ends are inclusive, so the last day is still "on now", not "past".
check('the last day is still on now', phaseOf(WEEK_1, '2026-01-11') === 'current')
check('the first day is already on now', phaseOf(WEEK_1, '2026-01-05') === 'current')

// ---------------- who may change one ----------------
const admin   = { id: 'a', role: 'admin' }
const manager = { id: 'm', role: 'manager' }
const member  = { id: 'u', role: 'member' }
const DAY = '2026-01-14'   // WEEK_1 has ended; WEEK_2 is running; MARCH is ahead.

check('a manager may create schedules', can.manageSchedules(manager))
check('an admin may create schedules', can.manageSchedules(admin))
check('a member may not', !can.manageSchedules(member))
check('signed out, nobody may', !can.manageSchedules(null))

check('a manager may change the schedule running now',
  can.changeSchedule(manager, WEEK_2, DAY))
check('and one still ahead', can.changeSchedule(manager, MARCH, DAY))
check('but not one that has already ended', !can.changeSchedule(manager, WEEK_1, DAY))
check('an admin may change even one that has ended', can.changeSchedule(admin, WEEK_1, DAY))
check('a member may change none of them',
  [WEEK_1, WEEK_2, MARCH].every((s) => !can.changeSchedule(member, s, DAY)))
// Both ends of a range count, so a schedule ending today is still current.
check('a manager keeps a schedule on its last day',
  can.changeSchedule(manager, WEEK_1, '2026-01-11'))
check('and loses it the day after', !can.changeSchedule(manager, WEEK_1, '2026-01-12'))

// ---------------- the hand-over ----------------
// A schedule day runs from the hand-over on that day to the hand-over the next,
// in the project's zone — so "Saad, Mon–Tue" with Asia/Karachi and 12:00 is on
// from Mon 12:00 to Wed 12:00 PKT, Tuesday night included. Mirrors the
// database's support_day(), which is what assigns a ticket.
const PKT_NOON = { support_time_zone: 'Asia/Karachi', support_handover: '12:00:00' }
const at = (iso) => new Date(iso).getTime()
// 2026-11-23 is a Monday. PKT is UTC+5, no daylight saving.
check('before the hand-over, it is still yesterday on the rota',
  supportDay(PKT_NOON, at('2026-11-23T11:59:00+05:00')) === '2026-11-22')
check('at the hand-over, the day turns',
  supportDay(PKT_NOON, at('2026-11-23T12:00:00+05:00')) === '2026-11-23')
check('Tuesday night belongs to Tuesday',
  supportDay(PKT_NOON, at('2026-11-25T01:00:00+05:00')) === '2026-11-24')
check('and keeps belonging to it until noon on Wednesday',
  supportDay(PKT_NOON, at('2026-11-25T11:59:00+05:00')) === '2026-11-24'
  && supportDay(PKT_NOON, at('2026-11-25T12:00:00+05:00')) === '2026-11-25')
const SAAD = { id: 'saad', starts_on: '2026-11-23', ends_on: '2026-11-24', assignee_ids: [ADA] }
check('so a ticket at 1am on Wednesday lands on the Mon–Tue rota',
  scheduleFor([SAAD], supportDay(PKT_NOON, at('2026-11-25T01:00:00+05:00')))?.id === 'saad')

const PKT_SIX = { support_time_zone: 'Asia/Karachi', support_handover: '18:00' }
check('a 6pm hand-over turns at 6pm',
  supportDay(PKT_SIX, at('2026-11-23T17:59:00+05:00')) === '2026-11-22'
  && supportDay(PKT_SIX, at('2026-11-23T18:00:00+05:00')) === '2026-11-23')

// A project never configured keeps the old day: midnight UTC.
check('no setting is midnight UTC',
  supportDay(null, at('2026-11-24T23:59:00Z')) === '2026-11-24'
  && supportDay({}, at('2026-11-25T00:00:00Z')) === '2026-11-25')
check('a zone the browser does not know falls back to UTC',
  handoverOf({ support_time_zone: 'Mars/Olympus', support_handover: '12:00' }).timeZone === 'UTC')
// The zone does the work, not the browser's own: this suite runs in Karachi.
check('a zone behind UTC reads its own date',
  supportDay({ support_time_zone: 'America/New_York' }, at('2026-11-25T03:00:00Z')) === '2026-11-24')
check('daylight saving is the zone\'s business',
  supportDay({ support_time_zone: 'Europe/London', support_handover: '09:00' },
    at('2026-07-01T08:30:00Z')) === '2026-07-01'
  && supportDay({ support_time_zone: 'Europe/London', support_handover: '09:00' },
    at('2026-12-01T08:30:00Z')) === '2026-11-30')

check('a database time reads as HH:MM', toTimeKey('12:00:00') === '12:00' && toTimeKey('9:05') === '09:05')
check('nonsense is no time', toTimeKey('25:00') === '' && toTimeKey('') === '' && toTimeKey(null) === '')
check('a real zone is a zone', isTimeZone('Asia/Karachi') && isTimeZone('UTC') && !isTimeZone('Nowhere/Else'))
check('the zone list starts with UTC and has Karachi',
  timeZones()[0] === 'UTC' && timeZones().includes('Asia/Karachi'))
check('times read 12-hour',
  formatTime('00:00') === '12:00 AM' && formatTime('12:00:00') === '12:00 PM'
  && formatTime('18:30') === '6:30 PM' && formatTime('09:05') === '9:05 AM' && formatTime('') === '')
check('the hand-over reads as time and zone', handoverLabel(PKT_NOON) === '12:00 PM Asia/Karachi')
check('midnight is midnight', handsOverAtMidnight(null) && !handsOverAtMidnight(PKT_NOON))

// "Until Tuesday" reads as Tuesday evening — so past midnight, the moment it ends.
check('at midnight, a rota ends on its last day', shiftEnds(SAAD, null) === 'Tue 24 Nov 2026')
check('otherwise, at the hand-over the day after',
  shiftEnds(SAAD, PKT_NOON) === 'Wed 25 Nov 2026, 12:00 PM', shiftEnds(SAAD, PKT_NOON))

check('admins and managers set the hand-over',
  can.setHandover({ role: 'admin' }) && can.setHandover({ role: 'manager' }))
check('members do not', !can.setHandover({ role: 'member' }) && !can.setHandover(null))

// ---------------- shape and display ----------------
check('a range needs both ends', !isValidRange({ starts_on: '2026-01-05', ends_on: '' }))
check('a range cannot end before it starts',
  !isValidRange({ starts_on: '2026-01-11', ends_on: '2026-01-05' }))
check('a one-day range is valid', isValidRange(MARCH))
check('a week counts both ends', lengthInDays(WEEK_1) === 7)
check('a single day is one day', lengthInDays(MARCH) === 1)
check('an invalid range has no length', lengthInDays({ starts_on: 'x' }) === 0)

check('a range reads as two dates', formatRange(WEEK_1) === '05 Jan 2026 – 11 Jan 2026',
  formatRange(WEEK_1))
check('a one-day range reads as one date', formatRange(MARCH) === '02 Mar 2026',
  formatRange(MARCH))
check('a missing range reads as a dash', formatRange(null) === '—')

// Newest first: a rota is read backwards from now far more often than forwards.
check('schedules sort newest first',
  [...ROTA].sort(byStartDesc).map((s) => s.id).join(',') === 's3,s2,s1')

// ---------------- the calendar ----------------
// Weeks start on Monday; everything stays a day key, so no zone can move a cell.
check('a week starts on the Monday on or before a day',
  weekStartOf('2026-11-20') === '2026-11-16' && weekStartOf('2026-11-16') === '2026-11-16'
  && weekStartOf('2026-11-22') === '2026-11-16')
check('days add across a month end', addDays('2026-11-30', 1) === '2026-12-01')
check('days add across a daylight-saving change',
  addDays('2026-03-28', 1) === '2026-03-29' && addDays('2026-10-24', 2) === '2026-10-26')
check('a day names its weekday', weekdayOf('2026-11-20') === 'Fri'
  && weekdayOf('2026-11-20', true) === 'Friday' && weekdayOf('') === '')
check('one day reads with its weekday', formatDay('2026-11-24') === 'Tue 24 Nov 2026')

const NOV = calendarDays('2026-11-20', 'month')
check('a month pads out to whole weeks', NOV.length % 7 === 0, String(NOV.length))
check('starting on the Monday before the 1st', NOV[0] === '2026-10-26', NOV[0])
check('and ending on the Sunday after the last', NOV.at(-1) === '2026-12-06', NOV.at(-1))
check('with every day once, in order',
  NOV.every((d, i) => i === 0 || d === addDays(NOV[i - 1], 1)))
check('a month starting on a Monday has no spill before it',
  calendarDays('2027-02-10', 'month')[0] === '2027-02-01')
check('spill days are told apart', sameMonth('2026-11-30', '2026-11-20') && !sameMonth('2026-12-01', '2026-11-20'))

const WEEK = calendarDays('2026-11-20', 'week')
check('a week is its seven days, Monday to Sunday',
  WEEK.length === 7 && WEEK[0] === '2026-11-16' && WEEK[6] === '2026-11-22')

check('a month steps to the next', shiftPeriod('2026-01-31', 'month', 1) === '2026-02-01')
check('and back across a year', shiftPeriod('2026-01-15', 'month', -1) === '2025-12-01')
check('a week steps seven days', shiftPeriod('2026-11-20', 'week', 1) === '2026-11-27')

check('a month is labelled by name', periodLabel('2026-11-20', 'month') === 'November 2026')
check('a week inside one month', periodLabel('2026-11-20', 'week') === '16 – 22 Nov 2026')
check('a week across two months', periodLabel('2026-12-02', 'week') === '30 Nov – 6 Dec 2026')
check('a week across two years',
  periodLabel('2026-12-31', 'week') === '28 Dec 2026 – 3 Jan 2027', periodLabel('2026-12-31', 'week'))

done()
