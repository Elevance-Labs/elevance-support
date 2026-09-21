import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { can } from '../lib/permissions'
import { byDisplayName, departmentOf, displayName } from '../lib/users'
import { canJoin, MAX_ASSIGNEES, normalizeAssignees, sharedDepartment } from '../lib/assignees'
import {
  byStartDesc, formatRange, isValidRange, lengthInDays, overlapping,
  PHASE_LABELS, phaseOf, today, toDateKey,
} from '../lib/schedules'
import UserAvatar, { AssigneeChip, UserOption } from './UserAvatar'

/** Read top to bottom: who is on now, who is next, who was on when. */
const PHASE_ORDER = ['current', 'upcoming', 'past']

const blank = () => ({ starts_on: today(), ends_on: today(), members: [] })

/**
 * A project's support rota.
 *
 * A schedule is a date range and the one or two people on support for it. When
 * a request arrives, the database looks up the schedule covering its submitted
 * date and puts those people on the ticket — so this dialog is where most
 * assignment actually happens, and the ticket is where it gets corrected.
 *
 * Ranges may not overlap within a project. The database refuses one outright;
 * this says which schedule is in the way before the save rather than after it,
 * because "23 Jan is already covered by Ada and Grace" is the answer, and a
 * constraint violation is not.
 */
