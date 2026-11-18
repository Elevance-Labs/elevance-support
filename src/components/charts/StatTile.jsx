import { Paper, Stack, Typography, alpha } from '@mui/material'

/**
 * A single number that needs no plot. The label says what it counts, the
 * caption says over what — a bare figure invites the wrong reading.
 *
 * `alert` is for a count that should be zero and isn't: the tile turns red
 * so it is seen before it is read.
 */
export default function StatTile({ label, value, caption, color, icon, alert = false }) {
  return (
    <Paper data-alert={alert || undefined} sx={{
      p: 2, height: '100%',
      ...(alert && {
        border: 1, borderColor: 'error.main',
        bgcolor: (t) => alpha(t.palette.error.main, t.palette.mode === 'dark' ? 0.16 : 0.06),
      }),
    }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        {icon}
      </Stack>
      <Typography variant="h4" sx={{ fontWeight: 600, lineHeight: 1.2, color: color ?? (alert ? 'error.main' : 'text.primary') }}>
        {value}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary">{caption}</Typography>
      )}
    </Paper>
  )
}
