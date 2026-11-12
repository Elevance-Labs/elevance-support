import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Avatar, Box, Button, Chip, IconButton, List, ListItem, ListItemText, Paper, Stack, Tooltip,
  Typography,
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
import { ago } from '../lib/format'
import { pushPrompt, pushStatusText } from '../lib/push'
import usePushDevice from '../components/usePushDevice'

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
 * Which devices get your notifications is yours too.
 */
export default function Profile() {
  const { session, profile, refreshProfile } = useAuth()
  const email = profile?.email ?? session?.user?.email ?? ''

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Profile</Typography>
      <Stack spacing={2}>
        <AvatarCard profile={profile} email={email} onSaved={refreshProfile} />
        {profile && <NotificationsCard profile={profile} />}
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

/** "5m ago", or "just now". */
const since = (t) => {
  const a = ago(t)
  return a === 'just now' ? a : `${a} ago`
}

const STATUS_CHIP = {
  on: { label: 'On', color: 'success' },
  off: { label: 'Off', color: 'default' },
  blocked: { label: 'Blocked', color: 'warning' },
  'install-first': { label: 'Install first', color: 'info' },
  unsupported: { label: 'Not available', color: 'default' },
  unconfigured: { label: 'Not set up', color: 'default' },
}

/**
 * Notifications: what you are told about, whether this device gets them, and
 * the other devices that do. The bell in the header has them all either way;
 * a device only adds the alert when the app is closed.
 */
function NotificationsCard({ profile }) {
  const push = usePushDevice(profile.id)
  const [devices, setDevices] = useState([])
  const [sent, setSent] = useState(false)

  const loadDevices = useCallback(async () => {
    const { data } = await supabase.from('push_subscriptions')
      .select('id, endpoint, device, created_at, last_used_at').eq('user_id', profile.id).order('created_at')
    setDevices(data ?? [])
  }, [profile.id])

  // Turning this device on or off changes the list as well.
  useEffect(() => { loadDevices() }, [loadDevices, push.status])

  // Removing this device is turning it off here; another one is told nothing
  // until it next looks, and then says its notifications have stopped.
  const removeDevice = async (d) => {
    if (d.endpoint && d.endpoint === push.endpoint) return push.disable()
    await supabase.from('push_subscriptions').delete().eq('id', d.id)
    loadDevices()
  }

  const test = async () => {
    setSent(false)
    if (await push.test()) setSent(true)
  }

  const chip = push.status === 'off' && push.wasOn ? { label: 'Stopped', color: 'warning' } : STATUS_CHIP[push.status]

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Notifications</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        You are notified when you are assigned a ticket or someone @mentions you, and when a
        ticket you watch gets a comment, changes status or the customer replies. You watch a
        ticket once you are on it, comment on it or are mentioned; the eye on a ticket
        changes that.
      </Typography>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>On this device</Typography>
        {chip && <Chip size="small" label={chip.label} color={chip.color} />}
      </Stack>
      {push.status !== 'loading' && (
        <Typography variant="body2" color="text.secondary">
          {push.wasOn && (push.status === 'off' || push.status === 'blocked')
            ? pushPrompt(push.status, { device: push.device, wasOn: true }).text
            : pushStatusText(push.status, push.device)}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        {push.status === 'off' && (
          <Button variant="contained" disabled={push.busy} onClick={push.enable}>
            {push.wasOn ? 'Turn back on' : 'Turn on'}
          </Button>
        )}
        {push.status === 'on' && (
          <>
            <Button variant="outlined" disabled={push.busy} onClick={test}>Send a test</Button>
            <Button color="inherit" disabled={push.busy} onClick={push.disable}>Turn off</Button>
          </>
        )}
      </Stack>
      {sent && (
        <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSent(false)}>
          Sent. It should appear on this device (and your other ones) in a few seconds.
        </Alert>
      )}
      {push.error && <Alert severity="error" sx={{ mt: 2 }} onClose={push.clearError}>{push.error}</Alert>}

      {devices.length > 0 && (
        <>
          <Typography variant="body2" sx={{ fontWeight: 500, mt: 3 }}>Your devices</Typography>
          <List dense disablePadding>
            {devices.map((d) => (
              <ListItem key={d.id} disableGutters secondaryAction={(
                <Tooltip title="Stop notifications on this device">
                  <IconButton edge="end" aria-label={`Remove ${d.device || 'device'}`}
                    onClick={() => removeDevice(d)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}>
                <ListItemText
                  primary={`${d.device || 'A device'}${d.endpoint && d.endpoint === push.endpoint ? ' — this device' : ''}`}
                  secondary={d.last_used_at ? `Last notified ${since(d.last_used_at)}` : `Added ${since(d.created_at)}`} />
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Paper>
  )
}
