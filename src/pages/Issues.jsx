import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, MenuItem, Paper, Stack, TextField, Tooltip,
  Typography, Chip, Autocomplete, Collapse, useMediaQuery,
} from '@mui/material'
import FilterListIcon from '@mui/icons-material/FilterList'
import { DataGrid } from '@mui/x-data-grid'
import { useSearchParams } from 'react-router-dom'
import SearchIcon from '@mui/icons-material/Search'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ClearIcon from '@mui/icons-material/Clear'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useRefreshSignal } from '../context/RefreshContext'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'
import { formatDuration, formatDate, toMillis } from '../lib/format'
import Tag from '../components/Tag'
import IssueDetail from '../components/IssueDetail'
import { AssigneeChip, UserChip } from '../components/UserAvatar'
import { byDisplayName, displayName } from '../lib/users'
import { slaStatus, slaBand, statusColor, slaHoursBySeverity } from '../lib/sla'
import { useProject } from '../context/ProjectContext'
import { NoProject } from '../components/ProjectFilter'
import { issueRef } from '../lib/projects'
import { companyOptions } from '../lib/companies'
import { assigneesOf, hasAssignees } from '../lib/assignees'
import { DEFAULT_GROUP_BY, GROUP_BY, groupIssues, isGroupBy } from '../lib/grouping'

// `resolvedWithin` hides tickets closed longer ago than this many days; '' is
// "no limit". Only closed tickets are ever affected — open work always shows.
const RESOLVED_WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '', label: 'All time' },
]

// `assignee_id` is singular on purpose, though it now filters against the
// ticket's whole set: these keys are what a saved view stores, and renaming one
// would silently drop that filter from every view already saved.
//
// Every dropdown filter holds a list, and several picks widen it: a ticket
// matching any of them shows. Views saved when each held one value carry a
// string, so `readFilters` lifts it into a list of one.
const MULTI = ['status', 'type', 'priority', 'severity', 'assignee_id', 'product', 'company', 'labels']
const EMPTY_FILTERS = {
  search: '', status: [], type: [], priority: [], severity: [], assignee_id: [],
  product: [], company: [], labels: [], resolvedWithin: '7',
}
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : [])
const readFilters = (saved) => {
  const f = { ...EMPTY_FILTERS, ...saved }
  MULTI.forEach((k) => { f[k] = asList(f[k]) })
  return f
}
// An empty pick is no filter at all.
const allows = (picked, value) => !picked.length || picked.includes(value)

// A filter counts as applied when it differs from its empty value; `labels` is
// a list, so an empty one is as unapplied as an empty string.
const isApplied = (key, value) => (Array.isArray(value)
  ? value.length > 0
  : Boolean(value) && value !== EMPTY_FILTERS[key])

// How the list is grouped is a per-person convenience, so it is remembered in
// this browser rather than in a saved view.
const GROUP_KEY = 'issues.groupBy'
const readGroupBy = () => {
  try {
    const v = localStorage.getItem(GROUP_KEY)
    return isGroupBy(v) ? v : DEFAULT_GROUP_BY
  } catch { return DEFAULT_GROUP_BY }
}

const compare = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true })
}

