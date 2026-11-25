import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DeleteIcon from '@mui/icons-material/Delete'
import LockIcon from '@mui/icons-material/Lock'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { can } from '../lib/permissions'
import { byDisplayName, departmentOf, displayName } from '../lib/users'
import { canJoin, MAX_ASSIGNEES, normalizeAssignees, sharedDepartment } from '../lib/assignees'
import {
  byStartDesc, calendarDays, CALENDAR_VIEWS, formatDay, formatRange, handsOverAtMidnight,
  isValidRange, lengthInDays, nextSchedule, overlapping, periodLabel, scheduleFor, shiftEnds,
  shiftPeriod, supportDay, today, toDateKey, weekdayOf,
} from '../lib/schedules'
import { useProject } from '../context/ProjectContext'
import UserAvatar, { AssigneeChip, UserOption } from './UserAvatar'
import ScheduleCalendar from './ScheduleCalendar'
import HandoverSetting from './HandoverSetting'

/** Month or week, remembered per browser — like the Issues grouping. */
const VIEW_KEY = 'el-support.schedule-view'
const readView = () => {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return CALENDAR_VIEWS.includes(v) ? v : 'month'
  } catch { return 'month' }
}
const keepView = (v) => { try { localStorage.setItem(VIEW_KEY, v) } catch { /* this visit only */ } }

/**
 * What to say when a write came back having changed nothing.
 *
 * Row-level security refuses an update or a delete by matching no rows rather
 * than by raising, so this is the only place a refusal can be turned back into
 * a sentence. Two ways to get here: the schedule ended while the page was open,
 * or this is a project the manager is not a member of.
 */
const refusedMessage = (verb) =>
  `Nothing was saved — you may not ${verb} this schedule. A manager may change `
  + 'current and upcoming schedules in projects they belong to; a past one is an admin\'s.'

const LOCKED_REASON = 'This schedule has already ended — only an admin can change it.'

/**
 * A project's support rota — the calendar, the form and the rules.
 *
 * Rendered on its own page (`/schedule`, where managers reach it) and inside
 * `ScheduleDialog` (the Projects page, where admins do). `open` exists for the
 * dialog: it is what re-reads the rota each time it is opened.
 *
 * A schedule is a date range and the one or two people on support for it. When
 * a request arrives, the database looks up the schedule covering its submitted
 * date and puts those people on the ticket — so this is where most assignment
 * actually happens, and the ticket is where it gets corrected.
 *
 * Tapping a day opens the form on it: the schedule covering it, or a new one
 * starting there. Ranges may not overlap within a project. The database refuses
 * one outright; the form says which schedule is in the way before the save,
 * because "23 Jan is already covered by Ada and Grace" is the answer, and a
 * constraint violation is not.
 */
