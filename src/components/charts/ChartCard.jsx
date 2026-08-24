import { Box, Paper, Stack, Typography } from '@mui/material'

/**
 * The frame every chart sits in: a title that says what is plotted, an optional
 * subtitle carrying the caveat, and room on the right for a control.
 */
export default function ChartCard({ title, subtitle, action, children, sx }) {
  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{title}</Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
          )}
        </Box>
        {action}
      </Stack>
      <Box sx={{ flexGrow: 1 }}>{children}</Box>
    </Paper>
  )
}

/** Shown in place of a chart when the filters leave nothing to draw. */
export function NoData({ height = 160, message = 'No tickets in this range' }) {
  return (
    <Box sx={{ height, display: 'grid', placeItems: 'center' }}>
      <Typography variant="body2" color="text.disabled">{message}</Typography>
    </Box>
  )
}
