import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Autocomplete, AvatarGroup, Avatar, Box, Button, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, InputAdornment, MenuItem, Paper, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import LinkIcon from '@mui/icons-material/Link'
import CheckIcon from '@mui/icons-material/Check'
import LockIcon from '@mui/icons-material/Lock'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useProject } from '../context/ProjectContext'
import { formatDateTime, initials } from '../lib/format'
import { byDisplayName, displayName } from '../lib/users'
import { copyText } from '../lib/publicLink'
import {
  PROJECT_STATUSES, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABELS,
  embedFormUrl, isValidKey, normalizeKey,
} from '../lib/projects'

const blank = { name: '', key: '', status: 'incoming', members: [] }

/**
 * Admin-only CRUD over projects.
 *
 * A project is a name, an immutable key, a status and a set of members. The key
 * is the only field that cannot be corrected later, so the dialog says so
 * before it is committed rather than explaining it afterwards.
 */
export default function Projects() {
  const { users } = useConfig()
  const { refresh: refreshProjects } = useProject()

  const [rows, setRows] = useState([])
  const [membersByProject, setMembersByProject] = useState({})
  const [ticketCounts, setTicketCounts] = useState({})
  const [dialog, setDialog] = useState(null)   // { id, values }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(null)

  const load = useCallback(async () => {
    const [{ data: projects, error: err }, { data: members }, { data: issues }] =
      await Promise.all([
        supabase.from('projects').select('*').order('name'),
        supabase.from('project_members').select('project_id, user_id'),
        supabase.from('issues').select('project_id'),
      ])
    if (err) setError(err.message)
    setRows(projects ?? [])

    const grouped = {}
    for (const m of members ?? []) (grouped[m.project_id] ??= []).push(m.user_id)
    setMembersByProject(grouped)

    const counts = {}
    for (const i of issues ?? []) counts[i.project_id] = (counts[i.project_id] ?? 0) + 1
    setTicketCounts(counts)
  }, [])

  useEffect(() => { load() }, [load])

  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const sortedUsers = useMemo(() => [...users].sort(byDisplayName), [users])

  const run = async (fn) => {
    setBusy(true); setError('')
    try { await fn(); await load(); await refreshProjects() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const save = () => run(async () => {
    const { id, values } = dialog
    const name = values.name.trim()
    const memberIds = values.members.map((m) => m.id)

    // The key is written once, at creation. The database refuses to change it
    // afterwards, so it is left out of the update entirely.
    const payload = id
      ? { name, status: values.status }
      : { name, key: values.key, status: values.status }

    const { data: saved, error: err } = id
      ? await supabase.from('projects').update(payload).eq('id', id).select('id').single()
      : await supabase.from('projects').insert(payload).select('id').single()
    if (err) throw err

    const projectId = saved.id
    const before = new Set(membersByProject[projectId] ?? [])
    const after = new Set(memberIds)
    const added = memberIds.filter((u) => !before.has(u))
    const removed = [...before].filter((u) => !after.has(u))

    if (added.length) {
      const { error: e } = await supabase.from('project_members')
        .insert(added.map((user_id) => ({ project_id: projectId, user_id })))
      if (e) throw e
    }
    if (removed.length) {
      const { error: e } = await supabase.from('project_members')
        .delete().eq('project_id', projectId).in('user_id', removed)
      if (e) throw e
    }
    setDialog(null)
  })

  const remove = (project) => {
    const count = ticketCounts[project.id] ?? 0
    if (count > 0) {
      return setError(
        `${project.name} still has ${count} ticket${count === 1 ? '' : 's'}. `
        + 'Close the project instead — deleting it would take its tickets with it.',
      )
    }
    if (!confirm(`Delete ${project.name} (${project.key})? Its key cannot be reused later.`)) return
    run(async () => {
      const { error: e } = await supabase.from('projects').delete().eq('id', project.id)
      if (e) throw e
    })
  }

  const copyEmbed = async (key) => {
    const url = embedFormUrl(key)
    if (url && await copyText(url)) {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } else {
      setError(`Copy this link: ${url}`)
    }
  }

  const patch = (field) => (e) =>
    setDialog((d) => ({ ...d, values: { ...d.values, [field]: e.target.value } }))

  const editing = Boolean(dialog?.id)
  const values = dialog?.values ?? blank
  const keyTaken = !editing && rows.some((r) => r.key === values.key)
  const canSave = values.name.trim() && (editing || (isValidKey(values.key) && !keyTaken))

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h5">Projects</Typography>
          <Typography variant="body2" color="text.secondary">
            Every ticket belongs to a project. Members see its tickets; their role
            decides what they may do with them.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />}
          onClick={() => setDialog({ id: null, values: { ...blank, members: [] } })}>
          New project
        </Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell width={90}>Key</TableCell>
              <TableCell width={140}>Status</TableCell>
              <TableCell width={180}>Members</TableCell>
              <TableCell width={90}>Tickets</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right" width={120}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const memberIds = membersByProject[r.id] ?? []
              return (
                <TableRow key={r.id} hover>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={r.key} variant="outlined"
                      sx={{ fontFamily: 'monospace', fontWeight: 600 }} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Box sx={{
                        width: 10, height: 10, borderRadius: '50%',
                        bgcolor: PROJECT_STATUS_COLORS[r.status] ?? '#9ca3af',
                      }} />
                      <Typography variant="body2">
                        {PROJECT_STATUS_LABELS[r.status] ?? r.status}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {memberIds.length === 0 ? (
                      <Typography variant="caption" color="text.disabled">Nobody yet</Typography>
                    ) : (
                      <AvatarGroup max={5} sx={{
                        justifyContent: 'flex-start',
                        '& .MuiAvatar-root': { width: 24, height: 24, fontSize: 10 },
                      }}>
                        {memberIds.map((id) => (
                          <Tooltip key={id} title={displayName(userById[id])}>
                            <Avatar sx={{ bgcolor: 'primary.main' }}>
                              {initials(displayName(userById[id], '?'))}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </AvatarGroup>
                    )}
                  </TableCell>
                  <TableCell>{ticketCounts[r.id] ?? 0}</TableCell>
                  <TableCell>{formatDateTime(r.created_at)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={copied === r.key ? 'Link copied' : 'Copy this project’s embed form link'}>
                      <IconButton size="small" onClick={() => copyEmbed(r.key)}>
                        {copied === r.key ? <CheckIcon fontSize="small" color="success" /> : <LinkIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={() => setDialog({
                      id: r.id,
                      values: {
                        name: r.name, key: r.key, status: r.status,
                        members: memberIds.map((id) => userById[id]).filter(Boolean),
                      },
                    })}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => remove(r)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                    No projects yet. Create one to start taking tickets.
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField label="Name" fullWidth autoFocus required
              value={values.name} onChange={patch('name')} />

            <TextField
              label="Key" fullWidth required
              value={values.key}
              disabled={editing}
              onChange={(e) => setDialog((d) => ({
                ...d, values: { ...d.values, key: normalizeKey(e.target.value) },
              }))}
              error={Boolean(values.key) && (!isValidKey(values.key) || keyTaken)}
              slotProps={{
                htmlInput: { style: { fontFamily: 'monospace', letterSpacing: 2 } },
                input: editing ? {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title="A key is public — it prefixes every ticket number and addresses this project's embed form and share links. It cannot be changed.">
                        <LockIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </Tooltip>
                    </InputAdornment>
                  ),
                } : undefined,
              }}
              helperText={
                editing
                  ? 'Keys are permanent — tickets, embed links and share links all carry it.'
                  : keyTaken
                    ? `${values.key} is already used by another project.`
                    : values.key && !isValidKey(values.key)
                      ? 'Three or four letters, e.g. ACME.'
                      : 'Three or four letters. Prefixes every ticket (ACME-1) and cannot be changed later.'
              }
            />

            <TextField select label="Status" fullWidth
              value={values.status} onChange={patch('status')}>
              {PROJECT_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Box sx={{
                      width: 10, height: 10, borderRadius: '50%',
                      bgcolor: PROJECT_STATUS_COLORS[s],
                    }} />
                    <span>{PROJECT_STATUS_LABELS[s]}</span>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>

            <Autocomplete
              multiple options={sortedUsers}
              value={values.members}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              getOptionLabel={(u) => displayName(u)}
              onChange={(_e, v) => setDialog((d) => ({ ...d, values: { ...d.values, members: v } }))}
              renderInput={(p) => (
                <TextField {...p} label="Members"
                  helperText="Who can see this project's tickets. They keep their own role — a manager is a manager here too." />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy || !canSave}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