export default function ScheduleManager({ project: given, open = true }) {
  const { users } = useConfig()
  const { profile } = useAuth()
  const { refresh: refreshProjects } = useProject()
  // The hand-over as last saved here, over the row the page passed in — which
  // is not re-read until the page itself reloads.
  const [handover, setHandover] = useState(null)
  const project = useMemo(
    () => (given && handover?.id === given.id ? { ...given, ...handover } : given),
    [given, handover],
  )
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)   // { id, starts_on, ends_on, members, locked }
  const [error, setError] = useState('')
  const [view, setView] = useState(readView)
  const [anchor, setAnchor] = useState(today)

  const editable = can.manageSchedules(profile)
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])

  const projectId = project?.id
  const load = useCallback(async () => {
    if (!projectId) return
    const { data, error: err } = await supabase
      .from('project_schedules').select('*').eq('project_id', projectId)
    if (err) setError(err.message)
    setRows((data ?? []).slice().sort(byStartDesc))
  }, [projectId])

  useEffect(() => {
    if (open) { setForm(null); setError(''); setAnchor(today()); load() }
  }, [open, load])

  const todayKey = today()
  // Who is on is judged by the support day, which runs past midnight until the
  // project's hand-over — the same day the database assigns a ticket by.
  const supportKey = supportDay(project)
  const days = useMemo(() => calendarDays(anchor, view), [anchor, view])
  const onNow = scheduleFor(rows, supportKey)
  const upNext = onNow ? null : nextSchedule(rows, supportKey)

  /** A saved schedule whose pair has since ended up in one department. */
  const staleRota = useCallback((row) =>
    sharedDepartment((row.assignee_ids ?? []).map((id) => userById[id]).filter(Boolean)),
  [userById])

  const openSchedule = (row) => setForm({
    id: row.id,
    starts_on: toDateKey(row.starts_on),
    ends_on: toDateKey(row.ends_on),
    members: (row.assignee_ids ?? []).map((id) => userById[id]).filter(Boolean),
    // Admins change any schedule; managers only current and upcoming ones.
    locked: !can.changeSchedule(profile, row, supportKey),
  })
  const newSchedule = (day) => setForm({
    id: null, starts_on: day, ends_on: day, members: [], locked: false,
  })
  const pick = (day, row) => {
    setError('')
    if (row) openSchedule(row)
    else newSchedule(day)
  }

  const changeView = (_e, v) => { if (v) { setView(v); keepView(v) } }

  return (
    <Stack spacing={2} sx={{ mt: 1 }}>
      {error && !form && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
          On now
        </Typography>
        {onNow ? (
          <>
            <AssigneeChip size={24} users={(onNow.assignee_ids ?? []).map((id) => userById[id])} />
            <Typography variant="body2" color="text.secondary">
              until {shiftEnds(onNow, project)}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Nobody is on support now
            {upNext && ` — next from ${formatDay(upNext.starts_on)}`}.
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <HandoverSetting project={project} editable={can.setHandover(profile)}
          onSaved={(row) => {
            setHandover({
              id: project.id,
              support_time_zone: row?.support_time_zone,
              support_handover: row?.support_handover,
            })
            refreshProjects()
          }} />
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Tooltip title={view === 'week' ? 'Previous week' : 'Previous month'}>
            <IconButton size="small" aria-label="Previous"
              onClick={() => setAnchor((a) => shiftPeriod(a, view, -1))}>
              <ChevronLeftIcon />
            </IconButton>
          </Tooltip>
          <Button size="small" variant="outlined" onClick={() => setAnchor(today())}>Today</Button>
          <Tooltip title={view === 'week' ? 'Next week' : 'Next month'}>
            <IconButton size="small" aria-label="Next"
              onClick={() => setAnchor((a) => shiftPeriod(a, view, 1))}>
              <ChevronRightIcon />
            </IconButton>
          </Tooltip>
        </Stack>
        <Typography variant="h6" sx={{ fontWeight: 600, mr: 'auto', fontSize: { xs: 16, sm: 20 } }}>
          {periodLabel(anchor, view)}
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={changeView}>
          <ToggleButton value="month" sx={{ px: 1.5 }}>Month</ToggleButton>
          <ToggleButton value="week" sx={{ px: 1.5 }}>Week</ToggleButton>
        </ToggleButtonGroup>
        {editable && (
          <Button startIcon={<AddIcon />} variant="contained" size="small"
            onClick={() => { setError(''); newSchedule(todayKey) }}>
            New schedule
          </Button>
        )}
      </Stack>

      <ScheduleCalendar days={days} anchor={anchor} view={view} schedules={rows}
        userById={userById} todayKey={todayKey} supportKey={supportKey} staleRota={staleRota}
        onPick={editable ? pick : undefined} />

      {editable && (
        <Typography variant="caption" color="text.secondary">
          Tap a day to schedule it, or to change the schedule already on it.
        </Typography>
      )}

      <ScheduleForm form={form} setForm={setForm} rows={rows} users={users}
        userById={userById} profile={profile} project={project}
        error={error} setError={setError} onSaved={load} />
    </Stack>
  )
}

/** The form, in a dialog over the calendar. `form` null is closed. */
function ScheduleForm({
  form, setForm, rows, users, userById, profile, project, error, setError, onSaved,
}) {
  const phone = useMediaQuery((t) => t.breakpoints.down('sm'))
  const [busy, setBusy] = useState(false)
  const roster = useMemo(
    () => users.filter((u) => u.is_active !== false).sort(byDisplayName),
    [users],
  )

  const locked = Boolean(form?.locked)
  const candidate = form && { id: form.id, starts_on: form.starts_on, ends_on: form.ends_on }
  const clash = candidate && isValidRange(candidate) ? overlapping(rows, candidate) : null
  const memberIds = normalizeAssignees((form?.members ?? []).map((u) => u.id))
  // A rota is where most pairs come from, so it carries the same department
  // rule a ticket does — one naming two engineers would mint broken tickets.
  const deptClash = sharedDepartment(form?.members ?? [])
  const canSave = Boolean(form) && !locked && isValidRange(form) && memberIds.length > 0
    && !clash && !deptClash
  const close = () => { setForm(null); setError('') }

  const save = async () => {
    setBusy(true); setError('')
    const payload = {
      project_id: project.id,
      starts_on: toDateKey(form.starts_on),
      ends_on: toDateKey(form.ends_on),
      assignee_ids: memberIds,
    }
    // `.select()` so a write row-level security refused is visible: RLS turns
    // down an update by matching no rows rather than by raising, and a silent
    // "saved" that changed nothing is the worst of the three outcomes.
    const { data, error: err } = form.id
      ? await supabase.from('project_schedules').update(payload).eq('id', form.id).select('id')
      : await supabase.from('project_schedules')
          .insert({ ...payload, created_by: profile?.id ?? null }).select('id')
    setBusy(false)
    if (err) return setError(err.message)
    if (!data?.length) return setError(refusedMessage(form.id ? 'change' : 'create'))
    setForm(null)
    onSaved()
  }

  const remove = async () => {
    if (!confirm(
      `Delete the schedule for ${formatRange(form)}? `
      + 'Tickets already assigned by it keep the people it put on them.',
    )) return
    const { data, error: err } = await supabase
      .from('project_schedules').delete().eq('id', form.id).select('id')
    if (err) return setError(err.message)
    if (!data?.length) return setError(refusedMessage('delete'))
    setForm(null)
    onSaved()
  }

  // Moving the start past the end carries the end along, rather than leaving
  // a backwards range to be fixed by hand.
  const setStart = (e) => {
    const v = e.target.value
    setForm((f) => ({ ...f, starts_on: v, ends_on: v && f.ends_on && f.ends_on < v ? v : f.ends_on }))
  }
  const setEnd = (e) => setForm((f) => ({ ...f, ends_on: e.target.value }))

  /** The weekday, inside the date field, so "which Monday" needs no second look. */
  const weekday = (value) => ({
    inputLabel: { shrink: true },
    input: {
      startAdornment: (
        <InputAdornment position="start" sx={{ minWidth: '3ch' }}>
          {weekdayOf(value) || '—'}
        </InputAdornment>
      ),
    },
  })

  const stale = form?.id ? sharedDepartment(form.members) : null
  const days = form && isValidRange(form) ? lengthInDays(form) : 0

  return (
    <Dialog open={Boolean(form)} onClose={close} fullWidth maxWidth="sm" fullScreen={phone}>
      {form && (
        <>
          <DialogTitle sx={{ pb: 0.5 }}>
            {locked ? 'Schedule' : form.id ? 'Edit schedule' : 'New schedule'}
            <Typography variant="body2" color="text.secondary">
              {project?.name} · everyone here goes on each ticket submitted in this range.
            </Typography>
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1.5 }}>
              {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
              {locked && <Alert severity="info" icon={<LockIcon fontSize="inherit" />}>{LOCKED_REASON}</Alert>}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField type="date" label="From" size="small" fullWidth disabled={locked}
                  value={form.starts_on} onChange={setStart} slotProps={weekday(form.starts_on)} />
                <TextField type="date" label="To" size="small" fullWidth disabled={locked}
                  value={form.ends_on} onChange={setEnd} slotProps={weekday(form.ends_on)}
                  error={Boolean(form.ends_on) && !isValidRange(form)}
                  helperText={isValidRange(form)
                    ? `${days} day${days === 1 ? '' : 's'}, both ends included`
                      + (handsOverAtMidnight(project) ? '' : ` — on until ${shiftEnds(form, project)}`)
                    : 'The end of a range cannot be before its start.'} />
              </Stack>

              <Autocomplete multiple size="small" disableCloseOnSelect disabled={locked}
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
                    error={!locked && (memberIds.length === 0 || Boolean(deptClash))}
                    helperText={deptClash
                      ? `Both are in ${deptClash} — a rota pairs two departments, not two colleagues.`
                      : 'One or two people, from different departments.'} />
                )} />

              {clash && !locked && (
                <Alert severity="warning">
                  {formatRange(clash)} is already covered by{' '}
                  {(clash.assignee_ids ?? []).map((id) => displayName(userById[id])).join(' and ')}.
                  Two schedules cannot cover the same day.
                </Alert>
              )}
              {stale && locked && (
                <Alert severity="warning">
                  Both are now in {stale}. A ticket arriving in this range will only be
                  assigned the first of them.
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            {form.id && !locked && (
              <Button color="error" startIcon={<DeleteIcon />} onClick={remove} sx={{ mr: 'auto' }}>
                Delete
              </Button>
            )}
            {locked ? (
              <Button onClick={close}>Close</Button>
            ) : (
              <>
                <Button onClick={close}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={busy || !canSave}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
