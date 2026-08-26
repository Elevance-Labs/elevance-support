import { useRef, useState } from 'react'
import {
  Alert, Avatar, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import DeleteIcon from '@mui/icons-material/Delete'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLE_LABELS } from '../lib/permissions'
import { initials } from '../lib/format'
import { displayName } from '../lib/users'

const MAX_BYTES = 2 * 1024 * 1024        // matches the `avatars` bucket limit
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
const MIN_PASSWORD = 8                   // Supabase's own default minimum

/**
 * Your own account.
 *
 * Name, email and role belong to whoever administers the team — they identify
 * you to everybody else, and the share link, the roster and the Google Chat
 * card all read them. So they are shown here, not edited here. The two things
 * that are genuinely yours are your photo and your password.
 */
export default function Profile() {
  const { session, profile, refreshProfile } = useAuth()
  const email = profile?.email ?? session?.user?.email ?? ''

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Profile</Typography>
      <Stack spacing={2}>
        <AvatarCard profile={profile} email={email} onSaved={refreshProfile} />
        <PasswordCard email={email} />
      </Stack>
    </Box>
  )
}

/** Who you are, plus the one field on it you may change. */
function AvatarCard({ profile, email, onSaved }) {
  const fileInput = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const name = displayName(profile, email)

  // One object per person, at a fixed path, overwritten in place — so changing
  // your photo never leaves an orphan behind. The path's first folder is the
  // user id, which is what the storage policy checks. Because the path never
  // changes, the saved URL carries a cache-buster.
  const save = async (avatar_url) => {
    const { error: updErr } = await supabase
      .from('profiles').update({ avatar_url }).eq('id', profile.id)
    if (updErr) throw updErr
    await onSaved?.()
  }

  const upload = async (file) => {
    if (!file) return
    setError(''); setDone('')
    if (!file.type.startsWith('image/')) {
      return setError('Choose an image file (PNG, JPEG, GIF or WebP).')
    }
    if (file.size > MAX_BYTES) {
      return setError('That image is larger than 2 MB. Choose a smaller one.')
    }
    setBusy(true)
    try {
      const path = `${profile.id}/avatar`
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(path, file, { contentType: file.type, upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      await save(`${data.publicUrl}?v=${Date.now()}`)
      setDone('Photo updated.')
    } catch (err) {
      setError(err.message ?? 'Could not upload that photo.')
    } finally {
      setBusy(false)
    }
  }

  // The object is left in place: it is about to be overwritten by the next
  // upload anyway, and clearing the column is what actually hides the photo.
  const remove = async () => {
    setError(''); setDone(''); setBusy(true)
    try {
      await save(null)
      setDone('Photo removed.')
    } catch (err) {
      setError(err.message ?? 'Could not remove that photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
        <Avatar
          src={profile?.avatar_url || undefined}
          alt={name}
          sx={{ width: 88, height: 88, bgcolor: 'primary.main', fontSize: 30 }}
        >
          {initials(name)}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" noWrap>{name}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{email}</Typography>
          {profile?.role && (
            <Chip size="small" sx={{ mt: 1 }}
              label={ROLE_LABELS[profile.role] ?? profile.role} />
          )}
        </Box>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Your name and email are managed by an administrator. You can change your
        photo here.
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button
          variant="outlined" startIcon={<PhotoCameraIcon />} disabled={busy || !profile}
          onClick={() => fileInput.current?.click()}
        >
          {profile?.avatar_url ? 'Change photo' : 'Upload photo'}
        </Button>
        {profile?.avatar_url && (
          <Button color="inherit" startIcon={<DeleteIcon />} disabled={busy} onClick={remove}>
            Remove
          </Button>
        )}
        <input
          ref={fileInput} type="file" accept={ACCEPT} hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''      // so picking the same file twice still fires
            upload(file)
          }}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        PNG, JPEG, GIF or WebP, up to 2 MB.
      </Typography>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {done && <Alert severity="success" sx={{ mt: 2 }}>{done}</Alert>}
    </Paper>
  )
}

/** Change your own password. */
function PasswordCard({ email }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setDone('')
    if (next.length < MIN_PASSWORD) {
      return setError(`Your new password must be at least ${MIN_PASSWORD} characters.`)
    }
    if (next !== confirm) return setError('The two new passwords do not match.')
    if (next === current) return setError('Your new password must be different from the current one.')

    setBusy(true)
    try {
      // Supabase will happily change the password of whoever holds the session,
      // so an unattended browser would be enough. Proving the current password
      // first is what makes this a password *change* rather than a takeover.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email, password: current,
      })
      if (signInErr) throw new Error('That current password is not right.')

      const { error: updErr } = await supabase.auth.updateUser({ password: next })
      if (updErr) throw updErr

      setCurrent(''); setNext(''); setConfirm('')
      setDone('Password changed.')
    } catch (err) {
      setError(err.message ?? 'Could not change your password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper sx={{ p: 3 }} component="form" onSubmit={submit}>
      <Typography variant="h6">Change password</Typography>
      <Divider sx={{ my: 2 }} />
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {done && <Alert severity="success">{done}</Alert>}
        <TextField
          label="Current password" type="password" required fullWidth
          autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)}
        />
        <TextField
          label="New password" type="password" required fullWidth
          autoComplete="new-password"
          helperText={`At least ${MIN_PASSWORD} characters.`}
          value={next} onChange={(e) => setNext(e.target.value)}
        />
        <TextField
          label="Confirm new password" type="password" required fullWidth
          autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)}
        />
        <Box>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  )
}
