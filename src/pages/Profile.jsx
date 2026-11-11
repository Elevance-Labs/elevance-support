import { useRef, useState } from 'react'
import {
  Alert, Avatar, Box, Button, Chip, Paper, Stack, Typography,
} from '@mui/material'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import DeleteIcon from '@mui/icons-material/Delete'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { can, ROLE_LABELS } from '../lib/permissions'
import { isEmptyDoc, normalizeDoc } from '../lib/richText'
import RichTextEditor from '../components/RichTextEditor'
import { initials } from '../lib/format'
import { departmentOf, displayName } from '../lib/users'

const MAX_BYTES = 2 * 1024 * 1024        // matches the `avatars` bucket limit
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

/**
 * Your own account.
 *
 * Name, email, role and department belong to whoever administers the team — they identify
 * you to everybody else, and the share link, the roster and the Google Chat
 * card all read them. So they are shown here, not edited here. The things
 * that are genuinely yours are your photo and — if you write to customers —
 * your email signature. There is no password to keep: you sign in with Google.
 */
export default function Profile() {
  const { session, profile, refreshProfile } = useAuth()
  const email = profile?.email ?? session?.user?.email ?? ''

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Profile</Typography>
      <Stack spacing={2}>
        <AvatarCard profile={profile} email={email} onSaved={refreshProfile} />
        {can.emailCustomer(profile) && (
          <SignatureCard key={profile.id} profile={profile} onSaved={refreshProfile} />
        )}
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
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
            {profile?.role && (
              <Chip size="small" label={ROLE_LABELS[profile.role] ?? profile.role} />
            )}
            {/* Read-only, like the role beside it: your department decides who
                you can be paired with on a ticket, so it is the team's fact
                about you rather than yours. */}
            {departmentOf(profile) && (
              <Chip size="small" variant="outlined" label={departmentOf(profile)} />
            )}
          </Stack>
        </Box>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Your name, email and department are managed by an administrator. You can
        change your photo here. You sign in with the Google account for this email.
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

/**
 * The signature added to the end of every email you send from a ticket.
 *
 * Optional: with none, an email is signed with your name. It is stored as the
 * same rich text document the email box writes, so it may carry bold, links
 * and lists but no markup of its own; `email-send` reads it from your profile
 * and appends it, and the email box shows it under what you are typing.
 */
function SignatureCard({ profile, onSaved }) {
  const editor = useRef(null)
  const [doc, setDoc] = useState(() => normalizeDoc(profile.email_signature))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const savedDoc = normalizeDoc(profile.email_signature)
  const hasSaved = !isEmptyDoc(savedDoc)
  const dirty = JSON.stringify(normalizeDoc(doc)) !== JSON.stringify(savedDoc)

  const write = async (value, message) => {
    setBusy(true); setError(''); setDone('')
    const { error: updErr } = await supabase.from('profiles')
      .update({ email_signature: value }).eq('id', profile.id)
    setBusy(false)
    if (updErr) return setError(updErr.message)
    await onSaved?.()
    setDone(message)
  }

  // An empty box is "no signature", stored as null rather than as a document
  // with nothing in it.
  const save = () => {
    const value = normalizeDoc(doc)
    return write(isEmptyDoc(value) ? null : value,
      isEmptyDoc(value) ? 'Signature removed.' : 'Signature saved.')
  }

  const remove = async () => {
    editor.current?.clear()
    await write(null, 'Signature removed.')
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Email signature</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Added to the end of every email you send from a ticket. Leave it empty
        to sign with your name instead.
      </Typography>
      <RichTextEditor ref={editor} initialDoc={profile.email_signature}
        onChange={setDoc} disabled={busy} minHeight={72}
        placeholder={`e.g. ${displayName(profile)} · Support team`}
        ariaLabel="Email signature" />
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save signature'}
        </Button>
        {hasSaved && (
          <Button color="error" onClick={remove} disabled={busy}>Remove signature</Button>
        )}
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {done && <Alert severity="success" sx={{ mt: 2 }}>{done}</Alert>}
    </Paper>
  )
}
