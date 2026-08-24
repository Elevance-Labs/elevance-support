import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Chip, LinearProgress, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useRefreshSignal } from '../context/RefreshContext'
import { formatDuration, formatDate } from '../lib/format'
import { slaBand } from '../lib/sla'
import {
  RANGES, UNSET, ageing, bucketUnit, countBy, decorate, inRange, needsAttention,
  openBySlaBand, rangeStart, slaByType, summarise, volumeSeries,
} from '../lib/reports'
import IssueDetail from '../components/IssueDetail'
import ChartCard, { NoData } from '../components/charts/ChartCard'
import BarChart from '../components/charts/BarChart'
import LineChart from '../components/charts/LineChart'
import StackedBar from '../components/charts/StackedBar'
import StatTile from '../components/charts/StatTile'
import Legend from '../components/charts/Legend'
import { ORDINAL, SERIES_1, SERIES_2, seriesColor } from '../components/charts/palette'
import { useProject } from '../context/ProjectContext'
import ProjectFilter, { NoProject } from '../components/ProjectFilter'
import { issueRef } from '../lib/projects'

/** Two-up on a wide screen, stacked on a narrow one. */
const cols = (n) => ({
  display: 'grid', gap: 2,
  gridTemplateColumns: { xs: '1fr', md: `repeat(${n}, minmax(0, 1fr))` },
})

