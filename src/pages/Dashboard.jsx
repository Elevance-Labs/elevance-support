import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { useProject } from '../context/ProjectContext'
import { useRefreshSignal } from '../context/RefreshContext'
import { formatDuration } from '../lib/format'
import { slaBand, slaHoursBySeverity, statusColor } from '../lib/sla'
import { decorate, UNTRIAGED } from '../lib/reports'
import { BREACHING_RATIO, breachingSla, breakdown, myIssues, notDone, summarise } from '../lib/dashboard'
import { displayName } from '../lib/users'
import Tag from '../components/Tag'
import IssueDetail from '../components/IssueDetail'
import { NoProject } from '../components/ProjectFilter'
import { AssigneeChip } from '../components/UserAvatar'
import ChartCard, { NoData } from '../components/charts/ChartCard'
import BarChart from '../components/charts/BarChart'
import StatTile from '../components/charts/StatTile'
import { CHART } from '../components/charts/palette'
import { issueRef } from '../lib/projects'
import { assigneesOf } from '../lib/assignees'

/** How many rows a list card shows before it says how many it is holding back. */
const LIST_LIMIT = 8

/** How an unassigned ticket reads in the assignee breakdown. */
const UNASSIGNED = 'Unassigned'

const PCT = `${Math.round(BREACHING_RATIO * 100)}%`

export default function Dashboard() {
  const { profile } = useAuth()
  const { lists, users, colorOf } = useConfig()
  const { project, projectId, loading: projectsLoading } = useProject()
  const { signal } = useRefreshSignal()

  const [issues, setIssues] = useState([])
  // One instant for the whole page, stamped when the data arrived, so every SLA
  // clock on it was read off the same wall.
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)

  const load = useCallback(async () => {
    if (!projectId) { setIssues([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('issues').select('*').eq('project_id', projectId)
      .order('submitted_date', { ascending: false })
    if (error) setError(error.message)
    setIssues(data ?? [])
    setNow(Date.now())
    setLoading(false)
  }, [projectId])

  // `signal` bumps when an issue is created from the header.
  useEffect(() => { load() }, [load, signal])

  // The two joins every SLA reading needs: a status' type, and a severity's target.
  const statusTypeByName = useMemo(
    () => Object.fromEntries((lists.status ?? []).map((s) => [s.name, s.status_type])),
    [lists.status],
  )
  const slaHours = useMemo(() => slaHoursBySeverity(lists.severity ?? []), [lists.severity])

  // Every number on the page comes off these rows, so nothing can disagree.
  const rows = useMemo(
    () => decorate(issues, { statusTypeByName, slaHoursBySeverity: slaHours, now }),
    [issues, statusTypeByName, slaHours, now],
  )

  const open = useMemo(() => notDone(rows), [rows])
  const stats = useMemo(() => summarise(rows, profile?.id), [rows, profile?.id])
  const mine = useMemo(() => myIssues(rows, profile?.id), [rows, profile?.id])
  const breaching = useMemo(() => breachingSla(rows), [rows])

  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])

  // An assignee we can't resolve to a profile is still somebody: "Unassigned"
  // is the one reading that would definitely be wrong, so it falls back to the
  // same "Unknown user" every other page shows.
  const assigneeNames = useCallback(
    (issue) => assigneesOf(issue).map((id) => displayName(userById[id])),
    [userById],
  )

  // Statuses read in the configured workflow order — they are the stages of a
  // process, and sorting them by size would shuffle the process.
  const byStatus = useMemo(() => {
    const order = (lists.status ?? []).filter((s) => s.status_type !== 'closed').map((s) => s.name)
    return breakdown(open, 'status', { order })
      .map((d) => ({ ...d, color: statusColor(lists.status ?? [], d.name) }))
  }, [open, lists.status])

  // Assignees are identities, not an order, and the bar length already carries
  // the size — so one colour for the whole series, per the palette's rules.
  //
  // A ticket on two people is counted against both: it is work on both their
  // plates, and showing it against one would understate the other. That is the
  // one breakdown on this page whose shares can add past 100%, which the card
  // says out loud rather than quietly rounding away.
  const byAssignee = useMemo(
    () => breakdown(open, assigneeNames, { unset: UNASSIGNED }),
    [open, assigneeNames],
  )
  const shared = useMemo(
    () => open.filter((r) => assigneesOf(r).length > 1).length,
    [open],
  )

  const bySeverity = useMemo(
    () => breakdown(open, 'severity', { unset: UNTRIAGED })
      // Untriaged is a gap, not a severity, so it stays grey rather than
      // borrowing a colour that would read as a judgement nobody has made.
      .map((d) => ({ ...d, color: d.name === UNTRIAGED ? CHART.muted : colorOf('severity', d.name) })),
    [open, colorOf],
  )

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Typography variant="h5">Dashboard</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {open.length} open ticket{open.length === 1 ? '' : 's'}
        </Typography>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {!projectsLoading && !projectId && <NoProject />}
      {loading && <LinearProgress />}

      {/* Tiles wrap by their own width rather than a fixed column count, so five
          of them don't get squeezed on a laptop. */}
      <Box sx={{
        display: 'grid', gap: 2,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}>
        <StatTile label="Open tickets" value={stats.open.toLocaleString()}
          caption={project ? project.name : 'in this project'} />
        <StatTile label="Assigned to me" value={stats.mine.toLocaleString()}
          caption={stats.mine ? 'still open' : 'nothing on your plate'} />
        <StatTile label={`Past ${PCT} of SLA`} value={stats.breaching.toLocaleString()}
          caption={stats.breached ? `${stats.breached} already breached` : 'none breached yet'}
          color={stats.breaching ? '#ef6c00' : undefined} />
        <StatTile label="Unassigned" value={stats.unassigned.toLocaleString()}
          caption="open, waiting for an owner" />
        <StatTile label="Not triaged" value={stats.untriaged.toLocaleString()}
          caption={stats.untriaged ? 'cannot be started yet' : 'everything has a severity'} />
      </Box>

      <Box sx={{
        display: 'grid', gap: 2,
        gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
      }}>
        <ListCard
          title="My issues"
          subtitle="Open tickets assigned to you, most of their target used first"
          rows={mine}
          empty={profile ? 'Nothing assigned to you is open.' : 'Sign in to see your tickets.'}
          columns={['Title', 'Severity', 'Elapsed']}
          renderRow={(r) => (
            <>
              <TitleCell project={project} issue={r} />
              <TableCell>
                {r.severity
                  ? <Tag value={r.severity} color={colorOf('severity', r.severity)} />
                  : <Typography variant="caption" color="text.disabled">Not triaged</Typography>}
              </TableCell>
              <ElapsedCell sla={r.sla} />
            </>
          )}
          onOpen={setSelected}
        />

        <ListCard
          title="Breaching SLA"
          subtitle={`Open tickets that have used ${PCT} or more of their target`}
          rows={breaching}
          empty="Nothing is close to its target."
          columns={['Title', 'Assignees', 'Consumed']}
          renderRow={(r) => (
            <>
              <TitleCell project={project} issue={r} />
              <TableCell>
                <AssigneeChip users={assigneesOf(r).map((id) => userById[id])} size={22} />
              </TableCell>
              <ConsumedCell sla={r.sla} />
            </>
          )}
          onOpen={setSelected}
        />
      </Box>

      <Box sx={{
        display: 'grid', gap: 2,
        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
      }}>
        <Breakdown title="By status" subtitle="Open tickets, in workflow order" data={byStatus} />
        <Breakdown title="By assignee"
          subtitle={shared
            ? `Who is holding the open work — ${shared} ticket${shared === 1 ? ' is' : 's are'} on two people, and counts for both`
            : 'Who is holding the open work'}
          data={byAssignee} />
        <Breakdown title="By severity" subtitle="What the open work has been judged to be"
          data={bySeverity} />
      </Box>

      <IssueDetail
        issueId={selected} open={Boolean(selected)}
        onClose={() => setSelected(null)} onSaved={load}
      />
    </Stack>
  )
}

