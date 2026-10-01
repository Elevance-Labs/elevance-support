import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import ScheduleManager from './ScheduleManager'

/**
 * The support rota as a dialog, opened from a row on the Projects page.
 *
 * Only the chrome — everything about a schedule lives in `ScheduleManager`, so
 * this and the `/schedule` page cannot drift apart. The page is how managers
 * reach the rota at all: Projects is admin-only, and running the rota is not
 * the same power as renaming or deleting the project it belongs to.
 */
export default function ScheduleDialog({ project, open, onClose }) {
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
        <ScheduleManager project={project} open={open} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
