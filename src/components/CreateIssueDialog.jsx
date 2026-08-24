import { useEffect, useState } from 'react'
import {
  Alert, Button, Dialog, DialogContent, DialogTitle, IconButton, MenuItem,
  Stack, TextField, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import IssueForm from './IssueForm'
import { useProject } from '../context/ProjectContext'

/**
 * Staff-side ticket creation — for when a request arrives by email or phone
 * rather than through the public form. Same form, nothing hidden.
 */
export default function CreateIssueDialog({ open, onClose, onCreated }) {
  const { projects, projectId } = useProject()
  const [created, setCreated] = useState(false)
  // Opens on whichever project the person is already working in, but stays a
  // choice: the call you are logging isn't always about the board you're on.
  const [target, setTarget] = useState(projectId)

  useEffect(() => { if (open) setTarget(projectId) }, [open, projectId])

  const close = () => { setCreated(false); onClose() }

  const handleSubmitted = (issueId) => {
    setCreated(true)
    onCreated?.(issueId)
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Stack sx={{ flexGrow: 1 }}>
          <Typography variant="h6">Create issue</Typography>
          <Typography variant="body2" color="text.secondary">
            Log a request that came in by email, chat or phone.
          </Typography>
        </Stack>
        <IconButton onClick={close}><CloseIcon /></IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {created ? (
          <Stack spacing={2} sx={{ py: 5, textAlign: 'center', alignItems: 'center' }}>
            <CheckCircleIcon color="success" sx={{ fontSize: 48 }} />
            <Typography variant="h6">Ticket created</Typography>
            <Typography variant="body2" color="text.secondary">
              It's on the board in the first New status.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => setCreated(false)}>
                Create another
              </Button>
              <Button onClick={close}>Done</Button>
            </Stack>
          </Stack>
        ) : (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              Record the customer's own details below — the ticket is attributed to
              them, not to you.
            </Alert>
            <IssueForm
              submitLabel="Create issue" projectId={target}
              onSubmitted={handleSubmitted}
            >
              <TextField
                select fullWidth size="small" label="Project" required
                value={target ?? ''} onChange={(e) => setTarget(e.target.value)}
                helperText="Which project this ticket belongs to. It cannot be moved later."
              >
                {projects.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name} ({p.key})</MenuItem>
                ))}
              </TextField>
            </IssueForm>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
