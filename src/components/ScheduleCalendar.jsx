import { Box, ButtonBase, Stack, Tooltip, Typography, alpha, useMediaQuery } from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import dayjs from 'dayjs'
import { displayName } from '../lib/users'
import {
  phaseOf, sameMonth, scheduleFor, toDateKey, WEEKDAYS, weekdayOf,
} from '../lib/schedules'
import UserAvatar from './UserAvatar'

const firstName = (u) => displayName(u).split(/\s+/)[0]

/**
 * The rota drawn as a calendar: one cell per day, the people on support in it.
 *
 * Presentation only — `ScheduleManager` owns the data and the form. A range
 * reads as one band across its days (rounded where it starts and ends), so two
 * back-to-back rotas with the same people still read as two.
 *
 * Days that have gone are dulled; today is ringed; the range running now is
 * tinted, so "who is on" is the first thing the eye finds.
 *
 * `onPick(day, schedule)` makes every cell a button; without it (a member, who
 * may look but not change) the cells are plain.
 */
export default function ScheduleCalendar({
  days, anchor, view, schedules, userById, todayKey, supportKey, onPick, staleRota,
}) {
  const narrow = useMediaQuery((t) => t.breakpoints.down('sm'))
  // A week on a phone is seven rows, not seven slivers.
  const agenda = view === 'week' && narrow

  return (
    <Box sx={{
      border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden',
      bgcolor: 'background.paper',
    }}>
      {!agenda && (
        <Box sx={{
          display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          bgcolor: 'background.subtle', borderBottom: 1, borderColor: 'divider',
        }}>
          {WEEKDAYS.map((w) => (
            <Typography key={w} variant="caption" color="text.secondary"
              sx={{ py: 0.75, textAlign: 'center', fontWeight: 600 }}>
              {narrow ? w.slice(0, 1) : w}
            </Typography>
          ))}
        </Box>
      )}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: agenda ? '1fr' : 'repeat(7, minmax(0, 1fr))',
      }}>
        {days.map((day, i) => (
          <DayCell key={day} day={day} column={i % 7} lastRow={i >= days.length - (agenda ? 1 : 7)}
            view={view} agenda={agenda} narrow={narrow} anchor={anchor}
            schedule={scheduleFor(schedules, day)} userById={userById}
            todayKey={todayKey} supportKey={supportKey ?? todayKey} onPick={onPick} staleRota={staleRota} />
        ))}
      </Box>
    </Box>
  )
}

