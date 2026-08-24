import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import KeyIcon from '@mui/icons-material/Key'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { formatDateTime } from '../lib/format'
import { can, ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from '../lib/permissions'
import { displayName } from '../lib/users'

/** Account changes need the service_role key, so they go through an Edge Function. */
async function adminCall(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(body),
    },
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

const blank = { full_name: '', email: '', password: '', role: 'member' }

export default function Users() {
  const { profile } = useAuth()
  const { refresh } = useConfig()
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(null)      // { mode, values, id }
  const [pwDialog, setPwDialog] = useState(null)  // { user, password }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('full_name')
    if (error) setError(error.message)
    setRows(data ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (fn) => {
    setBusy(true); setError('')
    try { await fn(); await load(); await refresh() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const save = () => run(async () => {
    const { values, mode, id } = dialog
    if (mode === 'create') {
      await adminCall({ action: 'create', ...values })
    } else {
      await adminCall({
        action: 'update', id,
        full_name: values.full_name,
        ...(can.changeRole(profile) ? { role: values.role } : {}),
      })
    }
    setDialog(null)
  })

  const savePassword = () => run(async () => {
    await adminCall({ action: 'set_password', id: pwDialog.user.id, password: pwDialog.password })
    setPwDialog(null)
  })

  const toggleActive = (row) => run(async () => {
    await adminCall({ action: 'set_active', id: row.id, is_active: !row.is_active })
  })

  const remove = (row) => {
    if (!confirm(`Delete ${displayName(row)}? They lose access immediately.`)) return
    run(() => adminCall({ action: 'delete', id: row.id }))
  }

  const patch = (field) => (e) =>
    setDialog((d) => ({ ...d, values: { ...d.values, [field]: e.target.value } }))

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h5">Users</Typography>
          <Typography variant="body2" color="text.secondary">
            {can.createUser(profile)
              ? 'Add people, set roles, reset passwords and disable accounts.'
              : 'You can reset passwords and disable managers and members.'}
          </Typography>
        </Box>
        {can.createUser(profile) && (
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => setDialog({ mode: 'create', values: { ...blank } })}>
            Add user
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Full name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell width={110}>Active</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right" width={140}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const disabled = r.is_active === false
              return (
                <TableRow key={r.id} hover sx={{ opacity: disabled ? 0.55 : 1 }}>
                  <TableCell>
                    {r.full_name?.trim()
                      ? r.full_name
                      : <em title="No name set — showing a name derived from the email">
                          {displayName(r)}
                        </em>}
                    {r.id === profile?.id && <Chip size="small" label="you" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>
                    <Tooltip title={ROLE_DESCRIPTIONS[r.role] ?? ''}>
                      <Chip size="small" variant="outlined"
                        label={ROLE_LABELS[r.role] ?? r.role}
                        color={r.role === 'admin' ? 'primary' : r.role === 'manager' ? 'info' : 'default'} />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={
                      !can.setActive(profile, r)
                        ? (r.id === profile?.id
                            ? 'You cannot disable your own account'
                            : 'You cannot disable an admin')
                        : disabled ? 'Enable sign-in' : 'Disable sign-in'
                    }>
                      <span>
                        <Switch size="small" checked={!disabled} disabled={busy || !can.setActive(profile, r)}
                          onChange={() => toggleActive(r)} />
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>{formatDateTime(r.created_at)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={can.setPassword(profile, r)
                      ? 'Reset password' : "You cannot change an admin's password"}>
                      <span>
                        <IconButton size="small" disabled={!can.setPassword(profile, r)}
                          onClick={() => setPwDialog({ user: r, password: '' })}>
                          <KeyIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={can.editUser(profile, r) ? 'Edit' : 'You cannot edit an admin'}>
                      <span>
                        <IconButton size="small" disabled={!can.editUser(profile, r)}
                          onClick={() => setDialog({
                            mode: 'edit', id: r.id,
                            values: { full_name: r.full_name, email: r.email, password: '', role: r.role },
                          })}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={can.deleteUser(profile)
                      ? 'Delete' : 'Only admins can delete accounts'}>
                      <span>
                        <IconButton size="small"
                          disabled={!can.deleteUser(profile) || r.id === profile?.id}
                          onClick={() => remove(r)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>No users yet.</Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {/* create / edit */}
      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{dialog?.mode === 'create' ? 'Add user' : 'Edit user'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Full name" fullWidth autoFocus required
              value={dialog?.values.full_name ?? ''} onChange={patch('full_name')}
              helperText="Shown everywhere in the app instead of the email address" />
            <TextField label="Email" type="email" fullWidth
              value={dialog?.values.email ?? ''} onChange={patch('email')}
              disabled={dialog?.mode === 'edit'}
              helperText={dialog?.mode === 'edit' ? 'Email changes are not supported yet' : ''} />
            {dialog?.mode === 'create' && (
              <TextField label="Password" type="password" fullWidth
                value={dialog?.values.password ?? ''} onChange={patch('password')}
                helperText="Minimum 6 characters" />
            )}
            <TextField select label="Role" fullWidth
              value={dialog?.values.role ?? 'member'} onChange={patch('role')}
              disabled={!can.changeRole(profile)}
              helperText={can.changeRole(profile)
                ? ROLE_DESCRIPTIONS[dialog?.values.role ?? 'member']
                : 'Only admins can change roles'}>
              {ROLES.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={save}
            disabled={busy || !(dialog?.values.full_name ?? '').trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* reset password */}
      <Dialog open={Boolean(pwDialog)} onClose={() => setPwDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>Reset password</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Set a new password for {displayName(pwDialog?.user)}.
            They are not notified — pass it on yourself.
          </Typography>
          <TextField label="New password" type="password" fullWidth autoFocus
            value={pwDialog?.password ?? ''}
            onChange={(e) => setPwDialog((d) => ({ ...d, password: e.target.value }))}
            helperText="Minimum 6 characters" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPwDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={savePassword}
            disabled={busy || (pwDialog?.password ?? '').length < 6}>
            {busy ? 'Saving…' : 'Set password'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
