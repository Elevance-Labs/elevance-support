import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Paper, Stack, TextField, Typography,
} from '@mui/material'
import SupportAgentIcon from '@mui/icons-material/SupportAgent'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, signIn, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  if (!loading && session) return <Navigate to="/issues" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/issues')
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
      <Paper sx={{ p: 4, width: 380 }} component="form" onSubmit={submit}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <SupportAgentIcon color="primary" />
            <Typography variant="h6">Support Tool</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Sign in with your team account.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Email" type="email" value={email} required autoFocus
            onChange={(e) => setEmail(e.target.value)} fullWidth
          />
          <TextField
            label="Password" type="password" value={password} required
            onChange={(e) => setPassword(e.target.value)} fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}
