import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Alert, AppBar, Avatar, Box, Button, ButtonBase, Divider, Drawer, IconButton, List, ListItemButton,
  ListItemIcon, ListItemText, Menu, MenuItem, Toolbar, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft'
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import DashboardIcon from '@mui/icons-material/DashboardOutlined'
import ListAltIcon from '@mui/icons-material/ListAltOutlined'
import BarChartIcon from '@mui/icons-material/BarChartOutlined'
import ViewKanbanIcon from '@mui/icons-material/ViewKanbanOutlined'
import PeopleIcon from '@mui/icons-material/PeopleOutlined'
import FolderIcon from '@mui/icons-material/FolderOutlined'
import EventNoteIcon from '@mui/icons-material/EventNoteOutlined'
import SettingsIcon from '@mui/icons-material/SettingsOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import PersonIcon from '@mui/icons-material/PersonOutlined'
import SupportAgentIcon from '@mui/icons-material/SupportAgent'
import AddIcon from '@mui/icons-material/Add'
import { useAuth } from '../context/AuthContext'
import { can, ROLE_LABELS } from '../lib/permissions'
import { RefreshProvider, useRefreshSignal } from '../context/RefreshContext'
import { NotificationsProvider } from '../context/NotificationsContext'
import NotificationsBell from './NotificationsBell'
import CreateIssueDialog from './CreateIssueDialog'
import ProjectFilter from './ProjectFilter'
import { displayName } from '../lib/users'
import UserAvatar from './UserAvatar'
import AppSwitcher from './AppSwitcher'
import { useNavCollapsed } from './useNavCollapsed'
import { InstallBanner, InstallNavButton } from './InstallApp'

// The shell is the one the other Elevance apps wear: a header across the top
// (navigation toggle, app switcher, logo, account) and the navigation under
// it on the left. Sizes and spacing match theirs.
const WIDTH = 248
// Collapsed, the navigation is a rail just wide enough for its icons.
const RAIL = 68
// Below `md` the project picker leaves the header for a bar of its own under
// it, this tall; the page and the drawer start below both.
const SUBBAR = 56

// `show` decides visibility per role; see src/lib/permissions.js.
// `scoped` marks a page that shows one project's data: the header carries the
// project picker there, and nowhere else — on Users or Configuration it would
// be a control that changes nothing on screen.
const NAV = [
  { to: '/dashboard', label: 'Dashboard',  icon: <DashboardIcon />, scoped: true },
  { to: '/issues', label: 'Issues',        icon: <ListAltIcon />,   scoped: true },
  { to: '/board',  label: 'Board',         icon: <ViewKanbanIcon />, scoped: true },
  { to: '/report', label: 'Report',        icon: <BarChartIcon />,  show: can.seeReports, scoped: true },
  { to: '/schedule', label: 'Schedule',    icon: <EventNoteIcon />, show: can.seeSchedules, scoped: true },
  { to: '/projects', label: 'Projects',    icon: <FolderIcon />,    show: can.seeProjects },
  { to: '/users',  label: 'Users',         icon: <PeopleIcon />,    show: can.seeUsers },
  { to: '/config', label: 'Configuration', icon: <SettingsIcon />,  show: can.seeConfig },
]

export default function AppLayout() {
  return (
    <RefreshProvider>
      <NotificationsProvider>
        <AppLayoutInner />
      </NotificationsProvider>
    </RefreshProvider>
  )
}

