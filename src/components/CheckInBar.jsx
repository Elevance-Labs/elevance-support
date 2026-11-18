import { Box, Button, Chip, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { CHECK_IN_ACTIONS } from '../lib/checkIn'

/**
 * The band across the top of the ticket dialog during a check-in: the
 * activity the ticket below is one step of. Where the meeting is, what has
 * been written on this ticket so far, and the way on — held shut until there
 * is something. `onBack` / `onNext` come from the dialog, which asks about
 * unsaved edits first; `pendingStatus` says a status has been picked and not
 * saved, which is the one way to think you are done when you are not.
 *
 * In the primary colour, text in its contrast colour, so it reads as a mode
 * the dialog is in rather than as part of the ticket — in either theme. Its
 * text is never a heading element: the ticket's title is the dialog's heading.
 */
export default function CheckInBar({ checkIn, onBack, onNext, pendingStatus }) {
  const { position, total, addressedCount, actions, canAdvance, isLast, onEnd } = checkIn
  const hint = canAdvance
    ? (isLast ? 'All captured — finish the check-in.' : 'Captured — on to the next ticket.')
    : pendingStatus
      ? 'Save changes to record the new status.'
      : 'Change the status or add a comment before moving on.'

  return (
    <Box data-check-in sx={{
      bgcolor: 'primary.main', color: 'primary.contrastText', flexShrink: 0,
    }}>
      <Stack direction="row" useFlexGap spacing={1.5} sx={{
        px: { xs: 1.5, md: 2.5 }, py: { xs: 1.25, md: 1.5 }, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <FactCheckIcon />
        <Box sx={{ mr: 1 }}>
          <Typography component="p" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Check-in · {position} of {total}
          </Typography>
          <Typography component="p" variant="caption" sx={{ opacity: 0.85 }}>
            {addressedCount} of {total} captured
          </Typography>
        </Box>
        {actions.map((a) => (
          <Chip key={a} size="small" icon={<CheckCircleIcon />} label={CHECK_IN_ACTIONS[a]}
            sx={{ bgcolor: 'rgba(255,255,255,0.18)', color: 'inherit', '& .MuiChip-icon': { color: 'inherit' } }} />
        ))}
        <Typography component="p" variant="body2"
          sx={{ flexGrow: 1, minWidth: { xs: '100%', sm: 0 }, fontWeight: canAdvance ? 600 : 400 }}>
          {hint}
        </Typography>
        <Button size="small" color="inherit" onClick={onEnd}>End check-in</Button>
        <Tooltip title="Previous ticket (Alt+↑)">
          <span>
            <Button size="small" variant="outlined" color="inherit" startIcon={<ArrowBackIcon />}
              onClick={onBack} disabled={position <= 1}
              sx={{ '&.Mui-disabled': { color: 'inherit', opacity: 0.4, borderColor: 'currentColor' } }}>
              Back
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={canAdvance ? (isLast ? '' : 'Next ticket (Alt+↓)') : hint}>
          <span>
            {/* Paper on the band: the one control the whole band is about. */}
            <Button size="small" variant="contained" disableElevation
              endIcon={isLast ? null : <ArrowForwardIcon />}
              onClick={onNext} disabled={!canAdvance}
              sx={{
                bgcolor: 'background.paper', color: 'primary.main',
                '&:hover': { bgcolor: 'background.subtle' },
                '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.24)', color: 'inherit', opacity: 0.7 },
              }}>
              {isLast ? 'Finish check-in' : 'Next ticket'}
            </Button>
          </span>
        </Tooltip>
      </Stack>
      <LinearProgress variant="determinate" color="inherit"
        value={total ? (addressedCount / total) * 100 : 0}
        aria-label="Check-in progress" sx={{ height: 4, opacity: 0.9 }} />
    </Box>
  )
}
