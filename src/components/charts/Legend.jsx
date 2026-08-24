import { Box, Stack, Typography } from '@mui/material'

/**
 * Identity never rests on colour alone, so two or more series always carry a
 * legend. One series doesn't get one — the chart's title already names it.
 */
export default function Legend({ items, sx }) {
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, ...sx }}>
      {items.map((item) => (
        <Stack key={item.label} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <Box sx={{
            width: 10, height: 10, borderRadius: '2px', flexShrink: 0,
            bgcolor: item.color,
          }} />
          <Typography variant="caption" color="text.secondary">
            {item.label}
            {item.value != null && (
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, ml: 0.5 }}>
                {item.value}
              </Box>
            )}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}
