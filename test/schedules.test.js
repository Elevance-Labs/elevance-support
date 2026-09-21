import { reporter } from './setup.js'
import {
  byStartDesc, covers, formatRange, isValidRange, lengthInDays, overlapping,
  overlaps, phaseOf, scheduleFor, toDateKey,
} from '../src/lib/schedules.js'

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

done()
