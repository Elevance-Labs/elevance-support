import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import {
  Alert, Avatar, Box, Chip, CircularProgress, Container, Divider, Link,
  Paper, Stack, Typography,
} from '@mui/material'
import DescriptionIcon from '@mui/icons-material/Description'
import ImageIcon from '@mui/icons-material/Image'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fetchPublicIssue } from '../lib/publicLink'
import { parseIssueRef } from '../lib/projects'
import { formatDateTime, initials, stringColor } from '../lib/format'
import { jiraUrl } from '../lib/jira'

function Splash() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <CircularProgress />
    </Box>
  )
}

/**
 * A ticket seen through its share link.
 *
 * Signed-in staff never see this page — the link hands them off to the issues
 * list with the usual editable dialog open, so there is one place where work
 * actually happens. Everyone else gets the read-only summary below: title,
 * description, attachments, company, Jira ticket and comments. Nothing about
 * status, priority, assignment or SLA belongs on a page a customer can open.
 */
export default function PublicIssue() {
  const { key, number } = useParams()
  const { session, loading: authLoading } = useAuth()
  // Only whether they're signed in matters here, and `session` is replaced on
  // every token refresh — depending on the object would refetch for no reason.
  const signedIn = Boolean(session)

  const [issueId, setIssueId] = useState(null)   // { id, project_id } for staff, who get redirected
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (authLoading) return

    ;(async () => {
      setLoading(true); setNotFound(false); setError('')
      const ref = parseIssueRef(key, number)
      if (!ref) { setNotFound(true); setLoading(false); return }

      try {
        if (signedIn) {
          // Resolve the key to a project first. RLS only returns projects this
          // person is a member of, so a link into a project they can't see dead-ends
          // here rather than at the ticket. The project travels with them so the
          // list they land on is filtered to it.
          const { data: proj } = await supabase
            .from('projects').select('id').eq('key', ref.key).maybeSingle()
          if (cancelled) return
          const { data: row } = proj
            ? await supabase.from('issues').select('id, project_id')
                .eq('project_id', proj.id).eq('number', ref.number).maybeSingle()
            : { data: null }
          if (cancelled) return
          if (row?.id) setIssueId(row)
          else setNotFound(true)
        } else {
          const payload = await fetchPublicIssue(ref.key, ref.number)
          if (cancelled) return
          if (payload) setData(payload)
          else setNotFound(true)
        }
      } catch (err) {
        if (!cancelled) setError(err.message ?? 'This link could not be opened.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [key, number, signedIn, authLoading])

  if (authLoading || loading) return <Splash />

  // Signed in: hand off to the real thing.
  if (issueId) {
    return <Navigate replace
      to={`/issues?issue=${issueId.id}&project=${issueId.project_id}`} />
  }

  if (notFound || error) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity={error ? 'error' : 'warning'}>
          {error || 'No such ticket. Check the link, or ask whoever shared it for the right one.'}
        </Alert>
      </Container>
    )
  }

  const { issue, project, attachments = [], comments = [] } = data
  const jira = jiraUrl(issue.jira_ticket)

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh', py: { xs: 3, md: 6 } }}>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {project?.name ? `${project.name} · ` : ''}
              {project?.key ? `${project.key}-${issue.number}` : `#${issue.number}`}
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.5 }}>{issue.title}</Typography>
            <Stack direction="row" sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              {issue.company && <Chip size="small" variant="outlined" label={issue.company} />}
              {issue.jira_ticket && (
                <Chip size="small" variant="outlined"
                  label={jira
                    ? <Link href={jira} target="_blank" rel="noopener" underline="hover"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        {issue.jira_ticket}
                        <OpenInNewIcon sx={{ fontSize: 12 }} />
                      </Link>
                    : issue.jira_ticket} />
              )}
              <Typography variant="caption" color="text.secondary">
                Submitted {formatDateTime(issue.submitted_date)}
              </Typography>
            </Stack>
          </Box>

          <Paper sx={{ p: 2.5 }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {issue.description || <em>No description provided.</em>}
            </Typography>

            {attachments.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {attachments.map((a) => (
                    <Chip key={a.id} variant="outlined" label={a.file_name}
                      icon={a.mime_type === 'application/pdf' ? <DescriptionIcon /> : <ImageIcon />}
                      component={a.url ? 'a' : 'div'} href={a.url ?? undefined}
                      target="_blank" rel="noopener"
                      clickable={Boolean(a.url)} disabled={!a.url} />
                  ))}
                </Stack>
              </>
            )}
          </Paper>

          <Stack spacing={1.5}>
            <Typography variant="subtitle2" color="text.secondary">
              Comments {comments.length > 0 && `(${comments.length})`}
            </Typography>
            {comments.length === 0 ? (
              <Typography variant="caption" color="text.disabled">No comments yet.</Typography>
            ) : comments.map((c) => (
              <Paper key={c.id} sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1.5}>
                  <Avatar sx={{
                    width: 30, height: 30, fontSize: 12, bgcolor: stringColor(c.author_name),
                  }}>
                    {initials(c.author_name)}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.author_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(c.created_at)}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                      {c.body}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Stack>

          <Typography variant="caption" color="text.disabled">
            This is a read-only view of a support ticket.
          </Typography>
        </Stack>
      </Container>
    </Box>
  )
}
