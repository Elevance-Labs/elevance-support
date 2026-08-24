import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

/**
 * How every timestamp is shown: local time, 12-hour with AM/PM.
 * e.g. "22 Aug 2026, 3:02 AM"
 */
export const DATE_TIME_FORMAT = 'DD MMM YYYY, h:mm A'

/**
 * Parse a stored timestamp into the viewer's local zone.
 *
 * Every timestamp column is `timestamptz`, so Postgres holds UTC and Supabase
 * returns an ISO string with an offset, which dayjs converts to local time on
 * its own. The guard below covers the one case that would silently go wrong: a
 * value arriving with no zone marker at all. That means UTC, because that is
 * what the database stores — parsing it as local would shift the time.
 */
export function toLocal(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const t = value.trim()
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
      const parsed = dayjs(`${t.replace(' ', 'T')}Z`)
      return parsed.isValid() ? parsed : null
    }
  }
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed : null
}

/** Milliseconds since the epoch for a stored timestamp, or NaN. */
export const toMillis = (value) => toLocal(value)?.valueOf() ?? NaN

/** Compact age badge for board cards: "3d", "5h", "12m". */
export function elapsed(from) {
  const then = toLocal(from)
  if (!then) return ''
  const days = dayjs().diff(then, 'day')
  if (days > 0) return `${days}d`
  const hours = dayjs().diff(then, 'hour')
  if (hours > 0) return `${hours}h`
  return `${Math.max(dayjs().diff(then, 'minute'), 0)}m`
}

export const formatDate = (d) => toLocal(d)?.format(DATE_TIME_FORMAT) ?? '—'

/** Deterministic pastel from a string, so unconfigured labels still get a colour. */
export function stringColor(str = '') {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/**
 * Human duration between two instants: "3d 4h", "5h 20m", "45m", "30s".
 * Shows at most two units — precision beyond that is noise on a timeline.
 */
export function duration(from, to = Date.now()) {
  const start = toMillis(from)
  if (Number.isNaN(start)) return '—'
  const end = typeof to === 'number' ? to : toMillis(to)
  return formatDuration(end - start)
}

/**
 * Same formatting for a span already measured in milliseconds — SLA targets and
 * overdue amounts are durations, not the gap between two timestamps.
 */
export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—'
  if (ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return h ? `${d}d ${h}h` : `${d}d`
  if (h) return m ? `${h}h ${m}m` : `${h}h`
  if (m) return `${m}m`
  return `${s}s`
}

export const formatDateTime = (d) => toLocal(d)?.format(DATE_TIME_FORMAT) ?? '—'
