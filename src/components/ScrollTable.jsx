import { Box, Table } from '@mui/material'

/**
 * A table that scrolls sideways inside its own box once the screen is narrower
 * than its columns need, instead of squeezing them or widening the page. On a
 * phone the page then scrolls one way and the table the other.
 */
export default function ScrollTable({ minWidth = 640, sx, children, ...props }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" {...props} sx={{ minWidth, ...sx }}>{children}</Table>
    </Box>
  )
}