export default function ScheduleDialog({ project, open, onClose }) {
  const { users } = useConfig()
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)   // { id, starts_on, ends_on, members }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const editable = can.manageSchedules(profile)
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const roster = useMemo(
    () => users.filter((u) => u.is_active !== false).sort(byDisplayName),
    [users],
  )

  const projectId = project?.id
  const load = useCallback(async () => {
    if (!projectId) return
    const { data, error: err } = await supabase
      .from('project_schedules').select('*').eq('project_id', projectId)
    if (err) setError(err.message)
    setRows((data ?? []).slice().sort(byStartDesc))
  }, [projectId])

  useEffect(() => { if (open) { setForm(null); setError(''); load() } }, [open, load])

  // Grouped rather than one long list: "who is on now" is the question this
  // dialog is opened to answer, and it should not be somewhere in the middle.
  const grouped = useMemo(() => {
    const now = today()
    const out = { current: [], upcoming: [], past: [] }
    for (const r of rows) out[phaseOf(r, now)].push(r)
    // Upcoming reads forwards — the next rota first — while past reads backwards.
    out.upcoming.reverse()
    return out
  }, [rows])

  const candidate = form && {
    id: form.id,
    starts_on: form.starts_on,
    ends_on: form.ends_on,
  }
  const clash = candidate && isValidRange(candidate) ? overlapping(rows, candidate) : null
  const memberIds = normalizeAssignees((form?.members ?? []).map((u) => u.id))
  // A rota is where most pairs come from, so it carries the same department
  // rule a ticket does — one naming two engineers would mint broken tickets.
  const deptClash = sharedDepartment(form?.members ?? [])
  const canSave = Boolean(form) && isValidRange(form) && memberIds.length > 0
    && !clash && !deptClash

  /** A saved schedule whose pair has since ended up in one department. */
  const staleRota = (row) =>
    sharedDepartment((row.assignee_ids ?? []).map((id) => userById[id]).filter(Boolean))

  const save = async () => {
    setBusy(true); setError('')
    const payload = {
      project_id: project.id,
      starts_on: toDateKey(form.starts_on),
      ends_on: toDateKey(form.ends_on),
      assignee_ids: memberIds,
    }
    const { error: err } = form.id
      ? await supabase.from('project_schedules').update(payload).eq('id', form.id)
      : await supabase.from('project_schedules')
          .insert({ ...payload, created_by: profile?.id ?? null })
    setBusy(false)
    if (err) return setError(err.message)
    setForm(null)
    load()
  }

  const remove = async (row) => {
    if (!confirm(
      `Delete the schedule for ${formatRange(row)}? `
      + 'Tickets already assigned by it keep the people it put on them.',
    )) return
    const { error: err } = await supabase
      .from('project_schedules').delete().eq('id', row.id)
    if (err) return setError(err.message)
    load()
  }

  const edit = (row) => setForm({
    id: row.id,
    starts_on: toDateKey(row.starts_on),
    ends_on: toDateKey(row.ends_on),
    members: (row.assignee_ids ?? []).map((id) => userById[id]).filter(Boolean),
  })

  const patch = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 0.5 }}>
        Support schedule
        <Typography variant="body2" color="text.secondary">
          {project?.name} · a request submitted inside a range is assigned to the
          people on it. Ranges cannot overlap.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          {editable && !form && (
            <Box>
              <Button startIcon={<AddIcon />} variant="outlined"
                onClick={() => setForm({ id: null, ...blank() })}>
                New schedule
              </Button>
            </Box>
          )}

          {form && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 2 }}>
                {form.id ? 'Edit schedule' : 'New schedule'}
              </Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField type="date" label="From" size="small" fullWidth
                    value={form.starts_on} onChange={patch('starts_on')}
                    slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField type="date" label="To" size="small" fullWidth
                    value={form.ends_on} onChange={patch('ends_on')}
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={Boolean(form.ends_on) && !isValidRange(form)}
                    helperText={isValidRange(form)
                      ? `${lengthInDays(form)} day${lengthInDays(form) === 1 ? '' : 's'}, both ends included`
                      : 'The end of a range cannot be before its start.'} />
                </Stack>

                <Autocomplete multiple size="small" disableCloseOnSelect
                  options={roster}
                  value={form.members}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  getOptionLabel={(u) => displayName(u)}
                  getOptionDisabled={(u) => !canJoin(form.members, u)}
                  onChange={(_e, picked) =>
                    setForm((f) => ({ ...f, members: picked.slice(0, MAX_ASSIGNEES) }))}
                  renderOption={({ key, ...props }, u) => (
                    <li key={key} {...props}><UserOption user={u} size={22} /></li>
                  )}
                  renderValue={(selected, getItemProps) =>
                    selected.map((u, i) => {
                      const { key, ...chipProps } = getItemProps({ index: i })
                      return (
                        <Chip key={key} {...chipProps} size="small"
                          label={departmentOf(u) ? `${displayName(u)} · ${departmentOf(u)}` : displayName(u)}
                          avatar={<UserAvatar user={u} size={22} />} />
                      )
                    })
                  }
                  renderInput={(p) => (
                    <TextField {...p} label="On support"
                      error={memberIds.length === 0 || Boolean(deptClash)}
                      helperText={deptClash
                        ? `Both are in ${deptClash} — a rota pairs two departments, not two colleagues.`
                        : 'One or two people, from different departments. They go on every ticket submitted in this range.'} />
                  )} />

                {clash && (
                  <Alert severity="warning">
                    {formatRange(clash)} is already covered by{' '}
                    {(clash.assignee_ids ?? []).map((id) => displayName(userById[id])).join(' and ')}.
                    Two schedules cannot cover the same day.
                  </Alert>
                )}

                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setForm(null)}>Cancel</Button>
                  <Button variant="contained" onClick={save} disabled={busy || !canSave}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}

          {PHASE_ORDER.map((phase) => (
            <Box key={phase}>
              <Typography variant="overline" color="text.secondary">
                {PHASE_LABELS[phase]}
              </Typography>
              {grouped[phase].length === 0 ? (
                <Typography variant="body2" color="text.disabled">
                  {phase === 'current' ? 'Nobody is scheduled today.'
                    : phase === 'upcoming' ? 'Nothing scheduled ahead.'
                    : 'No past schedules.'}
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ mt: 0.5 }}>
                  {grouped[phase].map((r) => (
                    <Paper key={r.id} variant="outlined"
                      sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ minWidth: 200 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatRange(r)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {lengthInDays(r)} day{lengthInDays(r) === 1 ? '' : 's'}
                        </Typography>
                      </Box>
                      <AssigneeChip size={24}
                        users={(r.assignee_ids ?? []).map((id) => userById[id])} />
                      {staleRota(r) && (
                        <Tooltip title={
                          `Both are now in ${staleRota(r)}. A ticket arriving in this range `
                          + 'will only be assigned the first of them until this is fixed.'
                        }>
                          <Chip size="small" color="warning" variant="outlined"
                            label={`Both in ${staleRota(r)}`} />
                        </Tooltip>
                      )}
                      <Box sx={{ flexGrow: 1 }} />
                      {editable && (
                        <>
                          <Tooltip title="Edit this schedule">
                            <IconButton size="small" onClick={() => edit(r)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete this schedule">
                            <IconButton size="small" onClick={() => remove(r)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </Paper>
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
