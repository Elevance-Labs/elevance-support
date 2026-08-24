import { Alert, Box, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material'
import FolderIcon from '@mui/icons-material/Folder'
import { useProject } from '../context/ProjectContext'
import { PROJECT_STATUS_COLORS, PROJECT_STATUS_LABELS } from '../lib/projects'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'

/**
 * The project a page is looking at.
 *
 * Deliberately single-select with no "All" option: a ticket belongs to one
 * project, its number is only unique within that project, and its members are
 * the people entitled to see it. A combined view would be a view of data the
 * viewer may not be allowed to hold in one place.
 */
export default function ProjectFilter() {
  const { projects, projectId, setProjectId, loading } = useProject()

  if (loading) return <Skeleton variant="rounded" width={260} height={40} />

  if (!projects.length) return null

  return (
    <TextField
      select size="small" label="Project" value={projectId ?? ''}
      onChange={(e) => setProjectId(e.target.value)}
      sx={{ minWidth: 260 }}
      slotProps={{
        input: {
          startAdornment: (
            <FolderIcon sx={{ fontSize: 18, color: 'text.disabled', mr: 1 }} />
          ),
        },
      }}
    >
      {projects.map((p) => (
        <MenuItem key={p.id} value={p.id}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box
              title={PROJECT_STATUS_LABELS[p.status] ?? p.status}
              sx={{
                width: 8, height: 8, borderRadius: '50%',
                bgcolor: PROJECT_STATUS_COLORS[p.status] ?? '#9ca3af',
              }} />
            <span>{p.name}</span>
            <Typography variant="caption" color="text.secondary">{p.key}</Typography>
          </Stack>
        </MenuItem>
      ))}
    </TextField>
  )
}

/**
 * What a page shows instead of itself when there is no project to show.
 *
 * Two different dead ends, and they need different advice: an admin has no
 * projects to work with and can fix that; everyone else is simply not a member
 * of any and needs someone to add them.
 */
export function NoProject() {
  const { profile } = useAuth()
  return (
    <Alert severity="info">
      {can.manageProjects(profile)
        ? 'No projects yet. Create one on the Projects page — every ticket belongs to a project.'
        : 'You are not a member of any project yet. Ask an admin to add you to one.'}
    </Alert>
  )
}
