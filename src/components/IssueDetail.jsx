import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, Divider, IconButton, Link, MenuItem,
  Paper, Stack, TextField, Tooltip, Typography, Autocomplete, CircularProgress,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import LockIcon from '@mui/icons-material/Lock'
import DescriptionIcon from '@mui/icons-material/Description'
import ImageIcon from '@mui/icons-material/Image'
import MovieIcon from '@mui/icons-material/Movie'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import LinkIcon from '@mui/icons-material/Link'
import CheckIcon from '@mui/icons-material/Check'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useAuth } from '../context/AuthContext'
import { formatDateTime } from '../lib/format'
import { can } from '../lib/permissions'
import { jiraKey, jiraUrl } from '../lib/jira'
import { copyText } from '../lib/publicLink'
import { issueRef, publicIssueUrl } from '../lib/projects'
import { useProject } from '../context/ProjectContext'
import { byDisplayName } from '../lib/users'
import {
  allowedStatuses, slaStatus, statusTypeOf, hasSeverity, slaHoursBySeverity,
} from '../lib/sla'
import StatusTimeline from './StatusTimeline'
import CommentsThread from './CommentsThread'
import { UserChip } from './UserAvatar'
import { StatusLabel } from './StatusDot'
import { SeverityOption, SeverityValue } from './SeverityOption'
import Tag from './Tag'

/**
 * Three-column ticket view:
 *   left   — submission, the request as it arrived, then how the team files it
 *   centre — assignee and status, the description, then the comment thread
 *   right  — status timeline and total elapsed time
 *
 * The left column draws the line this app cares about. "Request" is the
 * customer's account of their problem — type and priority, frozen as submitted
 * — plus the one judgement the team makes about how bad it is. "Details" is
 * everything the team decides for itself and may keep changing.
 */
