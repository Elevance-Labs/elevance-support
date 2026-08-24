import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material'
import { theme } from './theme'
import { AuthProvider, useAuth } from './context/AuthContext'
import { can } from './lib/permissions'
import { ConfigProvider } from './context/ConfigContext'
import { ProjectProvider } from './context/ProjectContext'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import Issues from './pages/Issues'
import Board from './pages/Board'
import Report from './pages/Report'
import Projects from './pages/Projects'
import Users from './pages/Users'
import Configuration from './pages/Configuration'
import EmbedForm from './pages/EmbedForm'
import PublicIssue from './pages/PublicIssue'

function Splash() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <CircularProgress />
    </Box>
  )
}

/**
 * `require` is a predicate from src/lib/permissions.js. Exported so the guard
 * on a page can be tested directly — the rule being right is worth nothing if
 * the route isn't actually wearing it.
 */
export function Protected({ require: requires, children }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" replace />
  if (requires && !requires(profile)) return <Navigate to="/issues" replace />
  return children
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public, embeddable intake form — no auth, no chrome. One per
                project: the key in the path decides which project the request
                is filed against. */}
            <Route
              path="/embed/:key/form"
              element={
                <ConfigProvider withUsers={false}>
                  <EmbedForm />
                </ConfigProvider>
              }
            />
            {/* Share link. Signed-in staff are redirected to the editable view. */}
            <Route path="/i/:key/:number" element={<PublicIssue />} />
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <Protected>
                  <ConfigProvider>
                    <ProjectProvider>
                      <AppLayout />
                    </ProjectProvider>
                  </ConfigProvider>
                </Protected>
              }
            >
              <Route path="/issues" element={<Issues />} />
              <Route path="/board" element={<Board />} />
              <Route path="/report" element={<Protected require={can.seeReports}><Report /></Protected>} />
              <Route path="/projects" element={<Protected require={can.seeProjects}><Projects /></Protected>} />
              <Route path="/users" element={<Protected require={can.seeUsers}><Users /></Protected>} />
              <Route path="/config" element={<Protected require={can.seeConfig}><Configuration /></Protected>} />
            </Route>
            <Route path="*" element={<Navigate to="/issues" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
