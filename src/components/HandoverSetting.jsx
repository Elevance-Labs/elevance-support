import { useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography, useMediaQuery,
} from '@mui/material'
import ScheduleIcon from '@mui/icons-material/Schedule'
import { supabase } from '../lib/supabase'
import {
  formatDay, formatTime, handoverLabel, handoverOf, isTimeZone, supportDay, timeZones, toTimeKey,
} from '../lib/schedules'

/**
 * When the project's support day hands over to the next: a time zone and a
 * time. Shown on the rota for everyone who can see it; `editable` adds the
 * dialog that changes it.
 *
 * Saved through `set_support_handover()` — the projects table is admin-only to
 * write, and this pair is part of running the rota, which managers do too.
 * `onSaved` gets the project row the database returned.
 */
export default function HandoverSetting({ project, editable, onSaved }) {
  const [draft, setDraft] = useState(null)   // { timeZone, handover } while open
  const label = `Hands over ${handoverLabel(project)}`

  if (!editable) {
    return <Typography variant="body2" color="text.secondary">{label}</Typography>
  }
  return (
    <>
      <Button size="small" startIcon={<ScheduleIcon />} color="inherit"
        onClick={() => setDraft(handoverOf(project))}
        sx={{ color: 'text.secondary', textTransform: 'none' }}>
        {label}
      </Button>
      <HandoverDialog project={project} draft={draft} setDraft={setDraft} onSaved={onSaved} />
    </>
  )
}

function HandoverDialog({ project, draft, setDraft, onSaved }) {
  const phone = useMediaQuery((t) => t.breakpoints.down('sm'))
  const zones = useMemo(() => timeZones(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = () => { setDraft(null); setError('') }
  const time = toTimeKey(draft?.handover)
  const valid = Boolean(draft) && isTimeZone(draft.timeZone) && Boolean(time)
  const preview = valid
    ? { ...project, support_time_zone: draft.timeZone, support_handover: time }
    : null

  const save = async () => {
    setBusy(true); setError('')
    const { data, error: err } = await supabase.rpc('set_support_handover', {
      p_project: project.id, p_time_zone: draft.timeZone, p_handover: time,
    })
    setBusy(false)
    if (err) return setError(err.message)
    setDraft(null)
    onSaved?.(data ?? preview)
  }

  return (
    <Dialog open={Boolean(draft)} onClose={close} fullWidth maxWidth="xs" fullScreen={phone}>
      {draft && (
        <>
          <DialogTitle sx={{ pb: 0.5 }}>
            Support hand-over
            <Typography variant="body2" color="text.secondary">
              {project?.name} · when one schedule day turns into the next.
            </Typography>
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1.5 }}>
              {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
              <Autocomplete size="small" disableClearable options={zones}
                value={draft.timeZone}
                onChange={(_e, v) => setDraft((d) => ({ ...d, timeZone: v }))}
                renderInput={(p) => <TextField {...p} label="Time zone" />} />
              <TextField type="time" size="small" label="Hands over at"
                value={draft.handover}
                onChange={(e) => setDraft((d) => ({ ...d, handover: e.target.value }))}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60 } }}
                error={!time} helperText={time ? ' ' : 'Pick a time.'} />
              {preview && <Example project={preview} time={time} zone={draft.timeZone} />}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={busy || !valid}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}

/** The rule, worked through once, so "12:00 PM" is not left to interpretation. */
function Example({ project, time: value, zone }) {
  const midnight = value === '00:00'
  const time = formatTime(value)
  return (
    <Alert severity="info" icon={false}>
      {midnight
        ? `Each schedule day runs midnight to midnight, ${zone} time.`
        : `Each schedule day runs from ${time} that day to ${time} the next, ${zone} time. `
          + `Someone on Monday–Tuesday is on until ${time} Wednesday, and a ticket `
          + `before ${time} on Monday goes to Sunday's schedule.`}
      {' '}New tickets are assigned by this; tickets already filed keep their people.
      <Typography variant="body2" sx={{ mt: 1, fontWeight: 500 }}>
        Right now it is {formatDay(supportDay(project))} on the rota.
      </Typography>
    </Alert>
  )
}
