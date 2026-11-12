import { Avatar, Box, LinearProgress, Stack } from '@mui/material'
import { SupportIcon } from './ElevanceIcons'

/** The first load: the app's icon, centred, with a bar running beneath it. */
export default function Splash() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Stack spacing={3} sx={{ alignItems: 'center' }}>
        <Avatar variant="rounded" sx={{ width: 72, height: 72, bgcolor: 'primary.main' }}>
          <SupportIcon sx={{ fontSize: 72 * 0.62 }} />
        </Avatar>
        <LinearProgress aria-label="Loading" sx={{ width: 160, borderRadius: 1 }} />
      </Stack>
    </Box>
  )
}
