import { useState } from 'react'
import {
  Avatar, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Popover, Tooltip, Typography,
} from '@mui/material'
import AppsIcon from '@mui/icons-material/Apps'
import GroupsIcon from '@mui/icons-material/Groups'
import SupportAgentIcon from '@mui/icons-material/SupportAgent'
import WorkspacesIcon from '@mui/icons-material/Workspaces'
import { googleDomain } from '../lib/signin'
import { suiteLinks, switchUrl } from '../lib/suite'

const LOOK = {
  work: { icon: WorkspacesIcon, color: '#3f51b5' },
  support: { icon: SupportAgentIcon, color: '#2563eb' },
  people: { icon: GroupsIcon, color: '#00796b' },
}

// A build may place an app somewhere other than the sibling folder.
const OVERRIDES = {
  work: import.meta.env.VITE_SUITE_WORK_URL,
  support: import.meta.env.VITE_SUITE_SUPPORT_URL,
  people: import.meta.env.VITE_SUITE_PEOPLE_URL,
}

/**
 * The grid icon at the top left: the way from this app to its siblings.
 *
 * Each entry is a plain link that carries the signed-in person's company
 * email, so the app it opens can sign them in through Google without asking
 * (see `lib/suite`). The app you are in is listed, marked, and goes nowhere.
 */
export default function AppSwitcher({ current, email }) {
  const [anchor, setAnchor] = useState(null)
  const base = new URL(import.meta.env.BASE_URL, window.location.href).href
  const links = suiteLinks(current, base, OVERRIDES)

  return (
    <>
      <Tooltip title="Switch app">
        <IconButton aria-label="Switch app" aria-haspopup="true" onClick={(e) => setAnchor(e.currentTarget)}>
          <AppsIcon />
        </IconButton>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 300, maxWidth: 'calc(100vw - 32px)', p: 1, mt: 0.5 } } }}
      >
        <Typography variant="overline" sx={{ px: 1.5, color: 'text.secondary' }}>
          Elevance apps
        </Typography>
        <List disablePadding aria-label="Elevance apps">
          {links.map((app) => {
            const Icon = LOOK[app.id].icon
            return (
              <ListItemButton
                key={app.id}
                component={app.current ? 'div' : 'a'}
                href={app.current ? undefined : switchUrl(app.url, email, googleDomain())}
                selected={app.current}
                aria-current={app.current ? 'page' : undefined}
                onClick={() => setAnchor(null)}
                sx={{ borderRadius: 2, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 52 }}>
                  <Avatar variant="rounded" sx={{ width: 36, height: 36, bgcolor: LOOK[app.id].color }}>
                    <Icon sx={{ fontSize: 22 }} />
                  </Avatar>
                </ListItemIcon>
                <ListItemText primary={app.name} secondary={app.current ? 'You are here' : app.description} />
              </ListItemButton>
            )
          })}
        </List>
      </Popover>
    </>
  )
}