/**
 * A list of tickets to act on. Capped rather than scrolled: a card that can
 * grow to forty rows stops being a dashboard, and the count in the footer says
 * what is being held back instead of hiding it.
 */
function ListCard({ title, subtitle, rows, columns, renderRow, empty, onOpen }) {
  const shown = rows.slice(0, LIST_LIMIT)
  const hidden = rows.length - shown.length

  return (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, flexGrow: 1 }}>{title}</Typography>
        <Chip size="small" label={rows.length} />
      </Stack>
      <Typography variant="caption" color="text.secondary">{subtitle}</Typography>

      <Table size="small" sx={{ mt: 1.5 }}>
        <TableHead>
          <TableRow>
            {columns.map((c, i) => (
              <TableCell key={c} align={i === columns.length - 1 ? 'right' : 'left'}>{c}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
              {renderRow(r)}
            </TableRow>
          ))}
          {!shown.length && (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <Typography variant="body2" color="text.disabled">{empty}</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {hidden > 0 && (
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
          {hidden} more not shown — see the Issues page.
        </Typography>
      )}
    </Paper>
  )
}

/** The ticket, named the way it is named everywhere else. */
function TitleCell({ project, issue }) {
  return (
    <TableCell sx={{ maxWidth: 280 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {issueRef(project, issue)}
      </Typography>
      <Typography variant="body2" noWrap>{issue.title}</Typography>
    </TableCell>
  )
}

/**
 * Time on the SLA clock — which is not time since submission: a pause stops it,
 * so the tooltip says what the number is measured against.
 */
function ElapsedCell({ sla }) {
  const band = slaBand(sla)
  const hasTarget = sla?.targetMs != null
  return (
    <TableCell align="right">
      <Tooltip title={hasTarget
        ? `${band.label} — ${Math.round(sla.ratio * 100)}% of a ${formatDuration(sla.targetMs)} target`
        : 'No target: this ticket has not been triaged'}>
        <Typography variant="body2" component="span"
          sx={{ color: hasTarget ? band.color : 'text.secondary', fontWeight: hasTarget ? 600 : 400 }}>
          {formatDuration(sla.elapsedMs)}
        </Typography>
      </Tooltip>
    </TableCell>
  )
}

/** How much of the target has gone, with the band it puts the ticket in. */
function ConsumedCell({ sla }) {
  const band = slaBand(sla)
  return (
    <TableCell align="right">
      <Tooltip title={`${formatDuration(sla.elapsedMs)} of ${formatDuration(sla.targetMs)}`}>
        <Chip size="small" variant="outlined" label={`${Math.round(sla.ratio * 100)}%`}
          sx={{ color: band.color, borderColor: band.color, bgcolor: `${band.color}14` }} />
      </Tooltip>
    </TableCell>
  )
}

/**
 * A breakdown reads two ways — how many, and how much of the whole — so every
 * bar carries both. The share comes off the datum rather than being recomputed
 * here, so the label and the tile can't round differently.
 */
function Breakdown({ title, subtitle, data }) {
  const share = new Map(data.map((d) => [d.value, d.pct]))
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {data.length
        ? <BarChart data={data} tooltipLabel="Open tickets" valueWidth={72}
            formatValue={(v) => `${v} · ${share.get(v)}%`} />
        : <NoData height={120} message="Nothing open" />}
    </ChartCard>
  )
}