export default function Report() {
  const { lists } = useConfig()
  const { signal } = useRefreshSignal()
  const { project, projectId, loading: projectsLoading } = useProject()

  const [issues, setIssues] = useState([])
  // One instant for the whole page, stamped when the data arrived: every
  // "as of now" number — ages, SLA clocks, the range boundary — agrees.
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState('30d')
  const [type, setType] = useState('')
  const [product, setProduct] = useState('')
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

  useEffect(() => { load() }, [load, signal])

  // The two joins every report needs: a status' type, and a request type's SLA target.
  const statusTypeByName = useMemo(
    () => Object.fromEntries((lists.status ?? []).map((s) => [s.name, s.status_type])),
    [lists.status],
  )
  const slaHoursByType = useMemo(
    () => Object.fromEntries((lists.type ?? []).map((t) => [t.name, t.sla_hours])),
    [lists.type],
  )

  const from = useMemo(
    () => rangeStart(RANGES.find((r) => r.key === range)?.days ?? null, now),
    [range, now],
  )

  // Every number on the page comes off these rows, so nothing can disagree.
  const rows = useMemo(() => {
    const decorated = decorate(issues, { statusTypeByName, slaHoursByType, now })
    return inRange(decorated, from)
      .filter((r) => (!type || r.type === type) && (!product || r.product === product))
  }, [issues, statusTypeByName, slaHoursByType, now, from, type, product])

  const stats = useMemo(() => summarise(rows), [rows])
  const open = useMemo(() => rows.filter((r) => !r.isClosed), [rows])

  // "All time" starts at the oldest ticket rather than an arbitrary date.
  const { volume, unit } = useMemo(() => {
    const start = from ?? Math.min(...rows.map((r) => r.submittedMs ?? now), now)
    const bucket = bucketUnit(start, now)
    return { volume: volumeSeries(rows, { from: start, to: now, unit: bucket }), unit: bucket }
  }, [rows, from, now])

  const byStatus = useMemo(() => {
    // Configured order, not count order — these are stages of a workflow.
    const counts = new Map()
    for (const r of open) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
    return (lists.status ?? [])
      .filter((s) => s.status_type !== 'closed')
      .map((s) => ({ name: s.name, value: counts.get(s.name) ?? 0 }))
      .filter((d) => d.value > 0)
  }, [open, lists.status])

  const byType = useMemo(() => countBy(rows, 'type'), [rows])
  const byProduct = useMemo(() => countBy(rows, 'product'), [rows])
  const byArea = useMemo(() => countBy(rows, 'area', { topN: 6 }), [rows])
  const ages = useMemo(
    () => ageing(rows, now).map((d, i) => ({ ...d, color: ORDINAL[i] })).filter((d) => d.value > 0),
    [rows, now],
  )

  // Colour follows the priority itself — its slot comes from the configured
  // list, so filtering the page never repaints the priorities that survive.
  const priorityMix = useMemo(() => {
    const slots = Object.fromEntries((lists.priority ?? []).map((p, i) => [p.name, seriesColor(i)]))
    return countBy(rows, 'priority')
      .map((d) => ({ ...d, color: slots[d.name] ?? '#9ca3af' }))
      .filter((d) => d.value > 0)
  }, [rows, lists.priority])

  const slaMix = useMemo(
    () => openBySlaBand(rows)
      .map((d) => {
        const band = slaBand({ state: d.state, isClosed: false })
        return { name: band.label, value: d.value, color: band.color }
      })
      .filter((d) => d.value > 0),
    [rows],
  )

  const typeTable = useMemo(() => slaByType(rows), [rows])
  const attention = useMemo(() => needsAttention(rows), [rows])

  const empty = !loading && rows.length === 0

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Typography variant="h5">Report</Typography>
        <ProjectFilter />
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {rows.length} ticket{rows.length === 1 ? '' : 's'} in view
        </Typography>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {!projectsLoading && !projectId && <NoProject />}

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <TextField select size="small" label="Range" value={range}
            onChange={(e) => setRange(e.target.value)} sx={{ minWidth: 160 }}>
            {RANGES.map((r) => <MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Type" value={type}
            onChange={(e) => setType(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All types</MenuItem>
            {(lists.type ?? []).map((t) => <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Product" value={product}
            onChange={(e) => setProduct(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All products</MenuItem>
            {(lists.product ?? []).map((p) => <MenuItem key={p.id} value={p.name}>{p.name}</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">
            Counted by submission date. Open counts are as of now, whatever the range.
          </Typography>
        </Stack>
      </Paper>

      {loading && <LinearProgress />}

      {/* Tiles wrap by their own width rather than a fixed column count, so five
          of them don't get squeezed on a laptop. */}
      <Box sx={{
        display: 'grid', gap: 2,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}>
        <StatTile label="Submitted" value={stats.total.toLocaleString()}
          caption={RANGES.find((r) => r.key === range)?.label.toLowerCase()} />
        <StatTile label="Still open" value={stats.open.toLocaleString()}
          caption={stats.openBreached ? `${stats.openBreached} past target` : 'none past target'}
          color={stats.openBreached ? '#c62828' : undefined} />
        <StatTile label="Closed" value={stats.closed.toLocaleString()}
          caption={stats.total ? `${Math.round((stats.closed / stats.total) * 100)}% of submitted` : '—'} />
        <StatTile label="Median time to close"
          value={stats.medianResolutionMs == null ? '—' : formatDuration(stats.medianResolutionMs)}
          caption={`${stats.closed} closed ticket${stats.closed === 1 ? '' : 's'}`} />
        <StatTile label="Met SLA"
          value={stats.slaMetPct == null ? '—' : `${stats.slaMetPct}%`}
          caption={stats.measured ? `of ${stats.measured} with a target` : 'no targets configured'}
          color={stats.slaMetPct != null && stats.slaMetPct < 90 ? '#ef6c00' : undefined} />
      </Box>

      <ChartCard
        title="Volume over time"
        subtitle={`Tickets submitted and closed per ${unit}`}
        action={<Legend items={[
          { label: 'Submitted', color: SERIES_1 },
          { label: 'Closed', color: SERIES_2 },
        ]} />}
      >
        {volume.length > 1 ? (
          <LineChart data={volume} unit={unit} series={[
            { key: 'submitted', label: 'Submitted', color: SERIES_1 },
            { key: 'closed', label: 'Closed', color: SERIES_2 },
          ]} />
        ) : <NoData height={220} />}
      </ChartCard>

      <Box sx={cols(2)}>
        <ChartCard title="Open tickets by status" subtitle="Where the current workload is sitting">
          {byStatus.length ? <BarChart data={byStatus} /> : <NoData message="Nothing open" />}
        </ChartCard>
        <ChartCard title="Tickets by request type" subtitle="Submitted in the selected range">
          {byType.length ? <BarChart data={byType} /> : <NoData />}
        </ChartCard>
      </Box>

      <Box sx={cols(2)}>
        <ChartCard title="Tickets by product" subtitle="Top products; the rest are grouped as Other">
          {byProduct.length ? <BarChart data={byProduct} /> : <NoData />}
        </ChartCard>
        <ChartCard title="Tickets by area" subtitle="Top areas; the rest are grouped as Other">
          {byArea.length ? <BarChart data={byArea} /> : <NoData />}
        </ChartCard>
      </Box>

      <Box sx={cols(2)}>
        <ChartCard title="Age of open tickets" subtitle="How long the open queue has been waiting">
          {ages.length ? <BarChart data={ages} tooltipLabel="Open tickets" />
            : <NoData message="Nothing open" />}
        </ChartCard>
        <Stack spacing={2}>
          <ChartCard title="Priority mix" subtitle="Share of tickets submitted in the range">
            {priorityMix.length ? <StackedBar data={priorityMix} /> : <NoData height={80} />}
          </ChartCard>
          <ChartCard title="SLA position of open tickets" subtitle="How much of the target each has used">
            {slaMix.length ? <StackedBar data={slaMix} unit="open tickets" />
              : <NoData height={80} message="Nothing open" />}
          </ChartCard>
        </Stack>
      </Box>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
          SLA performance by request type
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Met % counts every ticket of that type against its target — open ones included,
          since a ticket can breach before it is closed.
        </Typography>
        <Table size="small" sx={{ mt: 1.5 }}>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell align="right">Target</TableCell>
              <TableCell align="right">Tickets</TableCell>
              <TableCell align="right">Open</TableCell>
              <TableCell align="right">Closed</TableCell>
              <TableCell align="right">Breached</TableCell>
              <TableCell align="right">Met SLA</TableCell>
              <TableCell align="right">Median time to close</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {typeTable.map((t) => (
              <TableRow key={t.name} hover>
                <TableCell>{t.name}</TableCell>
                <TableCell align="right">
                  {t.targetMs == null ? '—' : formatDuration(t.targetMs)}
                </TableCell>
                <TableCell align="right">{t.total}</TableCell>
                <TableCell align="right">{t.open}</TableCell>
                <TableCell align="right">{t.closed}</TableCell>
                <TableCell align="right" sx={{ color: t.breached ? '#c62828' : 'inherit' }}>
                  {t.breached}
                </TableCell>
                <TableCell align="right">{t.metPct == null ? '—' : `${t.metPct}%`}</TableCell>
                <TableCell align="right">
                  {t.medianResolutionMs == null ? '—' : formatDuration(t.medianResolutionMs)}
                </TableCell>
              </TableRow>
            ))}
            {!typeTable.length && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.disabled">Nothing to report</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
          Closest to breaching
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Open tickets that have used the most of their target. Click one to open it.
        </Typography>
        <Table size="small" sx={{ mt: 1.5 }}>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell align="right">Consumed</TableCell>
              <TableCell align="right">SLA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {attention.map((r) => {
              const band = slaBand(r.sla)
              return (
                <TableRow key={r.id} hover sx={{ cursor: 'pointer' }}
                  onClick={() => setSelected(r.id)}>
                  <TableCell>{issueRef(project, r)}</TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Typography variant="body2" noWrap>{r.title}</Typography>
                  </TableCell>
                  <TableCell>{r.type || UNSET}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell>{formatDate(r.submitted_date)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={`${formatDuration(r.sla.elapsedMs)} of ${formatDuration(r.sla.targetMs)}`}>
                      <span>{Math.round(r.sla.ratio * 100)}%</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <Chip size="small" variant="outlined" label={band.label}
                      sx={{ color: band.color, borderColor: band.color, bgcolor: `${band.color}14` }} />
                  </TableCell>
                </TableRow>
              )
            })}
            {!attention.length && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.disabled">
                    {empty ? 'Nothing to report' : 'No open tickets with an SLA target'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <IssueDetail
        issueId={selected} open={Boolean(selected)}
        onClose={() => setSelected(null)} onSaved={load}
      />
    </Stack>
  )
}
