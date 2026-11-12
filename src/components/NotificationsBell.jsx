import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Avatar, Badge, Box, Button, Divider, IconButton, List, ListItemButton, Popover, Stack,
  Tooltip, Typography,
} from '@mui/material'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import EventNoteIcon from '@mui/icons-material/EventNoteOutlined'
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined'
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { useProject } from '../context/ProjectContext'
import { useNotifications } from '../context/NotificationsContext'
import { excerpt, notificationPath, notificationSentence } from '../lib/notifications'
import { pushPrompt, SNOOZE_MS } from '../lib/push'
import { ago } from '../lib/format'
import { displayName } from '../lib/users'
import UserAvatar from './UserAvatar'
import usePushDevice from './usePushDevice'

// Until when the offer to turn on device notifications was put off here.
const SNOOZE_KEY = 'el-support.push-offer-snoozed-until'
const readSnooze = () => {
  try { return Number(localStorage.getItem(SNOOZE_KEY)) || 0 } catch { return 0 }
}

/**
 * The header's bell: your latest notifications, newest first, unread ones
 * marked, live. Opening one goes to its ticket and marks it read; so does
 * opening the ticket any other way.
 *
 * While this device does not get notifications, the top of the list says so:
 * off (with Turn on), blocked (and how to allow them), or install first on an
 * iPhone in Safari. "Not now" puts that off for a week. A device that *had*
 * them and stopped — permission revoked, removed elsewhere, dropped by the
 * push service — says that instead, and no snooze hides it. Checked again
 * every time the list opens.
 */
export default function NotificationsBell() {
  const { items, unread, markRead, markAllRead } = useNotifications()
  const { users } = useConfig()
  const { projects } = useProject()
  const { profile } = useAuth()
  const push = usePushDevice(profile?.id)
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState(null)
  const [snoozedUntil, setSnoozedUntil] = useState(readSnooze)

  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const keyOf = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.key])), [projects])

  const open = (n) => {
    setAnchor(null)
    if (!n.read_at) markRead([n.id])
    const path = notificationPath(n)
    navigate(path ? `/${path}` : '/profile')
  }

  const snooze = () => {
    const until = Date.now() + SNOOZE_MS
    setSnoozedUntil(until)
    try { localStorage.setItem(SNOOZE_KEY, String(until)) } catch { /* this visit only */ }
  }

  const show = (e) => {
    setAnchor(e.currentTarget)
    push.refresh()
  }

  const prompt = pushPrompt(push.status, { device: push.device, wasOn: push.wasOn, snoozedUntil })
  const stopped = prompt?.kind === 'stopped'

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={show} aria-label={[
          'Notifications',
          unread ? `(${unread} unread)` : '',
          stopped ? '— stopped on this device' : '',
        ].filter(Boolean).join(' ')}>
          {/* The count when there is one; otherwise a dot if this device has
              stopped getting them, since that is only said inside. */}
          <Badge badgeContent={unread} color="error" max={99}
            {...(!unread && stopped ? { variant: 'dot', color: 'warning', badgeContent: 1 } : {})}>
            <NotificationsNoneOutlinedIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 400, maxWidth: 'calc(100vw - 16px)', maxHeight: '75vh' } } }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.25 }}>
          <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 600 }}>Notifications</Typography>
          <Button size="small" disabled={!unread} onClick={markAllRead}>Mark all read</Button>
        </Stack>
        <Divider />

        {prompt && (
          <Alert severity={prompt.severity} data-push-prompt={prompt.kind}
            icon={<NotificationsOffOutlinedIcon fontSize="small" />} sx={{ m: 1.5, mb: 0.5 }}>
            {prompt.text}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              {prompt.canEnable && (
                <Button variant="contained" size="small" disableElevation disabled={push.busy}
                  onClick={push.enable}>
                  {prompt.kind === 'stopped' ? 'Turn back on' : 'Turn on'}
                </Button>
              )}
              {/* A device that stopped is worth saying every time; an offer is not. */}
              {prompt.kind !== 'stopped' && (
                <Button size="small" color="inherit" onClick={snooze}>Not now</Button>
              )}
            </Stack>
          </Alert>
        )}
        {push.error && (
          <Alert severity="warning" onClose={push.clearError} sx={{ m: 1.5, mb: 0.5 }}>{push.error}</Alert>
        )}

        {!items.length && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            Nothing yet. You'll hear about tickets you're assigned, mentioned on or watching.
          </Typography>
        )}
        <List disablePadding aria-label="Notifications">
          {items.map((n) => {
            const actor = n.actor_id ? userById[n.actor_id] : null
            const ref = n.issue ? `${keyOf[n.issue.project_id] ?? ''}-${n.issue.number}` : null
            const quote = (n.kind === 'mentioned' || n.kind === 'commented') ? excerpt(n.comment?.body, 120) : ''
            return (
              <ListItemButton key={n.id} onClick={() => open(n)} data-unread={!n.read_at || undefined}
                sx={{ alignItems: 'flex-start', gap: 1.5, py: 1.25, bgcolor: n.read_at ? undefined : 'action.hover' }}>
                <Who notification={n} actor={actor} />
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: n.read_at ? 400 : 600 }}>
                    {notificationSentence(n, actor ? displayName(actor) : null)}
                  </Typography>
                  {n.issue && (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {ref} · {n.issue.title}
                    </Typography>
                  )}
                  {quote && (
                    <Typography variant="body2" color="text.secondary"
                      sx={{ fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                      “{quote}”
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">{ago(n.created_at)}</Typography>
                </Box>
                {!n.read_at && (
                  <Box aria-label="Unread"
                    sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mt: 1, flexShrink: 0 }} />
                )}
              </ListItemButton>
            )
          })}
        </List>
      </Popover>
    </>
  )
}

/** Who caused it: their photo, or what stands in when nobody did. */
function Who({ notification: n, actor }) {
  if (actor) return <UserAvatar user={actor} size={32} />
  const Icon = n.kind === 'email_received' ? MailOutlineIcon
    : n.kind === 'test' ? NotificationsActiveOutlinedIcon
    : EventNoteIcon // assigned with nobody behind it: the rota
  return (
    <Avatar sx={{ width: 32, height: 32, bgcolor: 'background.muted', color: 'text.secondary' }}>
      <Icon sx={{ fontSize: 18 }} />
    </Avatar>
  )
}
