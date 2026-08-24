import { Paper, Stack, Typography } from '@mui/material'

/**
 * A single number that needs no plot. The label says what it counts, the
 * caption says over what — a bare figure invites the wrong reading.
 */
export default function StatTile({ label, value, caption, color, icon }) {
  return (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        {icon}
      </Stack>
      <Typography variant="h4" sx={{ fontWeight: 600, lineHeight: 1.2, color: color ?? 'text.primary' }}>
        {value}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary">{caption}</Typography>
      )}
    </Paper>
  )
}
