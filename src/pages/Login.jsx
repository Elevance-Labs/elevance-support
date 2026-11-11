import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Alert, Avatar, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import SupportAgentIcon from '@mui/icons-material/SupportAgent'
import GoogleIcon from '@mui/icons-material/Google'
import { useAuth } from '../context/AuthContext'

/**
 * One way in: Google. There is nothing to type here, because the account is
 * found by the email of the Google account chosen — and an address nobody has
 * added comes back as `authError` rather than as a new, empty account.
 *
 * Laid out as the other Elevance apps lay out theirs.
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
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', px: 2 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
          <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Avatar variant="rounded" sx={{ width: 56, height: 56, bgcolor: 'primary.main' }}>
              <SupportAgentIcon sx={{ fontSize: 35 }} />
            </Avatar>
            <Box>
              <Typography variant="h5" component="h1">Elevance Support</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                Sign in with your company Google account
              </Typography>
            </Box>
            {authError && (
              <Alert severity="error" sx={{ textAlign: 'left', width: '100%' }}>{authError}</Alert>
            )}
            <Button variant="contained" size="large" fullWidth startIcon={<GoogleIcon />}
              onClick={start} disabled={busy || loading}>
              {busy ? 'Opening Google…' : 'Sign in with Google'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
