import { createTheme } from '@mui/material/styles'

// The same look as the other Elevance apps (People, Work): colour, type,
// corners, buttons and table headings match theirs, so moving between the
// apps does not feel like changing product. Change one, change all three.
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#3f51b5' },
    background: { default: '#f6f7fb', paper: '#ffffff' },
  },
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
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #e5e7eb' } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme: t }) => ({
          fontWeight: 600,
          color: t.palette.text.secondary,
          backgroundColor: t.palette.grey[50],
        }),
      },
    },
    MuiTab: { styleOverrides: { root: { minHeight: 44, textTransform: 'none', fontWeight: 600 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 } } },
  },
})