export default function Issues() {
  const { lists, users, companies, colorOf } = useConfig()
  const { profile } = useAuth()
  const { signal } = useRefreshSignal()
  const { project, projectId, projects, setProjectId, loading: projectsLoading } = useProject()

  const [rows, setRows] = useState([])
  const [attachmentCounts, setAttachmentCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [views, setViews] = useState([])
  const [activeView, setActiveView] = useState('')
  const [viewDialog, setViewDialog] = useState(null) // { mode: 'create'|'rename', id?, name }
  const [groupBy, setGroupBy] = useState(readGroupBy)
  const [collapsed, setCollapsed] = useState(() => new Set())
  // Sorting is done here rather than by the grid, so that it sorts within each
  // group instead of shuffling tickets out from under their headings.
  const [sortModel, setSortModel] = useState([])
  // The resolved-window cutoff is pinned to the last load, so a re-render never
  // silently drops a row the user is looking at.
  const [loadedAt, setLoadedAt] = useState(() => Date.now())

  // Which ticket is open lives in the URL, so a share link can hand a signed-in
  // user straight to it. Both transitions replace rather than push: the dialog
  // is a detail of this page, not a place of its own to go Back to.
  const [params, setParams] = useSearchParams()
  const selected = params.get('issue')

  // A share link hands a signed-in user here with the ticket's project in tow,
  // so opening someone else's link doesn't leave the page filtered to whatever
  // was last selected — the ticket simply wouldn't be in the list.
  const wantedProject = params.get('project')
  useEffect(() => {
    if (!wantedProject) return
    if (projects.some((p) => p.id === wantedProject)) setProjectId(wantedProject)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('project')
      return next
    }, { replace: true })
  }, [wantedProject, projects, setProjectId, setParams])
  // The order the dialog's arrows step through: the list as it was drawn when a
  // row was opened — its sort, filters and groups, across every page, folded
  // groups included. Pinned then, so a save that re-sorts the list or drops the
  // ticket from a filter doesn't reshuffle it under the arrows. A ticket opened
  // from a link has no snapshot and steps through the list as it stands.
  const [navIds, setNavIds] = useState(null)
  const openIssue = (id) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.set('issue', id)
    return next
  }, { replace: true })
  const closeIssue = () => {
    setNavIds(null)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('issue')
      return next
    }, { replace: true })
  }

  // Every read is scoped to the selected project. Row level security says the
  // same thing, but asking for one project's tickets is also simply what the
  // page is showing.
  const load = useCallback(async () => {
    if (!projectId) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('issues').select('*').eq('project_id', projectId)
      .order('submitted_date', { ascending: false })
    if (error) setError(error.message)
    const issues = data ?? []
    setRows(issues)
    setLoadedAt(Date.now())

    const { data: atts } = await supabase.from('attachments')
      .select('issue_id').in('issue_id', issues.map((i) => i.id))
    const counts = {}
    for (const a of atts ?? []) counts[a.issue_id] = (counts[a.issue_id] ?? 0) + 1
    setAttachmentCounts(counts)
    setLoading(false)
  }, [projectId])

  const loadViews = useCallback(async () => {
    const { data } = await supabase.from('views').select('*').order('name')
    setViews(data ?? [])
  }, [])

  // `signal` bumps when an issue is created from the header.
  useEffect(() => { load(); loadViews() }, [load, loadViews, signal])

  // SLA target comes from the ticket's severity; the clock stops at a closed
  // status. An untriaged ticket has no target yet, and reads as "—".
  const slaHours = useMemo(() => slaHoursBySeverity(lists.severity ?? []), [lists.severity])
  const statusTypeByName = useMemo(
    () => Object.fromEntries((lists.status ?? []).map((s) => [s.name, s.status_type])),
    [lists.status],
  )
  const slaFor = useCallback((issue) => slaStatus({
    submittedAt: issue.submitted_date,
    closedAt: issue.closed_at,
    statusType: statusTypeByName[issue.status] ?? null,
    slaHours: slaHours[issue.severity] ?? null,
    pausedMs: issue.paused_ms,
    pausedSince: issue.paused_since,
  }), [statusTypeByName, slaHours])

  const userById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u])),
    [users],
  )
  const userName = useCallback(
    (id) => {
      const u = userById[id]
      return u ? displayName(u) : ''
    },
    [userById],
  )

  const companyChoices = useMemo(() => companyOptions(companies, rows), [companies, rows])

  // Every label configured, plus any already on a ticket — a retired label can
  // still be filtered for while tickets carry it.
  const labelChoices = useMemo(() => {
    const names = new Set((lists.labels ?? []).map((l) => l.name))
    rows.forEach((r) => (r.labels ?? []).forEach((l) => names.add(l)))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [lists.labels, rows])

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    const days = Number(filters.resolvedWithin)
    const cutoff = days > 0 ? loadedAt - days * 86_400_000 : null
    return rows.filter((r) => {
      if (cutoff && statusTypeByName[r.status] === 'closed') {
        // No `closed_at` means no age to judge, so the ticket stays.
        const closedAt = toMillis(r.closed_at)
        if (closedAt && closedAt < cutoff) return false
      }
      if (!allows(filters.status, r.status)) return false
      if (!allows(filters.type, r.type)) return false
      if (!allows(filters.priority, r.priority)) return false
      if (!allows(filters.severity, r.severity)) return false
      if (!allows(filters.product, r.product)) return false
      if (!allows(filters.company, r.company)) return false
      if (filters.labels.length && !(r.labels ?? []).some((l) => filters.labels.includes(l))) return false
      // A ticket can be on two people; it belongs in either of their filters.
      if (filters.assignee_id.length) {
        const match = (filters.assignee_id.includes('unassigned') && !hasAssignees(r))
          || assigneesOf(r).some((id) => filters.assignee_id.includes(id))
        if (!match) return false
      }
      if (q) {
        const hay = [r.title, r.description, r.company, r.requester_name,
          r.requester_email, r.jira_ticket, issueRef(project, r)].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, filters, project, statusTypeByName, loadedAt])

  const changeGroupBy = (value) => {
    setGroupBy(value)
    setCollapsed(new Set())
    try { localStorage.setItem(GROUP_KEY, value) } catch { /* not remembered, still applied */ }
  }

  const toggleGroup = (key) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const sorted = useMemo(() => {
    const [by] = sortModel
    if (!by) return filtered
    const valueOf = {
      number: (r) => r.number,
      assignee_ids: (r) => assigneesOf(r).map(userName).join(', '),
      submitted_date: (r) => toMillis(r.submitted_date),
    }[by.field] ?? ((r) => r[by.field])
    const dir = by.sort === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => dir * compare(valueOf(a), valueOf(b)))
  }, [filtered, sortModel, userName])

  const groups = useMemo(() => groupIssues(sorted, groupBy, {
    order: ((groupBy === 'severity' ? lists.severity : lists.status) ?? []).map((o) => o.name),
    nameOf: userName,
  }), [sorted, groupBy, lists.status, lists.severity, userName])

  // Grouped, the grid gets a heading row before each group's tickets. A ticket
  // on two people sits under both, so its row id is made unique per group.
  const gridRows = useMemo(() => (groups
    ? groups.flatMap((g) => [
      { id: `group:${g.key}`, group: { ...g, count: g.rows.length, open: !collapsed.has(g.key) } },
      ...(collapsed.has(g.key) ? [] : g.rows.map((r) => ({ ...r, rowId: `${g.key}:${r.id}` }))),
    ])
    : sorted), [groups, sorted, collapsed])

  const orderedIds = useMemo(
    () => [...new Set((groups ? groups.flatMap((g) => g.rows) : sorted).map((r) => r.id))],
    [groups, sorted],
  )

  const applyView = (id) => {
    setActiveView(id)
    const v = views.find((x) => x.id === id)
    setFilters(v ? readFilters(v.filters) : EMPTY_FILTERS)
  }

  const saveView = async () => {
    const { mode, id, name } = viewDialog
    const trimmed = name.trim()
    if (!trimmed) return
    const { error } =
      mode === 'create'
        ? await supabase.from('views').insert({ name: trimmed, filters })
        : await supabase.from('views').update({ name: trimmed }).eq('id', id)
    if (error) return setError(error.message)
    setViewDialog(null)
    loadViews()
  }

  const deleteView = async () => {
    if (!activeView || !confirm('Delete this view?')) return
    const { error } = await supabase.from('views').delete().eq('id', activeView)
    if (error) return setError(error.message)
    setActiveView(''); setFilters(EMPTY_FILTERS); loadViews()
  }

  const set = (field) => (e) => {
    setFilters((f) => ({ ...f, [field]: e.target.value }))
    setActiveView('') // editing filters detaches from the saved view
  }
  const pick = (field) => (_e, v) => {
    setFilters((f) => ({ ...f, [field]: v }))
    setActiveView('')
  }
  const names = (list) => (list ?? []).map((o) => o.name)
  const assigneeChoices = useMemo(
    () => ['unassigned', ...[...users].sort(byDisplayName).map((u) => u.id)], [users])
  const assigneeLabel = (id) => (id === 'unassigned' ? 'Unassigned' : userName(id) || 'Unknown')

  const groupLabel = useCallback((g) => {
    if (g.key === '') return <Typography variant="body2" color="text.secondary"><em>{g.label}</em></Typography>
    if (groupBy === 'status') return <Tag value={g.key} color={statusColor(lists.status ?? [], g.key)} />
    if (groupBy === 'severity') return <Tag value={g.key} color={colorOf('severity', g.key)} />
    if (groupBy === 'assignee' && userById[g.key]) return <UserChip user={userById[g.key]} size={22} />
    return <Typography variant="body2" sx={{ fontWeight: 600 }}>{g.label}</Typography>
  }, [groupBy, lists.status, colorOf, userById])

  const columns = useMemo(() => [
    {
      field: 'number', headerName: 'ID', width: 100,
      valueGetter: (_v, row) => (row.group ? row.group.label : issueRef(project, row)),
      // A heading row spans the whole width; the cells it covers are not drawn.
      colSpan: (_v, row) => (row.group ? 99 : 1),
      renderCell: (p) => {
        const g = p.row.group
        if (!g) return p.value
        return (
          <Stack direction="row" spacing={1} data-issue-group={g.key}
            sx={{ height: '100%', alignItems: 'center' }}>
            {g.open
              ? <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              : <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />}
            {groupLabel(g)}
            <Typography variant="caption" color="text.secondary">{g.count}</Typography>
          </Stack>
        )
      },
    },
    {
      field: 'title', headerName: 'Title', flex: 2, minWidth: 220,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.75} sx={{ height: '100%', alignItems: 'center' }}>
          <Typography variant="body2" noWrap>{p.value}</Typography>
          {attachmentCounts[p.row.id] > 0 && (
            <Tooltip title={`${attachmentCounts[p.row.id]} attachment(s)`}>
              <AttachFileIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
            </Tooltip>
          )}
        </Stack>
      ),
    },
    {
      field: 'type', headerName: 'Type', width: 140,
      renderCell: (p) => <Tag value={p.value} color={colorOf('type', p.value)} />,
    },
    {
      field: 'priority', headerName: 'Priority', width: 110,
      renderCell: (p) => <Tag value={p.value} color={colorOf('priority', p.value)} />,
    },
    {
      // Name only in the grid — the behaviour behind it is a sentence, and
      // belongs where a severity is chosen rather than in every row.
      field: 'severity', headerName: 'Severity', width: 120,
      renderCell: (p) => (p.value
        ? <Tag value={p.value} color={colorOf('severity', p.value)} />
        : <Typography variant="caption" color="text.disabled">Not triaged</Typography>),
    },
    {
      field: 'status', headerName: 'Status', width: 130,
      renderCell: (p) => <Tag value={p.value} color={statusColor(lists.status ?? [], p.value)} />,
    },
    { field: 'product', headerName: 'Product', width: 140 },
    {
      // valueGetter still yields the name, so sorting, filtering and export keep
      // working on what the column actually means; renderCell only adds the face.
      field: 'assignee_ids', headerName: 'Assignees', width: 190,
      // Sorting, filtering and export run off the names, so a column that reads
      // "Ada +1" still sorts and exports as the people it means.
      valueGetter: (v) => (v ?? []).map(userName).filter(Boolean).join(', ') || '—',
      renderCell: (p) => (
        <AssigneeChip users={assigneesOf(p.row).map((id) => userById[id])}
          size={24} empty="—" italicWhenEmpty={false} sx={{ height: '100%' }} />
      ),
    },
    { field: 'company', headerName: 'Company', width: 140 },
    { field: 'jira_ticket', headerName: 'Jira', width: 110, valueGetter: (v) => v || '—' },
    {
      field: 'submitted_date', headerName: 'Submitted', width: 170,
      valueGetter: (v) => formatDate(v),
    },
    {
      field: 'sla', headerName: 'SLA', width: 130, sortable: false,
      renderCell: (p) => {
        const sla = slaFor(p.row)
        if (!sla || sla.state === 'none') {
          return <Typography variant="caption" color="text.disabled">—</Typography>
        }
        const band = slaBand(sla)
        return (
          <Tooltip title={
            `${formatDuration(sla.elapsedMs)} of ${formatDuration(sla.targetMs)}`
            + ` (${Math.round((sla.ratio ?? 0) * 100)}%)`
          }>
            <Chip size="small" variant="outlined" label={band.label}
              sx={{ color: band.color, borderColor: band.color, bgcolor: `${band.color}14` }} />
          </Tooltip>
        )
      },
    },
  ], [attachmentCounts, colorOf, userName, userById, slaFor, lists.status, project, groupLabel])

  // Only tickets still loaded: one deleted since the snapshot has nowhere to go.
  const siblings = useMemo(() => {
    if (!selected) return null
    const loaded = new Set(rows.map((r) => r.id))
    return (navIds ?? orderedIds).filter((id) => loaded.has(id))
  }, [selected, navIds, rows, orderedIds])

  const narrow = useMediaQuery((t) => t.breakpoints.down('md'))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => isApplied(k, v)).length

  return (
    // From a tablet up the page fills the window below the header (64px) and its
    // padding, so the grid takes whatever height the filters leave it. On a
    // phone there is no height to share: the page scrolls, the filters fold
    // away behind a button, and the grid gets most of a screen to itself.
    <Stack spacing={2} sx={{ height: { xs: 'auto', md: 'calc(100dvh - 112px)' } }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Typography variant="h5">Issues</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {filtered.length} of {rows.length}
        </Typography>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {!projectsLoading && !projectId && <NoProject />}

      {narrow && (
        <Box>
          <Button variant="outlined" startIcon={<FilterListIcon />}
            aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            {filtersOpen ? 'Hide filters' : 'Filters'}
            {activeFilterCount > 0 && ` (${activeFilterCount})`}
          </Button>
        </Box>
      )}

      <Collapse in={!narrow || filtersOpen} sx={{ flexShrink: 0 }}>
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <TextField
            size="small" placeholder="Search title, requester, Jira…" value={filters.search}
            onChange={set('search')} sx={{ minWidth: { xs: '100%', sm: 260 } }}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              },
            }}
          />
          <MultiFilter label="Status"   value={filters.status}   onChange={pick('status')}   options={names(lists.status)} />
          <MultiFilter label="Type"     value={filters.type}     onChange={pick('type')}     options={names(lists.type)} />
          <MultiFilter label="Priority" value={filters.priority} onChange={pick('priority')} options={names(lists.priority)} />
          <MultiFilter label="Severity" value={filters.severity} onChange={pick('severity')} options={names(lists.severity)} />
          <MultiFilter label="Product"  value={filters.product}  onChange={pick('product')}  options={names(lists.product)} />
          {/* Options include companies already on a ticket, so a value typed
              before the list existed can still be filtered for. */}
          <MultiFilter label="Company" value={filters.company} onChange={pick('company')} options={companyChoices} width={200} />
          <MultiFilter label="Labels" value={filters.labels} onChange={pick('labels')} options={labelChoices} width={200} />
          <TextField
            select size="small" label="Resolved" value={filters.resolvedWithin}
            onChange={set('resolvedWithin')} sx={{ minWidth: 150 }}
          >
            {RESOLVED_WINDOWS.map((w) => (
              <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>
            ))}
          </TextField>
          <MultiFilter
            label="Assignee" value={filters.assignee_id} onChange={pick('assignee_id')}
            options={assigneeChoices} getOptionLabel={assigneeLabel} width={200}
            renderOption={(props, id) => {
              const { key, ...rest } = props
              return (
                <li key={key} {...rest}>
                  {id === 'unassigned'
                    ? <em>Unassigned</em>
                    : <UserChip user={userById[id] ?? { id }} size={22} />}
                </li>
              )
            }}
          />
          {activeFilterCount > 0 && (
            <Button size="small" startIcon={<ClearIcon />}
              onClick={() => { setFilters(EMPTY_FILTERS); setActiveView('') }}>
              Clear
            </Button>
          )}
        </Stack>

        <Stack direction="row" sx={{ mt: 2, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select size="small" label="Saved view" value={activeView}
            onChange={(e) => applyView(e.target.value)} sx={{ minWidth: 200 }}
          >
            <MenuItem value=""><em>None</em></MenuItem>
            {views.map((v) => <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>)}
          </TextField>
          {can.manageViews(profile) && (
            <>
              <Tooltip title="Save current filters as a new view">
                <span>
                  <IconButton size="small" disabled={activeFilterCount === 0}
                    onClick={() => setViewDialog({ mode: 'create', name: '' })}>
                    <BookmarkAddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Rename view">
                <span>
                  <IconButton size="small" disabled={!activeView}
                    onClick={() => setViewDialog({
                      mode: 'rename', id: activeView,
                      name: views.find((v) => v.id === activeView)?.name ?? '',
                    })}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Delete view">
                <span>
                  <IconButton size="small" disabled={!activeView} onClick={deleteView}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
          {activeView === '' && activeFilterCount > 0 && (
            <Chip size="small" label="unsaved filters" variant="outlined" />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <TextField
            select size="small" label="Group by" value={groupBy}
            onChange={(e) => changeGroupBy(e.target.value)} sx={{ minWidth: 150 }}
          >
            {GROUP_BY.map((g) => <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>)}
          </TextField>
        </Stack>
      </Paper>
      </Collapse>

      <Paper sx={{ flex: { md: 1 }, minHeight: 400, height: { xs: '78dvh', md: 'auto' } }}>
        <DataGrid
          rows={gridRows} columns={columns} loading={loading}
          getRowId={(r) => r.rowId ?? r.id}
          getRowClassName={(p) => (p.row.group ? 'issue-group' : '')}
          disableRowSelectionOnClick
          // The grid's own column filter would hide group headings along with
          // tickets; the filters above are the page's filters.
          disableColumnFilter
          sortingMode="server" sortModel={sortModel} onSortModelChange={setSortModel}
          onRowClick={(p) => {
            if (p.row.group) return toggleGroup(p.row.group.key)
            setNavIds(orderedIds)
            openIssue(p.row.id)
          }}
          initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
          pageSizeOptions={[25, 50, 100]}
          sx={{
            border: 0,
            '& .MuiDataGrid-row': { cursor: 'pointer' },
            '& .issue-group': { bgcolor: 'grey.50' },
          }}
        />
      </Paper>

      <IssueDetail
        issueId={selected} open={Boolean(selected)}
        onClose={closeIssue} onSaved={load}
        siblings={siblings} onNavigate={openIssue}
      />

      <Dialog open={Boolean(viewDialog)} onClose={() => setViewDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{viewDialog?.mode === 'create' ? 'Save view' : 'Rename view'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth label="View name" sx={{ mt: 1 }}
            value={viewDialog?.name ?? ''}
            onChange={(e) => setViewDialog((d) => ({ ...d, name: e.target.value }))}
          />
          {viewDialog?.mode === 'create' && (
            <Typography variant="caption" color="text.secondary">
              Saves the {activeFilterCount} filter(s) currently applied. Everyone can load it.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveView}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

// A dropdown that takes several picks; none picked reads as "All".
function MultiFilter({ label, value, onChange, options = [], width = 160, ...rest }) {
  return (
    <Autocomplete
      multiple size="small" limitTags={1} disableCloseOnSelect
      options={options} value={value} onChange={onChange}
      renderInput={(p) => <TextField {...p} label={label} placeholder={value.length ? '' : 'All'} />}
      sx={{ minWidth: width }}
      {...rest}
    />
  )
}
