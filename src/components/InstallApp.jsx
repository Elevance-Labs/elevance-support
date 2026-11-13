import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import InstallDesktopOutlinedIcon from '@mui/icons-material/InstallDesktopOutlined'
import InstallMobileOutlinedIcon from '@mui/icons-material/InstallMobileOutlined'
import { detectDevice, installGuide, installLabel } from '../lib/install'
import { useStandalone } from './useStandalone'
import { installState, listenForInstall, promptInstall, subscribeInstall } from '../pwa'

const APP_NAME = 'Elevance Support'
// Per app: each is installed on its own, though they share an origin.
const DISMISSED = 'el-support:install-dismissed'

/**
 * Whether to offer installing the app, and the way to do it here: the
 * browser's own install dialog when it has offered one, else the steps.
 */
function useInstall() {
  useEffect(listenForInstall, [])
  const { installed } = useSyncExternalStore(subscribeInstall, installState)
  const standalone = useStandalone()
  const device = useMemo(() => detectDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0), [])
  const [guiding, setGuiding] = useState(false)

  const install = async () => {
    // Turned down in the browser's dialog: that was the answer, no steps.
    if ((await promptInstall()) !== null) return
    setGuiding(true)
  }

  const dialog = guiding ? <InstallDialog device={device} onClose={() => setGuiding(false)} /> : null
  return { show: !standalone && !installed, device, install, dialog }
}

const iconFor = (device) => (device.mobile ? <InstallMobileOutlinedIcon /> : <InstallDesktopOutlinedIcon />)

/** How to install the app on this device, step by step. */
function InstallDialog({ device, onClose }) {
  const guide = installGuide(device, APP_NAME)
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="install-title">
      <DialogTitle id="install-title">{guide.title}</DialogTitle>
      <DialogContent>
        {guide.steps.length > 0 && (
          <>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              It then opens {device.mobile ? 'full screen from its own icon' : 'in its own window, with its own icon'}.
            </Typography>
            <Box component="ol" aria-label="Steps" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 1 }}>
              {guide.steps.map((step) => (
                <Typography key={step} component="li" variant="body2">{step}</Typography>
              ))}
            </Box>
          </>
        )}
        {guide.note && <Alert severity="info" sx={{ mt: guide.steps.length ? 2 : 0 }}>{guide.note}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Install, in the foot of the desktop navigation beside Collapse; an icon
 * above it when the navigation is a rail. Nothing once installed.
 */
export function InstallNavButton({ rail }) {
  const { show, device, install, dialog } = useInstall()
  if (!show) return null
  const label = installLabel(device)
  return (
    <>
      {!rail && <Divider orientation="vertical" flexItem sx={{ my: 0.75 }} />}
      <Tooltip title={rail ? label : ''} placement="right">
        <ButtonBase
          onClick={install}
          aria-label={label}
          sx={{
            flex: rail ? 'none' : 1, minWidth: 0, borderRadius: 2, py: 1, px: rail ? 0 : 1.25, gap: 1.5, color: 'text.secondary',
            justifyContent: rail ? 'center' : 'flex-start', '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {iconFor(device)}
          {!rail && <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>Install</Typography>}
        </ButtonBase>
      </Tooltip>
      {dialog}
    </>
  )
}

/**
 * The offer at the top of the phone navigation. Dismissed, it stays away in
 * this browser.
 */
export function InstallBanner() {
  const { show, device, install, dialog } = useInstall()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED) === '1'
    } catch {
      return false
    }
  })
  if (!show || dismissed) return dialog

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED, '1')
    } catch {
      // Storage can be refused (private windows); it then stays away for the visit.
    }
    setDismissed(true)
  }

  return (
    <Box
      role="region"
      aria-label="Install the app"
      sx={(t) => ({
        mx: 1.5, mt: 1.5, p: 1.5, borderRadius: 2, border: 1,
        borderColor: alpha(t.palette.primary.main, 0.3), bgcolor: alpha(t.palette.primary.main, 0.06),
      })}
    >
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
        <Box sx={{ color: 'primary.main', display: 'flex', pt: 0.25 }}>{iconFor(device)}</Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">Get the app</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {device.mobile
              ? `Add ${APP_NAME} to your home screen. It opens full screen, from its own icon.`
              : `Install ${APP_NAME}. It opens in its own window, with its own icon.`}
          </Typography>
        </Box>
        <IconButton size="small" aria-label="Dismiss" onClick={dismiss} sx={{ mt: -0.5, mr: -0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Button variant="contained" size="small" fullWidth onClick={install} sx={{ mt: 1.25 }}>
        {installLabel(device)}
      </Button>
      {dialog}
    </Box>
  )
}