function DayCell({
  day, column, lastRow, view, agenda, narrow, anchor, schedule, userById, todayKey,
  supportKey, onPick, staleRota,
}) {
  const isToday = day === todayKey
  const past = day < todayKey
  const spill = view === 'month' && !sameMonth(day, anchor)
  // Which rota is on is judged by the support day, which runs past midnight
  // until the hand-over; the day marker stays on the calendar date.
  const phase = schedule ? phaseOf(schedule, supportKey) : null
  const startsHere = schedule && toDateKey(schedule.starts_on) === day
  const endsHere = schedule && toDateKey(schedule.ends_on) === day
  const people = (schedule?.assignee_ids ?? []).map((id) => userById[id]).filter(Boolean)
  const stale = schedule && (startsHere || column === 0) ? staleRota?.(schedule) : null

  const date = dayjs(day)
  const heading = agenda
    ? null
    : view === 'week' || date.date() === 1 ? date.format('D MMM') : date.format('D')
  const label = `${weekdayOf(day, true)} ${date.format('D MMMM YYYY')}: `
    + (people.length ? `${people.map((u) => displayName(u)).join(' and ')} on support`
      : 'nobody on support')

  const body = (
    <Box sx={{
      display: 'flex', flexDirection: agenda ? 'row' : 'column', alignItems: agenda ? 'center' : 'stretch',
      gap: agenda ? 1.5 : 0.5, width: '100%', height: '100%',
      minHeight: agenda ? 56 : view === 'week' ? 140 : { xs: 64, sm: 92 },
      py: 0.75, textAlign: 'left',
      opacity: past ? 0.5 : 1,
    }}>
      {agenda ? (
        <Box sx={{ width: 56, flexShrink: 0, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {weekdayOf(day)}
          </Typography>
          <DayNumber isToday={isToday} text={date.format('D')} />
        </Box>
      ) : (
        <Box sx={{ px: 0.75 }}>
          <DayNumber isToday={isToday} text={heading} muted={spill} />
        </Box>
      )}

      {schedule && (
        <Box sx={(t) => ({
          flexGrow: agenda ? 1 : 0,
          ml: startsHere ? 0.5 : 0, mr: endsHere ? 0.5 : 0,
          borderTopLeftRadius: startsHere ? 6 : 0, borderBottomLeftRadius: startsHere ? 6 : 0,
          borderTopRightRadius: endsHere ? 6 : 0, borderBottomRightRadius: endsHere ? 6 : 0,
          ...(agenda && { borderRadius: 1.5, mr: 1, ml: 0 }),
          px: 0.75, py: 0.5,
          bgcolor: phase === 'current'
            ? alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.32 : 0.16)
            : t.palette.background.muted,
          borderLeft: startsHere || agenda ? 3 : 0,
          borderColor: phase === 'current' ? 'primary.main' : 'divider',
        })}>
          <Stack direction={narrow && !agenda ? 'row' : 'column'} spacing={narrow && !agenda ? -0.5 : 0.25}
            sx={{ alignItems: narrow && !agenda ? 'center' : 'stretch', flexWrap: 'wrap' }}>
            {people.map((u) => (
              <Stack key={u.id} direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                <UserAvatar user={u} size={view === 'week' && !narrow ? 26 : 18}
                  sx={narrow && !agenda ? { border: 1, borderColor: 'background.paper' } : undefined} />
                {(!narrow || agenda) && (
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 500, lineHeight: 1.3 }}>
                      {view === 'week' ? displayName(u) : firstName(u)}
                    </Typography>
                    {view === 'week' && u.department && (
                      <Typography variant="caption" color="text.secondary" noWrap
                        sx={{ display: 'block', fontSize: 11, lineHeight: 1.2 }}>
                        {u.department}
                      </Typography>
                    )}
                  </Box>
                )}
              </Stack>
            ))}
            {stale && (
              <Tooltip title={`Both are now in ${stale}. A ticket arriving in this range `
                + 'will only be assigned the first of them until this is fixed.'}>
                <WarningAmberIcon color="warning" sx={{ fontSize: 16 }} />
              </Tooltip>
            )}
          </Stack>
        </Box>
      )}
      {!schedule && agenda && (
        <Typography variant="caption" color="text.disabled">Nobody scheduled</Typography>
      )}
    </Box>
  )

  const cellSx = (t) => ({
    display: 'flex', alignItems: 'stretch', minWidth: 0,
    borderRight: agenda || column === 6 ? 0 : 1,
    borderBottom: lastRow ? 0 : 1,
    borderColor: 'divider',
    bgcolor: past || spill ? t.palette.background.subtle
      : phase === 'current' ? alpha(t.palette.primary.main, 0.04) : 'transparent',
    // A ring, drawn inside the cell so it never shifts the grid.
    boxShadow: isToday ? `inset 0 0 0 2px ${t.palette.primary.main}` : 'none',
  })

  return onPick ? (
    <ButtonBase component="div" data-day={day} aria-label={label} title={label}
      onClick={() => onPick(day, schedule)}
      sx={(t) => ({
        ...cellSx(t),
        '&:hover': { bgcolor: t.palette.action.hover },
        '&.Mui-focusVisible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: -2 },
      })}>
      {body}
    </ButtonBase>
  ) : (
    <Box data-day={day} aria-label={label} title={label} sx={cellSx}>{body}</Box>
  )
}

function DayNumber({ text, isToday, muted }) {
  if (isToday) {
    return (
      <Box component="span" sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 24, height: 24, px: 0.75, borderRadius: 12,
        bgcolor: 'primary.main', color: 'primary.contrastText',
        typography: 'caption', fontWeight: 700,
      }}>
        {text}
      </Box>
    )
  }
  return (
    <Typography variant="caption" sx={{
      fontWeight: 600, lineHeight: '24px',
      color: muted ? 'text.disabled' : 'text.secondary',
    }}>
      {text}
    </Typography>
  )
}
