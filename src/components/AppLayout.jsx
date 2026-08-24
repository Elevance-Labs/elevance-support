import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Alert, AppBar, Avatar, Box, Button, Divider, Drawer, IconButton, List, ListItemButton,
  ListItemIcon, ListItemText, Menu, MenuItem, Toolbar, Typography,
} from '@mui/material'
import ListAltIcon from '@mui/icons-material/ListAlt'
import BarChartIcon from '@mui/icons-material/BarChart'
import ViewKanbanIcon from '@mui/icons-material/ViewKanban'
import PeopleIcon from '@mui/icons-material/People'
import FolderIcon from '@mui/icons-material/Folder'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
import SupportAgentIcon from '@mui/icons-material/SupportAgent'
import AddIcon from '@mui/icons-material/Add'
import { useAuth } from '../context/AuthContext'
import { can, ROLE_LABELS } from '../lib/permissions'
import { RefreshProvider, useRefreshSignal } from '../context/RefreshContext'
import CreateIssueDialog from './CreateIssueDialog'
import { initials } from '../lib/format'
import { displayName } from '../lib/users'

const WIDTH = 224

// `show` decides visibility per role; see src/lib/permissions.js.
const NAV = [
  { to: '/issues', label: 'Issues',        icon: <ListAltIcon /> },
  { to: '/board',  label: 'Board',         icon: <ViewKanbanIcon /> },
  { to: '/report', label: 'Report',        icon: <BarChartIcon />,  show: can.seeReports },
  { to: '/projects', label: 'Projects',    icon: <FolderIcon />,    show: can.seeProjects },
  { to: '/users',  label: 'Users',         icon: <PeopleIcon />,    show: can.seeUsers },
  { to: '/config', label: 'Configuration', icon: <SettingsIcon />,  show: can.seeConfig },
]

export default function AppLayout() {
  return (
    <RefreshProvider>
      <AppLayoutInner />
    </RefreshProvider>
  )
}

function AppLayoutInner() {
  const { profile, signOut } = useAuth()
  const { refresh } = useRefreshSignal()
  const [anchor, setAnchor] = useState(null)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const handleSignOut = async () => {
    setAnchor(null)
    await signOut()
    navigate('/login')
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: WIDTH,
          '& .MuiDrawer-paper': { width: WIDTH, boxSizing: 'border-box', bgcolor: '#fff' },
        }}
      >
        <Toolbar sx={{ gap: 1, px: 2 }}>
          <SupportAgentIcon color="primary" />
          <Typography variant="h6" noWrap>Support</Typography>
        </Toolbar>
        <Divider />
        <List sx={{ px: 1, py: 1 }}>
          {NAV.filter((n) => !n.show || n.show(profile)).map((n) => (
            <ListItemButton
              key={n.to}
              component={NavLink}
              to={n.to}
              sx={{
                borderRadius: 2, mb: 0.5,
                '&.active': { bgcolor: 'primary.main', color: '#fff',
                  '& .MuiListItemIcon-root': { color: '#fff' } },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{n.icon}</ListItemIcon>
              <ListItemText primary={n.label} slotProps={{ primary: { fontSize: 14 } }} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar position="sticky" sx={{ borderBottom: '1px solid #e5e7eb', bgcolor: '#fff' }}>
          <Toolbar sx={{ justifyContent: 'flex-end', gap: 1 }}>
            <Button variant="contained" startIcon={<AddIcon />}
              onClick={() => setCreating(true)} sx={{ mr: 1 }}>
              Create Issue
            </Button>
            <Typography variant="body2" color="text.secondary">
              {displayName(profile, '')}
              {profile?.role && ` · ${ROLE_LABELS[profile.role] ?? profile.role}`}
            </Typography>
            <IconButton onClick={(e) => setAnchor(e.currentTarget)} size="small">
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                {initials(displayName(profile, ''))}
              </Avatar>
            </IconButton>
            <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
              <MenuItem onClick={handleSignOut}>
                <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
                Sign out
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>
        <Box sx={{ p: 3, flexGrow: 1, minWidth: 0 }}>
          {/* A signed-in user with no profiles row isn't an admin and isn't a member —
              they're in a broken state. Say so instead of quietly hiding pages. */}
          {!profile && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Your account has no profile record, so admin pages (Users,
              Configuration) are hidden. Run{' '}
              <code>supabase/schema.sql</code> to create one.
            </Alert>
          )}
          <Outlet />
        </Box>

        <CreateIssueDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      </Box>
    </Box>
  )
}
