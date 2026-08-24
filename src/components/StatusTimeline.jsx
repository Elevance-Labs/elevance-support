import { Box, Chip, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import LockClockIcon from '@mui/icons-material/LockClock'
import PauseCircleIcon from '@mui/icons-material/PauseCircle'
import { duration, formatDuration, formatDateTime } from '../lib/format'
import { displayName } from '../lib/users'
import { slaBand, statusColor } from '../lib/sla'

/**
 * The statuses this ticket has actually been through, in order, showing who
 * moved it there, when, and how long it sat in the previous status.
 * Statuses the ticket never reached are not drawn.
 */
export default function StatusTimeline({
  statuses, events, users, currentStatus, submittedAt, closedAt = null, sla,
}) {
  const userName = (id) => {
    const u = users.find((x) => x.id === id)
    // No changed_by means the row came from the public intake form.
    return u ? displayName(u) : 'the intake form'
  }
  // Statuses are coloured by their type: grey, blue, orange, green.
  const colorFor = (name) => statusColor(statuses, name)

  const totalFrom = submittedAt ?? events[0]?.created_at

  // The elapsed box takes its colour from the SLA band:
  // blue under 40%, yellow to 70%, orange to 100%, red beyond.
  const band = slaBand(sla)
  const boxBg = sla && sla.state !== 'none' ? band.color : null
  const boxFg = boxBg ? band.contrastText : '#fff'
  const faint = boxFg === '#ffffff' || boxFg === '#fff' ? 0.85 : 0.7

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2, bgcolor: boxBg ?? 'primary.main', color: boxFg }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" sx={{ opacity: faint, flexGrow: 1 }}>
            Total time elapsed
          </Typography>
          {sla?.isClosed && (
            <Tooltip title="This ticket is closed — the clock has stopped">
              <LockClockIcon sx={{ fontSize: 16, opacity: 0.9 }} />
            </Tooltip>
          )}
          {sla?.isPaused && (
            <Tooltip title="Paused — the SLA clock is stopped and will resume when the ticket moves on">
              <PauseCircleIcon sx={{ fontSize: 16, opacity: 0.9 }} />
            </Tooltip>
          )}
          {sla?.state === 'breached' && <WarningAmberIcon sx={{ fontSize: 16 }} />}
        </Stack>

        <Typography variant="h5">
          {sla ? formatDuration(sla.elapsedMs) : duration(totalFrom)}
        </Typography>

        {sla && sla.state !== 'none' && (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress variant="determinate"
              value={Math.min((sla.ratio ?? 0) * 100, 100)}
              sx={{
                height: 6, borderRadius: 3,
                bgcolor: boxFg === '#ffffff' ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.18)',
                '& .MuiLinearProgress-bar': { bgcolor: boxFg },
              }} />
            <Typography variant="caption" sx={{ opacity: 0.95, mt: 0.75, display: 'block' }}>
              {band.label} · target {formatDuration(sla.targetMs)}
              {sla.state === 'breached' && ` · ${formatDuration(sla.overdueMs)} over`}
            </Typography>
          </Box>
        )}

        {sla?.state === 'none' && (
          <Typography variant="caption" sx={{ opacity: faint, mt: 1, display: 'block' }}>
            No SLA set for this type
          </Typography>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Status timeline
        </Typography>

        {events.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No status history recorded yet.
          </Typography>
        ) : (
          <Stack>
            {events.map((event, i) => {
              const isLast = i === events.length - 1
              const isCurrent = isLast && event.to_status === currentStatus
              const color = colorFor(event.to_status)

              // How long the ticket sat in THIS status: until the next status
              // change, or — for the newest entry — until it closed, or now.
              const next = events[i + 1]
              const until = next?.created_at ?? closedAt ?? null
              const timeInStatus = until
                ? duration(event.created_at, until)
                : duration(event.created_at)
              const stillHere = !next && !closedAt

              return (
                <Box key={event.id} sx={{ display: 'flex', gap: 1.5 }}>
                  {/* rail */}
                  <Stack sx={{ alignItems: 'center', width: 24 }}>
                    <CheckCircleIcon sx={{ fontSize: 20, color }} />
                    {!isLast && (
                      <Box sx={{
                        flexGrow: 1, width: 2, minHeight: 30,
                        bgcolor: color, opacity: 0.35,
                      }} />
                    )}
                  </Stack>

                  {/* content — each caption on its own line */}
                  <Box sx={{ pb: isLast ? 0 : 2.5, flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: isCurrent ? 700 : 500 }}>
                        {event.to_status}
                      </Typography>
                      {isCurrent && <Chip size="small" label="current" color="primary" />}
                    </Stack>

                    <Typography variant="caption" color="text.secondary"
                      sx={{ display: 'block' }}>
                      {userName(event.changed_by)} · {formatDateTime(event.created_at)}
                    </Typography>

                    <Typography variant="caption"
                      sx={{ display: 'block', color: stillHere ? 'primary.main' : 'text.secondary' }}>
                      {timeInStatus} in this status{stillHere ? ' so far' : ''}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Stack>
        )}
      </Paper>
    </Stack>
  )
}