export default function IssueDetail({ issueId, open, onClose, onSaved }) {
  const { lists, users, statuses, colorOf } = useConfig()
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

  // A ticket may only move within its status type or forward to a later one,
  // and it cannot start or pause until it has been triaged. The database
  // enforces both; restricting the dropdown just avoids offering a choice that
  // would be rejected.
  const severities = lists.severity ?? []
  const triaged = hasSeverity(issue?.severity)
  const statusOptions = issue
    ? allowedStatuses(lists.status ?? [], issue.status, events, { severity: issue.severity })
    : []
  const currentStatusType = issue ? statusTypeOf(lists.status ?? [], issue.status) : null
  // A New ticket is offered no New status, so the field is sitting on a value
  // its own menu does not list. Rather than hand the select a choice it can't
  // find, it holds nothing and draws the real status itself.
  const statusListed = statusOptions.some((st) => st.name === issue?.status)

  // Where the ticket is filed is the team's own reading, so anyone signed in may
  // correct it. What the request said about itself is not, and never changes.
  const canRefile = can.refile(profile)

  // The SLA target follows the severity, so an untriaged ticket is counting but
  // measured against nothing until someone says how bad it is.
  const sla = issue
    ? slaStatus({
        submittedAt: issue.submitted_date,
        closedAt: issue.closed_at,
        statusType: currentStatusType,
        slaHours: slaHoursBySeverity(severities)[issue.severity] ?? null,
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
      jira_ticket: jiraKey(issue.jira_ticket) || null,
      // Internal-only: the public form never sends one, and the database
      // refuses a severity from anyone who isn't signed in.
      ...(can.setSeverity(profile) ? { severity: issue.severity || null } : {}),
      // Where the team files it. `type` and `priority` are deliberately absent:
      // the database refuses a change to either, so sending them unchanged is
      // still the difference between a save and an error.
      ...(canRefile ? { product: issue.product, area: issue.area } : {}),
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
                  {/* How it reached us, and where from — the channel is set when
                      the ticket is logged and is a fact about the past, so it
                      reads rather than edits. */}
                  <Field label="Source" value={issue.source
                    ? <Tag value={issue.source} color={colorOf('source', issue.source)} />
                    : null} />
                  <Field label="Source URL" value={issue.source_url
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
                  <Tooltip title="Type and priority are recorded as the request was submitted and cannot be changed. The team's own reading of the ticket goes in Severity.">
                    <LockIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
                  </Tooltip>
                </Stack>
                <Stack spacing={2}>
                  <AsSubmitted label="Type"
                    value={issue.type} color={colorOf('type', issue.type)} />
                  <AsSubmitted label="Priority"
                    value={issue.priority} color={colorOf('priority', issue.priority)} />
                  {/* The open list carries each severity's behaviour — what the
                      team is committing to — and the closed field just the name,
                      which is the ticket's answer to that question. */}
                  <TextField select size="small" label="Severity" value={issue.severity ?? ''}
                    disabled={!can.setSeverity(profile)}
                    onChange={(e) => patch('severity', e.target.value)}
                    slotProps={{
                      select: {
                        // Not triaged is a value worth drawing, so the closed
                        // field renders it rather than showing an empty box.
                        displayEmpty: true,
                        renderValue: (name) => <SeverityValue severities={severities} name={name} />,
                      },
                      inputLabel: { shrink: true },
                    }}
                    error={!triaged}>
                    <MenuItem value=""><em>Not triaged</em></MenuItem>
                    {severities.filter((sv) => sv.is_active || sv.name === issue.severity).map((sv) => (
                      <MenuItem key={sv.id} value={sv.name}>
                        <SeverityOption item={sv} />
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Paper>
              <Paper sx={{ p: 2 }}>
                <Section>Details</Section>
                <Stack spacing={2}>
                  {/* Where the team files the ticket, which is a judgement that
                      improves as the ticket is understood — so it stays open all
                      the way to close. What arrived is safe either way: it is on
                      the row, and said below when the two no longer agree. */}
                  <TextField select size="small" label="Product" value={issue.product ?? ''}
                    disabled={!canRefile}
                    onChange={(e) => patch('product', e.target.value)}
                    helperText={refiledFrom(issue.submitted_product, issue.product)}>
                    {stillOffering(lists.product, issue.product).map((p) => (
                      <MenuItem key={p.id} value={p.name}>{p.name}</MenuItem>
                    ))}
                  </TextField>
                  <TextField select size="small" label="Area" value={issue.area ?? ''}
                    disabled={!canRefile}
                    onChange={(e) => patch('area', e.target.value)}
                    helperText={refiledFrom(issue.submitted_area, issue.area)}>
                    {stillOffering(lists.area, issue.area).map((a) => (
                      <MenuItem key={a.id} value={a.name}>{a.name}</MenuItem>
                    ))}
                  </TextField>
                  <Autocomplete multiple size="small"
                    options={(lists.labels ?? []).map((l) => l.name)}
                    value={issue.labels ?? []}
                    onChange={(_e, v) => patch('labels', v)}
                    renderInput={(p) => <TextField {...p} label="Labels" />} />
                  {/* A pasted Jira URL is reduced to its key — on blur so the
                      field doesn't fight the paste, and again on save. */}
                  <TextField size="small" label="Jira ticket" placeholder="ENG-1234 or a pasted Jira link"
                    value={issue.jira_ticket ?? ''}
                    onChange={(e) => patch('jira_ticket', e.target.value)}
                    onBlur={(e) => patch('jira_ticket', jiraKey(e.target.value))}
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
                <TextField select size="small" label="Status"
                  value={statusListed ? (issue.status ?? '') : ''}
                  onChange={(e) => patch('status', e.target.value)}
                  slotProps={{
                    // Same reason as the assignee field above: without this the
                    // closed field falls back to the option's plain text and
                    // drops the dot the open list just showed. It reads the
                    // ticket rather than the select, so a status the menu is
                    // withholding still shows as the one the ticket is in.
                    select: {
                      displayEmpty: true,
                      renderValue: () => (
                        <StatusLabel name={issue.status}
                          statusType={statusTypeOf(lists.status ?? [], issue.status)} />
                      ),
                    },
                    inputLabel: { shrink: true },
                  }}
                  helperText={
                    currentStatusType === 'closed' ? 'Closed — this ticket cannot be reopened'
                    : currentStatusType === 'paused' ? 'Paused — the SLA clock is stopped'
                    : !triaged ? 'Assign a severity to start or pause this ticket'
                    : currentStatusType === 'new' ? 'Still New — move it on, or close it'
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
                          icon={attachmentIcon(a.mime_type)}
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

/**
 * A request field as it was submitted: shown, never offered. The lock is on the
 * section header rather than on each row, so three fields don't carry three
 * identical explanations.
 */
const AsSubmitted = ({ label, value, color }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
      {label}
    </Typography>
    {value
      ? <Tag value={value} color={color} />
      : <Typography variant="body2" color="text.disabled">—</Typography>}
  </Box>
)

/**
 * What the request said, when the team has since filed it somewhere else. Said
 * under the field rather than beside it: the current value is the one being
 * worked, and the original is context for why it might look wrong.
 */
const refiledFrom = (submitted, current) =>
  submitted && submitted !== current ? `Submitted as ${submitted}` : undefined

/**
 * A list's options, with the ticket's own value kept among them even when the
 * configuration no longer offers it. These fields stay editable for the whole
 * life of a ticket, so a product retired years later must not make an old
 * ticket look unfiled.
 */
const stillOffering = (items = [], current) =>
  current && !items.some((i) => i.name === current)
    ? [{ id: `current:${current}`, name: current }, ...items]
    : items

const Field = ({ label, value }) => (
  <Stack direction="row" spacing={1}>
    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 88 }}>{label}</Typography>
    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{value || '—'}</Typography>
  </Stack>
)

// A PDF, a screen recording and a screenshot are three different things to open,
// so the chip says which before it is clicked.
function attachmentIcon(mime) {
  if (mime === 'application/pdf') return <DescriptionIcon />
  if (mime?.startsWith('video/')) return <MovieIcon />
  return <ImageIcon />
}
