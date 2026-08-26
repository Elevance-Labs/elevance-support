import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, Divider, IconButton, Link, MenuItem,
  Paper, Stack, TextField, Tooltip, Typography, Autocomplete, CircularProgress,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import LockIcon from '@mui/icons-material/Lock'
import DescriptionIcon from '@mui/icons-material/Description'
import ImageIcon from '@mui/icons-material/Image'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import LinkIcon from '@mui/icons-material/Link'
import CheckIcon from '@mui/icons-material/Check'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useAuth } from '../context/AuthContext'
import { formatDateTime } from '../lib/format'
import { can } from '../lib/permissions'
import { jiraUrl } from '../lib/jira'
import { copyText } from '../lib/publicLink'
import { issueRef, publicIssueUrl } from '../lib/projects'
import { useProject } from '../context/ProjectContext'
import { byDisplayName } from '../lib/users'
import {
  allowedStatuses, canEditRequestFields, slaStatus, statusTypeOf, effectiveStatusType,
  STATUS_TYPE_LABELS,
} from '../lib/sla'
import StatusTimeline from './StatusTimeline'
import CommentsThread from './CommentsThread'
import { UserChip } from './UserAvatar'
import { StatusLabel } from './StatusDot'

/**
 * Three-column ticket view:
 *   left   — submission, request, then controls
 *   centre — assignee and status, the description, then the comment thread
 *   right  — status timeline and total elapsed time
 */
