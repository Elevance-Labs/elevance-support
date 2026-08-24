import { reporter } from './setup.js'
import {
  formatDate, formatDateTime, toLocal, toMillis, duration, elapsed, DATE_TIME_FORMAT,
} from '../src/lib/format.js'

const { check, done } = reporter()

// The suite runs under TZ=Asia/Karachi (UTC+5), set by the npm script, so a
// UTC instant must render five hours later than its stored value.
const OFFSET_HOURS = -new Date('2026-08-22T00:00:00Z').getTimezoneOffset() / 60
check(`running in a non-UTC zone (offset ${OFFSET_HOURS}h)`, OFFSET_HOURS !== 0,
  `offset is ${OFFSET_HOURS} — set TZ to exercise the conversion`)

// ---- stored UTC renders as local ----
const utcMidnight = '2026-08-22T00:00:00+00:00'
const shown = formatDateTime(utcMidnight)
check('midnight UTC is NOT displayed as 12:00 AM in a +5 zone',
  !shown.includes('12:00 AM'), shown)
check('midnight UTC displays as 5:00 AM at UTC+5',
  shown === '22 Aug 2026, 5:00 AM', shown)

// ---- AM/PM everywhere ----
check('format string is 12-hour with AM/PM', DATE_TIME_FORMAT === 'DD MMM YYYY, h:mm A')
check('morning shows AM', formatDateTime('2026-08-22T00:00:00Z').endsWith('AM'),
  formatDateTime('2026-08-22T00:00:00Z'))
check('afternoon shows PM', formatDateTime('2026-08-22T12:00:00Z').endsWith('PM'),
  formatDateTime('2026-08-22T12:00:00Z'))
check('no 24-hour times leak through',
  !/\b(1[3-9]|2[0-3]):\d{2}/.test(formatDateTime('2026-08-22T18:30:00Z')),
  formatDateTime('2026-08-22T18:30:00Z'))
check('noon UTC is 5:00 PM at UTC+5',
  formatDateTime('2026-08-22T12:00:00Z') === '22 Aug 2026, 5:00 PM',
  formatDateTime('2026-08-22T12:00:00Z'))
check('hour is not zero-padded', !formatDateTime('2026-08-22T00:00:00Z').includes('05:00'),
  formatDateTime('2026-08-22T00:00:00Z'))

// formatDate and formatDateTime must agree — they are used interchangeably
check('formatDate matches formatDateTime',
  formatDate(utcMidnight) === formatDateTime(utcMidnight),
  `${formatDate(utcMidnight)} vs ${formatDateTime(utcMidnight)}`)

// ---- offset forms Supabase can return ----
check('ISO with Z parses', toLocal('2026-08-22T00:00:00Z').valueOf() === Date.UTC(2026, 7, 22))
check('ISO with +00:00 parses', toLocal('2026-08-22T00:00:00+00:00').valueOf() === Date.UTC(2026, 7, 22))
check('ISO with fractional seconds parses',
  toLocal('2026-08-22T00:00:00.123456+00:00').valueOf() === Date.UTC(2026, 7, 22, 0, 0, 0, 123))
check('a non-UTC offset is respected',
  toLocal('2026-08-22T05:00:00+05:00').valueOf() === Date.UTC(2026, 7, 22),
  String(toLocal('2026-08-22T05:00:00+05:00')?.toISOString()))

// A value with no zone marker means UTC, because that is what the DB stores.
check('zone-less string is read as UTC, not local',
  toLocal('2026-08-22 00:00:00').valueOf() === Date.UTC(2026, 7, 22),
  String(toLocal('2026-08-22 00:00:00')?.toISOString()))
check('zone-less string renders shifted to local',
  formatDateTime('2026-08-22 00:00:00') === '22 Aug 2026, 5:00 AM',
  formatDateTime('2026-08-22 00:00:00'))

// ---- empty and invalid input ----
check('null renders as a dash', formatDateTime(null) === '—')
check('empty string renders as a dash', formatDateTime('') === '—')
check('garbage renders as a dash', formatDateTime('not a date') === '—', formatDateTime('not a date'))
check('toMillis of garbage is NaN', Number.isNaN(toMillis('not a date')))

// ---- durations are zone-independent ----
check('duration across the same instants ignores zone',
  duration('2026-08-22T00:00:00Z', new Date('2026-08-22T08:00:00Z').getTime()) === '8h',
  duration('2026-08-22T00:00:00Z', new Date('2026-08-22T08:00:00Z').getTime()))
check('duration accepts two ISO strings',
  duration('2026-08-22T00:00:00Z', '2026-08-22T03:30:00Z') === '3h 30m',
  duration('2026-08-22T00:00:00Z', '2026-08-22T03:30:00Z'))
check('duration between UTC and an equal +05:00 instant is zero',
  duration('2026-08-22T00:00:00Z', '2026-08-22T05:00:00+05:00') === '0s',
  duration('2026-08-22T00:00:00Z', '2026-08-22T05:00:00+05:00'))
check('elapsed handles a missing value', elapsed(null) === '')

done()
