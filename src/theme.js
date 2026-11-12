import { createTheme } from '@mui/material/styles'

// The same look as the other Elevance apps (People, Work): colour, type,
// corners, buttons and table headings match theirs, so moving between the
// apps does not feel like changing product. Change one, change all three.

/**
 * Where the theme choice (light / dark / system) is kept. One key for every
 * Elevance app: they share an origin, so a choice made in one holds in the
 * next, as the collapsed navigation does.
 */
export const THEME_MODE_KEY = 'elevance.theme'

/** The ThemeProvider's settings beside `theme` (App.jsx and the tests). */
export const themeSettings = {
  defaultMode: 'system',
  modeStorageKey: THEME_MODE_KEY,
  colorSchemeStorageKey: 'elevance.theme-scheme',
  // Read the saved choice on the first render: no flash of the other mode.
  noSsr: true,
  disableTransitionOnChange: true,
}

// `subtle`: a quiet, opaque tint for headers and bands set off from paper;
// `muted`: a stronger one, for board columns and image wells.
const light = {
  primary: { main: '#3f51b5' },
  background: { default: '#f6f7fb', paper: '#ffffff', subtle: '#fafafa', muted: '#f1f3f5' },
}

const dark = {
  // Indigo lifted so it reads on a dark surface (and keeps white text).
  primary: { main: '#7986cb' },
  background: { default: '#121318', paper: '#1b1d23', subtle: '#22242b', muted: '#282a32' },
}

const base = {
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: ({ theme: t }) => ({ border: `1px solid ${t.palette.divider}` }) },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme: t }) => ({
          fontWeight: 600,
          color: t.palette.text.secondary,
          backgroundColor: t.palette.background.subtle,
        }),
      },
    },
    MuiTab: { styleOverrides: { root: { minHeight: 44, textTransform: 'none', fontWeight: 600 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 } } },
  },
}

// Light and dark, switched without CSS variables: `theme.palette` is the one
// in use, so code that reads it (charts, `alpha`) follows the mode.
export const theme = createTheme({ ...base, colorSchemes: { light: { palette: light }, dark: { palette: dark } } })

/** Always light: the intake form sits inside other people's pages. */
export const lightTheme = createTheme({ ...base, palette: light })
