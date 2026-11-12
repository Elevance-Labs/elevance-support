import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined'

const MODES = [
  { value: 'light', label: 'Light', icon: LightModeOutlinedIcon },
  { value: 'dark', label: 'Dark', icon: DarkModeOutlinedIcon },
  { value: 'system', label: 'System', icon: SettingsBrightnessOutlinedIcon },
]

/**
 * Light, dark or the device's own setting, in the account menu. Kept in this
 * browser under a key every Elevance app shares (see `THEME_MODE_KEY`).
 */
export default function ThemeModeSwitch() {
  const { mode, setMode } = useColorScheme()
  return (
    <Box sx={{ px: 2, py: 1 }}>
      <Typography id="theme-mode-label" variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
        Theme
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        aria-labelledby="theme-mode-label"
        value={mode ?? 'system'}
        onChange={(_, next) => next && setMode(next)}
      >
        {MODES.map(({ value, label, icon: Icon }) => (
          <ToggleButton key={value} value={value} sx={{ gap: 0.75, py: 0.5 }}>
            <Icon fontSize="small" />
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  )
}
