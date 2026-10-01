import { Alert, Box, Paper, Stack, Typography } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { can, isAdmin } from '../lib/permissions'
import ProjectFilter, { NoProject } from '../components/ProjectFilter'
import ScheduleManager from '../components/ScheduleManager'

/**
 * The selected project's support rota, as a page of its own.
 *
 * It exists because the rota and the project are two different powers. Running
 * support — who is on this week, who is on next — is a manager's job; renaming
 * or deleting the project those tickets belong to is not, and the Projects page
 * that does that stays admin-only. So managers come here, admins may use either.
 *
 * Same component as the dialog on the Projects page, so the two cannot drift.
 */
export default function Schedule() {
  const { profile } = useAuth()
  const { project, projectId, loading } = useProject()

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Box>
          <Typography variant="h5">Schedule</Typography>
          <Typography variant="body2" color="text.secondary">
            Who is on support, and when. A request submitted inside a range is
            assigned to the people on it. Ranges cannot overlap.
          </Typography>
        </Box>
        <ProjectFilter />
      </Stack>

      {!loading && !projectId && <NoProject />}

      {can.manageSchedules(profile) && !isAdmin(profile) && (
        <Alert severity="info">
          You can create schedules and change current and upcoming ones. A past
          schedule can only be changed by an admin.
        </Alert>
      )}

      {projectId && (
        <Paper sx={{ p: 2 }}>
          <ScheduleManager project={project} />
        </Paper>
      )}
    </Stack>
  )
}
