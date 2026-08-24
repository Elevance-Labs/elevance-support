import { Paper, Typography } from '@mui/material'

/**
 * Floating readout for whatever the pointer is over. Positioned against the
 * chart wrapper, and flipped to the left of the cursor near the right edge so
 * it never hangs off the card.
 */
export default function ChartTooltip({ x, y, width, title, rows }) {
  const flip = x > width - 150
  return (
    <Paper
      elevation={3}
      sx={{
        position: 'absolute', left: x, top: y, pointerEvents: 'none', zIndex: 2,
        transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
        px: 1.25, py: 0.75, minWidth: 110, border: '1px solid #e5e7eb',
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
        {title}
      </Typography>
      {rows.map((r) => (
        <Typography key={r.label} variant="caption" color="text.secondary"
          sx={{ display: 'flex', gap: 1, justifyContent: 'space-between' }}>
          <span>
            {r.color && (
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                background: r.color, marginRight: 6,
              }} />
            )}
            {r.label}
          </span>
          <span style={{ color: '#111827', fontWeight: 600 }}>{r.value}</span>
        </Typography>
      ))}
    </Paper>
  )
}
