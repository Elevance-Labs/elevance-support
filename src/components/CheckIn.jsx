import { useState } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText,
  Stack, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { can } from '../lib/permissions'
import { issueRef } from '../lib/projects'
import {
  actionsOf, advance, canAdvance, checkInProgress, checkInSummary, currentId, goBack,
  isLast, recordAction, startCheckIn,
} from '../lib/checkIn'
import IssueDetail from './IssueDetail'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The button that starts a check-in over `tickets` — the open tickets the page
 * is showing, in the check-in's own order (`checkInQueue`). Admins and managers only, and
 * nothing at all for anyone else: a member has no use for a greyed-out one.
 */
export function CheckInButton({ tickets, onStart }) {
  const { profile } = useAuth()
  if (!can.checkIn(profile)) return null
  const n = tickets.length
  return (
    <Tooltip title={n
      ? `Go through the ${plural(n, 'open ticket')} shown here one by one — each needs a status change or a comment before the next`
      : 'No open tickets in this view'}>
      <span>
        <Button variant="outlined" startIcon={<FactCheckIcon />} disabled={!n}
          onClick={() => onStart(tickets)}>
          Check-in
        </Button>
      </span>
    </Tooltip>
  )
}

/**
 * A check-in in progress: the ticket dialog, one open ticket at a time, held
 * on each until a status change is saved or a comment posted on it — so what
 * the team agrees about a ticket is written on the ticket before the meeting
 * moves on. Then a summary of what was captured, and what was not if it was
 * ended early.
 *
 * `tickets` is pinned when the check-in starts: a save that re-sorts the page,
 * or moves a ticket out of its filter, does not reshuffle the meeting.
 * Mounted for the length of one check-in; `onClose` unmounts it.
 */
export default function CheckIn({ tickets, onClose, onSaved }) {
  const { project } = useProject()
  const phone = useMediaQuery((t) => t.breakpoints.down('sm'))
  const [state, setState] = useState(() => startCheckIn(tickets.map((t) => t.id)))
  const [ended, setEnded] = useState(false)

  const id = currentId(state)
  const { position, total, addressed } = checkInProgress(state)

  const end = () => {
    const left = total - addressed
    if (left && !confirm(
      `End the check-in? ${plural(left, 'ticket')} of ${total} ${left === 1 ? 'has' : 'have'} nothing captured yet.`,
    )) return
    setEnded(true)
  }

  const step = {
    position, total, addressedCount: addressed,
    actions: actionsOf(state, id),
    canAdvance: canAdvance(state),
    isLast: isLast(state),
    onAction: (action) => setState((s) => recordAction(s, id, action)),
    onBack: () => setState(goBack),
    onNext: () => (isLast(state) ? setEnded(true) : setState(advance)),
    onEnd: end,
    onRemoved: () => {
      const next = recordAction(state, id, 'deleted')
      setState(isLast(next) ? next : advance(next))
      if (isLast(next)) setEnded(true)
    },
  }

  const summary = checkInSummary(state)
  const byId = Object.fromEntries(tickets.map((t) => [t.id, t]))

  return (
    <>
      <IssueDetail issueId={id} open={!ended} checkIn={step}
        onClose={end} onSaved={onSaved} />

      <Dialog open={ended} onClose={onClose} fullWidth maxWidth="sm" fullScreen={phone}>
        <DialogTitle>{summary.complete ? 'Check-in complete' : 'Check-in ended'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography variant="body1">
              {summary.addressed} of {plural(summary.total, 'open ticket')} captured.
            </Typography>
            <Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                {plural(summary.statusChanges, 'status change')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {plural(summary.comments, 'ticket')} commented on
              </Typography>
              {summary.deleted > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {summary.deleted} deleted
                </Typography>
              )}
            </Stack>
            {summary.missed.length > 0 && (
              <>
                <Typography variant="subtitle2" color="warning.main">
                  Nothing captured on {plural(summary.missed.length, 'ticket')}
                </Typography>
                <List dense disablePadding>
                  {summary.missed.map((mid) => (
                    <ListItem key={mid} disableGutters>
                      <ListItemText
                        primary={`${issueRef(project, byId[mid]) ?? ''} ${byId[mid]?.title ?? ''}`.trim()} />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose}>Done</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
