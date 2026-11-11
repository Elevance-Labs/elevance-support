import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import SupportAgentIcon from '@mui/icons-material/SupportAgent'
import GoogleIcon from '@mui/icons-material/Google'
import { useAuth } from '../context/AuthContext'

/**
 * One way in: Google. There is nothing to type here, because the account is
 * found by the email of the Google account chosen — and an address nobody has
 * added comes back as `authError` rather than as a new, empty account.
 */
export default function Login() {
  const { session, signIn, loading, authError } = useAuth()
  const [busy, setBusy] = useState(false)

  if (!loading && session) return <Navigate to="/issues" replace />

  // A sign-in that starts leaves the page for Google, so `busy` only ever has
  // to be cleared when it could not start at all.
  const start = async () => {
    setBusy(true)
    const { error } = await signIn()
    if (error) setBusy(false)
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Paper sx={{ p: 4, width: '100%', maxWidth: 380 }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <SupportAgentIcon color="primary" />
            <Typography variant="h6">Support Tool</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Sign in with your company Google account.
          </Typography>
          {authError && <Alert severity="error">{authError}</Alert>}
          <Button variant="contained" size="large" startIcon={<GoogleIcon />}
            onClick={start} disabled={busy || loading}>
            {busy ? 'Opening Google…' : 'Sign in with Google'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}
