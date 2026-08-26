import { Box, Stack, Typography } from '@mui/material'
import { STATUS_TYPE_COLORS, STATUS_TYPE_LABELS } from '../lib/sla'

const FALLBACK = '#9ca3af'

/**
 * The coloured dot that says what *kind* of status something is.
 *
 * Statuses are coloured by their type, never individually (see sla.js), so a dot
 * takes a `statusType` rather than a colour: every "in progress" status is the
 * same blue whatever the team decided to call it. Board columns, the assignee
 * dialog's status picker and anything else that lists statuses share this, so
 * the same status is the same colour wherever it is drawn.
 */
export default function StatusDot({ statusType, size = 8, sx }) {
  return (
    <Box
      component="span"
      // Titled so the colour is not the only carrier of the meaning — the type
      // is otherwise invisible to anyone who cannot separate the four hues.
      title={STATUS_TYPE_LABELS[statusType] ?? 'Unknown status type'}
      sx={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        bgcolor: STATUS_TYPE_COLORS[statusType] ?? FALLBACK,
        ...sx,
      }}
    />
  )
}

/**
 * Dot plus status name on one line — a dropdown option, or the closed field
 * showing what is currently selected.
 */
export function StatusLabel({ name, statusType, size = 8, empty = '—' }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      <StatusDot statusType={statusType} size={size} />
      <Typography variant="body2" noWrap>{name || empty}</Typography>
    </Stack>
  )
}