export default function IssueDetail({ issueId, open, onClose, onSaved }) {
  const { lists, users, statuses } = useConfig()
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const { profile } = useAuth()
  const { project } = useProject()
  const [issue, setIssue] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [events, setEvents] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!issueId) return
    setLoading(true); setError(''); setCopied(false)
    const [{ data: i }, { data: a }, { data: e }] = await Promise.all([
      supabase.from('issues').select('*').eq('id', issueId).single(),
      supabase.from('attachments').select('*').eq('issue_id', issueId),
      supabase.from('status_events').select('*').eq('issue_id', issueId).order('created_at'),
    ])
    setIssue(i); setAttachments(a ?? []); setEvents(e ?? [])
    setLoading(false)
  }, [issueId])

  useEffect(() => { if (open) load() }, [open, load])

  const patch = (field, value) => setIssue((i) => ({ ...i, [field]: value }))

  // A ticket may only move within its status type or forward to a later one.
  // The database enforces this too; restricting the dropdown just avoids
  // offering a choice that would be rejected.
  const statusOptions = issue ? allowedStatuses(lists.status ?? [], issue.status, events) : []
  const currentStatusType = issue ? statusTypeOf(lists.status ?? [], issue.status) : null
  // Pausing suspends a ticket rather than moving it, so the rules below follow
  // the status it was paused from.
  const effectiveType = issue
    ? effectiveStatusType(lists.status ?? [], issue.status, events)
    : null

  // Request fields are frozen once the ticket leaves a New status, and are only
  // ever editable by an admin or manager.
  const requestLocked = !canEditRequestFields(profile, lists.status ?? [], issue?.status, events)
  const requestLockReason =
    effectiveType && effectiveType !== 'new'
      ? `Request fields are locked once a ticket leaves a New status (currently ${STATUS_TYPE_LABELS[effectiveType]})`
      : 'Only an admin or manager can change the request fields'

  const sla = issue
    ? slaStatus({
        submittedAt: issue.submitted_date,
        closedAt: issue.closed_at,
        statusType: currentStatusType,
        slaHours: (lists.type ?? []).find((t) => t.name === issue.type)?.sla_hours ?? null,
        pausedMs: issue.paused_ms,
        pausedSince: issue.paused_since,
      })
    : null

  const save = async () => {
    setSaving(true); setError('')
    const { error } = await supabase.from('issues').update({
      status: issue.status,
      assignee_id: issue.assignee_id || null,
      labels: issue.labels ?? [],
      jira_ticket: issue.jira_ticket || null,
      priority: issue.priority,
      // Only send the request fields when they're actually editable — the
      // database rejects the update otherwise, even if the values are unchanged.
      ...(requestLocked ? {} : {
        type: issue.type,
        product: issue.product,
        area: issue.area,
      }),
    }).eq('id', issue.id)
    setSaving(false)
    if (error) return setError(error.message)
    await load()          // refresh so a status change shows on the timeline at once
    onSaved?.()
  }

  // The link is just the ticket reference: ACME-42 lives at /i/ACME/42, so
  // anyone can write one down from the ticket alone.
  const shareUrl = publicIssueUrl(project?.key, issue?.number)

  const copyLink = async () => {
    if (!shareUrl) return
    if (await copyText(shareUrl)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      // No Clipboard API (an insecure origin, usually) — show it to copy by hand.
      setError(`Copy this link: ${shareUrl}`)
    }
  }

  const openAttachment = async (path) => {
    // Private bucket — hand out a short-lived signed URL.
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 60)
    if (error) return setError(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const remove = async () => {
    if (!confirm('Delete this ticket permanently? This cannot be undone.')) return
    const { error } = await supabase.from('issues').delete().eq('id', issue.id)
    if (error) return setError(error.message)
    onSaved?.(); onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xl"
      slotProps={{ paper: { sx: { height: '92vh' } } }}>
      {loading || !issue ? (
        <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack sx={{ height: '100%' }}>
          {/* header */}
          <Stack direction="row" spacing={2} sx={{
            p: 2, alignItems: 'flex-start', borderBottom: '1px solid #e5e7eb',
          }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              {/* Project first, then the ticket's own identifier: which queue
                  this belongs to is the context for reading the number. */}
              <Typography variant="overline" color="text.secondary">
                {project?.name ? `${project.name} · ` : ''}{issueRef(project, issue)}
              </Typography>
              <Typography variant="h6">{issue.title}</Typography>
            </Box>
            <Tooltip title={copied ? 'Link copied' : 'Copy a public link to this ticket'}>
              <span>
                <IconButton onClick={copyLink} disabled={!shareUrl} aria-label="Copy public link">
                  {copied ? <CheckIcon color="success" /> : <LinkIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <Button variant="contained" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            {can.deleteIssue(profile) && (
              <Button color="error" onClick={remove}>Delete</Button>
            )}
            <IconButton onClick={onClose}><CloseIcon /></IconButton>
          </Stack>

          {error && <Alert severity="error" sx={{ m: 2, mb: 0 }} onClose={() => setError('')}>{error}</Alert>}

          {/* three columns */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '320px minmax(0, 1fr)', lg: '320px minmax(0, 1fr) 320px' },
            gap: 2, p: 2, overflowY: 'auto', flexGrow: 1, alignItems: 'start',
          }}>
            {/* ---------- left: details and controls ---------- */}
            <Stack spacing={2}>
              <Paper sx={{ p: 2 }}>
                <Section>Submission</Section>
                <Stack spacing={0.5}>
                  <Field label="Company"   value={issue.company} />
                  <Field label="Requester" value={issue.requester_name} />
                  <Field label="Email"     value={issue.requester_email} />
                  <Field label="Source" value={issue.source_url
                    ? <Link href={issue.source_url} target="_blank" rel="noopener">{issue.source_url}</Link>
                    : null} />
                  <Field label="Submitted" value={formatDateTime(issue.submitted_date)} />
                </Stack>
              </Paper>
              <Paper sx={{ p: 2 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mb: 1.5 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
                    Request
                  </Typography>
                  {requestLocked && (
                    <Tooltip title={requestLockReason}>
                      <LockIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
                    </Tooltip>
                  )}
                </Stack>
                <Stack spacing={2}>
                  <TextField select size="small" label="Type" value={issue.type ?? ''}
                    disabled={requestLocked}
                    onChange={(e) => patch('type', e.target.value)}>
                    {(lists.type ?? []).map((t) => (
                      <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>
                    ))}
                  </TextField>
                  <TextField select size="small" label="Product" value={issue.product ?? ''}
                    disabled={requestLocked}
                    onChange={(e) => patch('product', e.target.value)}>
                    {(lists.product ?? []).map((p) => (
                      <MenuItem key={p.id} value={p.name}>{p.name}</MenuItem>
                    ))}
                  </TextField>
                  <TextField select size="small" label="Area" value={issue.area ?? ''}
                    disabled={requestLocked}
                    onChange={(e) => patch('area', e.target.value)}>
                    {(lists.area ?? []).map((a) => (
                      <MenuItem key={a.id} value={a.name}>{a.name}</MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Paper>
              <Paper sx={{ p: 2 }}>
                <Section>Controls</Section>
                <Stack spacing={2}>
                  <TextField select size="small" label="Priority" value={issue.priority ?? ''}
                    onChange={(e) => patch('priority', e.target.value)}>
                    {(lists.priority ?? []).map((p) => (
                      <MenuItem key={p.id} value={p.name}>{p.name}</MenuItem>
                    ))}
                  </TextField>
                  <Autocomplete multiple size="small"
                    options={(lists.labels ?? []).map((l) => l.name)}
                    value={issue.labels ?? []}
                    onChange={(_e, v) => patch('labels', v)}
                    renderInput={(p) => <TextField {...p} label="Labels" />} />
                  <TextField size="small" label="Jira ticket" placeholder="ENG-1234"
                    value={issue.jira_ticket ?? ''}
                    onChange={(e) => patch('jira_ticket', e.target.value)}
                    helperText={jiraUrl(issue.jira_ticket)
                      && <Link href={jiraUrl(issue.jira_ticket)} target="_blank" rel="noopener">
                          Open in Jira <OpenInNewIcon sx={{ fontSize: 12, verticalAlign: 'middle' }} />
                        </Link>
                      } />
                </Stack>
              </Paper>            </Stack>

            {/* ---------- centre: assignment, description, comments ---------- */}
            <Stack spacing={2} sx={{ minWidth: 0 }}>
              {/* The two controls worked most often, side by side and up top. */}
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 2,
              }}>
                <TextField select size="small" label="Assignee" value={issue.assignee_id ?? ''}
                  onChange={(e) => patch('assignee_id', e.target.value)}
                  slotProps={{
                    // Without renderValue the closed field would fall back to the
                    // option's text and lose the face the open list just showed.
                    select: { renderValue: (id) => <UserChip user={userById[id]} size={22} /> },
                  }}>
                  <MenuItem value=""><em>Unassigned</em></MenuItem>
                  {users.filter((u) => u.is_active !== false).sort(byDisplayName).map((u) => (
                    <MenuItem key={u.id} value={u.id}>
                      <UserChip user={u} size={22} />
                    </MenuItem>
                  ))}
                </TextField>
                <TextField select size="small" label="Status" value={issue.status ?? ''}
                  onChange={(e) => patch('status', e.target.value)}
                  slotProps={{
                    // Same reason as the assignee field above: without this the
                    // closed field falls back to the option's plain text and
                    // drops the dot the open list just showed.
                    select: {
                      renderValue: (name) => (
                        <StatusLabel name={name} statusType={statusTypeOf(lists.status ?? [], name)} />
                      ),
                    },
                  }}
                  helperText={
                    currentStatusType === 'closed' ? 'Closed — this ticket cannot be reopened'
                    : currentStatusType === 'paused' ? 'Paused — the SLA clock is stopped'
                    : undefined}>
                  {statusOptions.map((st) => (
                    <MenuItem key={st.id} value={st.name}>
                      <StatusLabel name={st.name} statusType={st.status_type} />
                    </MenuItem>
                  ))}
                </TextField>
              </Box>

              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {issue.description || <em>No description provided.</em>}
                </Typography>

                {attachments.length > 0 && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                      {attachments.map((a) => (
                        <Chip key={a.id}
                          icon={a.mime_type === 'application/pdf' ? <DescriptionIcon /> : <ImageIcon />}
                          label={a.file_name} variant="outlined"
                          onClick={() => openAttachment(a.file_path)} />
                      ))}
                    </Stack>
                  </>
                )}
              </Paper>

              <CommentsThread issueId={issue.id} />
            </Stack>

            {/* ---------- right: status timeline ---------- */}
            <Box>
              <StatusTimeline
                statuses={statuses} events={events} users={users}
                currentStatus={issue.status} submittedAt={issue.submitted_date}
                closedAt={issue.closed_at} sla={sla}
              />
            </Box>
          </Box>
        </Stack>
      )}
    </Dialog>
  )
}

const Section = ({ children }) => (
  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>{children}</Typography>
)

const Field = ({ label, value }) => (
  <Stack direction="row" spacing={1}>
    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 88 }}>{label}</Typography>
    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{value || '—'}</Typography>
  </Stack>
)
