import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Avatar, Box, Card, CardContent, Chip, InputAdornment, Link, MenuItem,
  Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import ScheduleIcon from '@mui/icons-material/Schedule'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import LockClockIcon from '@mui/icons-material/LockClock'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useRefreshSignal } from '../context/RefreshContext'
import { elapsed, initials } from '../lib/format'
import Tag from '../components/Tag'
import IssueDetail from '../components/IssueDetail'
import { jiraUrl } from '../lib/jira'
import { byDisplayName, displayName } from '../lib/users'
import { slaStatus, slaBand, STATUS_TYPE_COLORS } from '../lib/sla'
import { useProject } from '../context/ProjectContext'
import ProjectFilter, { NoProject } from '../components/ProjectFilter'
import { issueRef } from '../lib/projects'

/** "3d", "5h", "12m" from a millisecond span. */
function compactDuration(ms) {
  const mins = Math.floor(ms / 60_000)
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d`
  if (mins >= 60) return `${Math.floor(mins / 60)}h`
  return `${mins}m`
}

function slaTooltip(sla) {
  if (!sla || sla.state === 'none') return 'Time since submission'
  const pct = Math.round((sla.ratio ?? 0) * 100)
  const target = compactDuration(sla.targetMs)
  if (sla.state === 'breached') {
    return `SLA breached — ${compactDuration(sla.overdueMs)} past the ${target} target`
  }
  return `${slaBand(sla).label} — ${pct}% of the ${target} target`
}

export default function Board() {
  const { lists, users, statuses, colorOf } = useConfig()
  const { signal } = useRefreshSignal()
  const { project, projectId, loading: projectsLoading } = useProject()
  const [issues, setIssues] = useState([])
  const [attachmentCounts, setAttachmentCounts] = useState({})
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [assignee, setAssignee] = useState('')
  const [type, setType] = useState('')
  const [dragging, setDragging] = useState(null)

  const load = useCallback(async () => {
    if (!projectId) { setIssues([]); return }
    const { data, error } = await supabase
      .from('issues').select('*').eq('project_id', projectId)
      .order('submitted_date', { ascending: false })
    if (error) setError(error.message)
    const rows = data ?? []
    setIssues(rows)
    const { data: atts } = await supabase.from('attachments')
      .select('issue_id').in('issue_id', rows.map((i) => i.id))
    const counts = {}
    for (const a of atts ?? []) counts[a.issue_id] = (counts[a.issue_id] ?? 0) + 1
    setAttachmentCounts(counts)
  }, [projectId])

  // `signal` bumps when an issue is created from the header.
  useEffect(() => { load() }, [load, signal])

  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])

  // SLA target comes from the ticket's type; the clock stops at a closed status.
  const slaHoursByType = useMemo(
    () => Object.fromEntries((lists.type ?? []).map((t) => [t.name, t.sla_hours])),
    [lists.type],
  )
  const statusTypeByName = useMemo(
    () => Object.fromEntries((lists.status ?? []).map((s) => [s.name, s.status_type])),
    [lists.status],
  )
  const slaFor = (issue) => slaStatus({
    submittedAt: issue.submitted_date,
    closedAt: issue.closed_at,
    statusType: statusTypeByName[issue.status] ?? null,
    slaHours: slaHoursByType[issue.type] ?? null,
    pausedMs: issue.paused_ms,
    pausedSince: issue.paused_since,
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return issues.filter((i) => {
      if (type && i.type !== type) return false
      if (assignee) {
        if (assignee === 'unassigned' ? i.assignee_id : i.assignee_id !== assignee) return false
      }
      if (q && ![i.title, i.company, i.requester_name, i.jira_ticket, issueRef(project, i)]
        .join(' ').toLowerCase().includes(q)) return false
      return true
    })
  }, [issues, search, assignee, type, project])

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(statuses.map((s) => [s.name, []]))
    for (const i of filtered) (map[i.status] ??= []).push(i)
    return map
  }, [filtered, statuses])

  // Drag a card to another lane to change its status.
  const drop = async (status) => {
    const id = dragging
    setDragging(null)
    if (!id) return
    const issue = issues.find((i) => i.id === id)
    if (!issue || issue.status === status) return
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i))) // optimistic
    const { error } = await supabase.from('issues').update({ status }).eq('id', id)
    if (error) { setError(error.message); load() }
  }

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Typography variant="h5">Board</Typography>
        <ProjectFilter />
      </Stack>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {!projectsLoading && !projectId && <NoProject />}

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
          <TextField
            size="small" placeholder="Search…" value={search}
            onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 240 }}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              },
            }}
          />
          <TextField select size="small" label="Assignee" value={assignee}
            onChange={(e) => setAssignee(e.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="unassigned"><em>Unassigned</em></MenuItem>
            {[...users].sort(byDisplayName).map((u) => (
              <MenuItem key={u.id} value={u.id}>{displayName(u)}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Type" value={type}
            onChange={(e) => setType(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">All</MenuItem>
            {(lists.type ?? []).map((t) => <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>)}
          </TextField>
        </Stack>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', height: '100%', pb: 2, alignItems: 'flex-start' }}>
        {statuses.map((s) => (
          <Paper
            key={s.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(s.name)}
            sx={{ width: 300, flexShrink: 0, bgcolor: '#f1f3f5', p: 1.5, maxHeight: '72vh', overflowY: 'auto' }}
          >
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, px: 0.5, alignItems: 'center' }}>
              <Box sx={{
                width: 8, height: 8, borderRadius: '50%',
                bgcolor: STATUS_TYPE_COLORS[s.status_type] ?? '#9ca3af',
              }} />
              <Typography variant="subtitle2">{s.name}</Typography>
              <Chip size="small" label={(byStatus[s.name] ?? []).length} />
            </Stack>
            <Stack spacing={1}>
              {(byStatus[s.name] ?? []).map((issue) => (
                <BoardCard
                  key={issue.id} issue={issue}
                  assignee={userById[issue.assignee_id]}
                  attachments={attachmentCounts[issue.id] ?? 0}
                  typeColor={colorOf('type', issue.type)}
                  colorOf={colorOf}
                  sla={slaFor(issue)}
                  onOpen={() => setSelected(issue.id)}
                  onDragStart={() => setDragging(issue.id)}
                />
              ))}
              {(byStatus[s.name] ?? []).length === 0 && (
                <Typography variant="caption" color="text.disabled" sx={{ px: 0.5 }}>
                  Nothing here.
                </Typography>
              )}
            </Stack>
          </Paper>
        ))}
      </Box>

      <IssueDetail
        issueId={selected} open={Boolean(selected)}
        onClose={() => setSelected(null)} onSaved={load}
      />
    </Stack>
  )
}

function BoardCard({ issue, assignee, attachments, typeColor, colorOf, sla, onOpen, onDragStart }) {
  const link = jiraUrl(issue.jira_ticket)
  const breached = sla?.state === 'breached'
  const hasSla = sla && sla.state !== 'none'
  // Card edge carries the SLA band colour: blue, yellow, orange, red.
  const band = hasSla ? slaBand(sla) : null

  return (
    <Card
      draggable onDragStart={onDragStart} onClick={onOpen}
      sx={{
        cursor: 'pointer',
        borderLeft: band ? '4px solid' : undefined,
        borderLeftColor: band?.color,
        '&:hover': { borderColor: band?.color ?? 'primary.main' },
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>{issue.title}</Typography>

        <Stack direction="row" sx={{ mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
          <Tag value={issue.type} color={typeColor} />
          {(issue.labels ?? []).map((l) => (
            <Tag key={l} value={l} color={colorOf('labels', l)} variant="outlined" />
          ))}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {assignee ? (
            <Tooltip title={displayName(assignee)}>
              <Avatar sx={{ width: 22, height: 22, fontSize: 10, bgcolor: 'primary.main' }}>
                {initials(displayName(assignee))}
              </Avatar>
            </Tooltip>
          ) : (
            <Avatar sx={{ width: 22, height: 22, fontSize: 10, bgcolor: 'grey.300' }}>?</Avatar>
          )}

          {attachments > 0 && (
            <Tooltip title={`${attachments} attachment(s)`}>
              <AttachFileIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
            </Tooltip>
          )}

          {issue.jira_ticket && (
            link ? (
              <Link
                href={link} target="_blank" rel="noopener"
                onClick={(e) => e.stopPropagation()}
                variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}
              >
                {issue.jira_ticket}
                <OpenInNewIcon sx={{ fontSize: 11 }} />
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">{issue.jira_ticket}</Typography>
            )
          )}

          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title={slaTooltip(sla)}>
            <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
              {sla?.isClosed
                ? <LockClockIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                : breached
                  ? <WarningAmberIcon sx={{ fontSize: 13, color: band.color }} />
                  : <ScheduleIcon sx={{ fontSize: 13, color: band?.color ?? 'text.disabled' }} />}
              <Typography variant="caption"
                sx={{
                  fontWeight: breached ? 700 : 400,
                  color: band?.color ?? 'text.secondary',
                }}>
                {sla ? compactDuration(sla.elapsedMs) : elapsed(issue.submitted_date)}
              </Typography>
            </Stack>
          </Tooltip>
        </Stack>
      </CardContent>
    </Card>
  )
}