function AppLayoutInner() {
  const { profile, session, signOut } = useAuth()
  const { refresh } = useRefreshSignal()
  const [anchor, setAnchor] = useState(null)
  const [creating, setCreating] = useState(false)
  // Below a tablet's width the navigation is a drawer opened from the header,
  // so the page gets the whole screen. Asked as "is it narrow?" so that where
  // the answer is unknown (no media queries) the full layout is what shows.
  const narrow = useMediaQuery((t) => t.breakpoints.down('md'))
  const [navOpen, setNavOpen] = useState(false)
  // On a wide screen the navigation can be folded to a rail of icons instead.
  const [collapsed, toggleCollapsed] = useNavCollapsed()
  const rail = !narrow && collapsed
  const width = rail ? RAIL : WIDTH
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const on = (n) => pathname === n.to || pathname.startsWith(`${n.to}/`)
  const scoped = NAV.some((n) => n.scoped && on(n))
  const subbar = narrow && scoped
  const name = displayName(profile, '')
  const email = profile?.email ?? session?.user?.email ?? ''
  const role = profile?.role ? (ROLE_LABELS[profile.role] ?? profile.role) : ''

  const handleSignOut = async () => {
    setAnchor(null)
    await signOut()
    navigate('/login')
  }

  const navLabel = rail ? 'Expand navigation' : 'Collapse navigation'

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, borderBottom: 1, borderColor: 'divider', bgcolor: '#fff' }}>
        <Toolbar sx={{ gap: { xs: 0.75, sm: 1.5 } }}>
          {narrow && (
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <AppSwitcher current="support" email={profile?.email} />
          <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
            <SupportAgentIcon sx={{ fontSize: 20 }} />
          </Avatar>
          <Typography variant="h6" component="div" noWrap sx={{ display: { xs: 'none', lg: 'block' } }}>
            Elevance Support
          </Typography>
          {scoped && !narrow && <ProjectFilter />}
          <Box sx={{ flexGrow: 1 }} />
          {narrow ? (
            <Tooltip title="Create issue">
              <IconButton color="primary" aria-label="Create issue" onClick={() => setCreating(true)}>
                <AddIcon />
              </IconButton>
            </Tooltip>
          ) : (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              Create Issue
            </Button>
          )}
          <NotificationsBell />
          <ButtonBase
            onClick={(e) => setAnchor(e.currentTarget)}
            aria-label="Account menu"
            sx={{ borderRadius: 6, py: 0.5, pl: 0.5, pr: 1, gap: 1.25, flexShrink: 0, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <UserAvatar user={profile} size={34} />
            <Box sx={{ textAlign: 'left', display: { xs: 'none', md: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.2 }}>{name}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{role}</Typography>
            </Box>
            <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }} />
          </ButtonBase>
          <Menu
            anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 1, minWidth: 240 } } }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{name}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{email}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{role}</Typography>
            </Box>
            <Divider />
            <MenuItem onClick={() => { setAnchor(null); navigate('/profile') }}>
              <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
              Profile
            </MenuItem>
            <MenuItem onClick={handleSignOut}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
        {/* On a phone or tablet the header has no room for the picker beside
            its buttons, so it gets the full width of a bar of its own. */}
        {subbar && (
          <Toolbar data-project-bar disableGutters
            sx={{ minHeight: `${SUBBAR}px !important`, px: 2, borderTop: 1, borderColor: 'divider' }}>
            <ProjectFilter fullWidth />
          </Toolbar>
        )}
      </AppBar>

      <Drawer
        variant={narrow ? 'temporary' : 'permanent'}
        open={narrow ? navOpen : true}
        onClose={() => setNavOpen(false)}
        sx={{ width: narrow ? 0 : width, flexShrink: 0 }}
        slotProps={{ paper: { sx: { width: narrow ? WIDTH : width, boxSizing: 'border-box', overflowX: 'hidden', border: 0, borderRight: '1px solid #e5e7eb', borderRadius: 0 } } }}
      >
        <Toolbar />
        {subbar && <Box sx={{ height: SUBBAR, flexShrink: 0 }} />}
        {/* On a phone the offer to install leads the navigation, until dismissed. */}
        {narrow && <InstallBanner />}
        <List sx={{ px: rail ? 1 : 1.5, py: 1.5 }}>
          {NAV.filter((n) => !n.show || n.show(profile)).map((n) => (
            <Tooltip key={n.to} title={rail ? n.label : ''} placement="right">
              <ListItemButton
                component={Link}
                to={n.to}
                selected={on(n)}
                aria-label={n.label}
                onClick={() => setNavOpen(false)}
                sx={{
                  borderRadius: 2, mb: 0.5, justifyContent: rail ? 'center' : 'flex-start',
                  '&.Mui-selected': {
                    color: 'primary.main',
                    '& .MuiListItemIcon-root': { color: 'primary.main' },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: rail ? 0 : 40 }}>{n.icon}</ListItemIcon>
                {!rail && <ListItemText primary={n.label} slotProps={{ primary: { sx: { fontWeight: 500 } } }} />}
              </ListItemButton>
            </Tooltip>
          ))}
        </List>
        {/* Pinned to the foot of the navigation, where it stays put whether the
            navigation is folded or not. Not a page, so not a list item. Install
            shares the row, after Collapse; on the rail it sits above it. */}
        {!narrow && (
          <Box
            sx={{
              mt: 'auto', position: 'sticky', bottom: 0, p: 1, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
              display: 'flex', flexDirection: rail ? 'column' : 'row', gap: 0.5,
            }}
          >
            {rail && <InstallNavButton rail />}
            <Tooltip title={rail ? navLabel : ''} placement="right">
              <ButtonBase
                onClick={toggleCollapsed}
                aria-label={navLabel}
                aria-expanded={!rail}
                sx={{
                  flex: rail ? 'none' : 1, minWidth: 0, borderRadius: 2, py: 1, px: rail ? 0 : 1.25, gap: 1.5, color: 'text.secondary',
                  justifyContent: rail ? 'center' : 'flex-start', '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {rail ? <KeyboardDoubleArrowRightIcon /> : <KeyboardDoubleArrowLeftIcon />}
                {!rail && <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>Collapse</Typography>}
              </ButtonBase>
            </Tooltip>
            {!rail && <InstallNavButton rail={false} />}
          </Box>
        )}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        {subbar && <Box sx={{ height: SUBBAR }} />}
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

        <CreateIssueDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      </Box>
    </Box>
  )
}
