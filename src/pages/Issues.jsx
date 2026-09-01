import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, MenuItem, Paper, Stack, TextField, Tooltip,
  Typography, Chip,
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import { useSearchParams } from 'react-router-dom'
import SearchIcon from '@mui/icons-material/Search'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ClearIcon from '@mui/icons-material/Clear'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useRefreshSignal } from '../context/RefreshContext'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'
import { formatDuration, formatDate, toMillis } from '../lib/format'
import Tag from '../components/Tag'
import IssueDetail from '../components/IssueDetail'
import { UserChip } from '../components/UserAvatar'
import { byDisplayName, displayName } from '../lib/users'
import { slaStatus, slaBand, statusColor } from '../lib/sla'
import { useProject } from '../context/ProjectContext'
import ProjectFilter, { NoProject } from '../components/ProjectFilter'
import { issueRef } from '../lib/projects'
import { companyOptions } from '../lib/companies'

// `resolvedWithin` hides tickets closed longer ago than this many days; '' is
// "no limit". Only closed tickets are ever affected — open work always shows.
const RESOLVED_WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '', label: 'All time' },
]

const EMPTY_FILTERS = {
  search: '', status: '', type: '', priority: '', assignee_id: '', product: '',
  company: '', resolvedWithin: '7',
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
  const openIssue = (id) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.set('issue', id)
    return next
  }, { replace: true })
  const closeIssue = () => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.delete('issue')
    return next
  }, { replace: true })

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

  // SLA target comes from the ticket's type; the clock stops at a closed status.
  const slaHoursByType = useMemo(
    () => Object.fromEntries((lists.type ?? []).map((t) => [t.name, t.sla_hours])),
    [lists.type],
  )
  const statusTypeByName = useMemo(
    () => Object.fromEntries((lists.status ?? []).map((s) => [s.name, s.status_type])),
    [lists.status],
  )
  const slaFor = useCallback((issue) => slaStatus({
    submittedAt: issue.submitted_date,
    closedAt: issue.closed_at,
    statusType: statusTypeByName[issue.status] ?? null,
    slaHours: slaHoursByType[issue.type] ?? null,
    pausedMs: issue.paused_ms,
    pausedSince: issue.paused_since,
  }), [statusTypeByName, slaHoursByType])

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
      if (filters.status && r.status !== filters.status) return false
      if (filters.type && r.type !== filters.type) return false
      if (filters.priority && r.priority !== filters.priority) return false
      if (filters.product && r.product !== filters.product) return false
      if (filters.company && r.company !== filters.company) return false
      if (filters.assignee_id) {
        if (filters.assignee_id === 'unassigned' ? r.assignee_id : r.assignee_id !== filters.assignee_id)
          return false
      }
      if (q) {
        const hay = [r.title, r.description, r.company, r.requester_name,
          r.requester_email, r.jira_ticket, issueRef(project, r)].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, filters, project, statusTypeByName, loadedAt])

  const applyView = (id) => {
    setActiveView(id)
    const v = views.find((x) => x.id === id)
    setFilters(v ? { ...EMPTY_FILTERS, ...v.filters } : EMPTY_FILTERS)
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

  const columns = useMemo(() => [
    {
      field: 'number', headerName: 'ID', width: 100,
      valueGetter: (_v, row) => issueRef(project, row),
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
      field: 'status', headerName: 'Status', width: 130,
      renderCell: (p) => <Tag value={p.value} color={statusColor(lists.status ?? [], p.value)} />,
    },
    { field: 'product', headerName: 'Product', width: 140 },
    {
      // valueGetter still yields the name, so sorting, filtering and export keep
      // working on what the column actually means; renderCell only adds the face.
      field: 'assignee_id', headerName: 'Assignee', width: 170,
      valueGetter: (v) => userName(v) || '—',
      renderCell: (p) => (
        <UserChip user={userById[p.row.assignee_id]} size={24} empty="—" italicWhenEmpty={false}
          sx={{ height: '100%' }} />
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
  ], [attachmentCounts, colorOf, userName, userById, slaFor, lists.status, project])

  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => v && v !== EMPTY_FILTERS[k]).length

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Typography variant="h5">Issues</Typography>
        <ProjectFilter />
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {filtered.length} of {rows.length}
        </Typography>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {!projectsLoading && !projectId && <NoProject />}

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <TextField
            size="small" placeholder="Search title, requester, Jira…" value={filters.search}
            onChange={set('search')} sx={{ minWidth: 260 }}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              },
            }}
          />
          <Filter label="Status"   value={filters.status}   onChange={set('status')}   options={lists.status} />
          <Filter label="Type"     value={filters.type}     onChange={set('type')}     options={lists.type} />
          <Filter label="Priority" value={filters.priority} onChange={set('priority')} options={lists.priority} />
          <Filter label="Product"  value={filters.product}  onChange={set('product')}  options={lists.product} />
          {/* Options include companies already on a ticket, so a value typed
              before the list existed can still be filtered for. */}
          <TextField
            select size="small" label="Company" value={filters.company}
            onChange={set('company')} sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All</MenuItem>
            {companyChoices.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
          </TextField>
          <TextField
            select size="small" label="Resolved" value={filters.resolvedWithin}
            onChange={set('resolvedWithin')} sx={{ minWidth: 150 }}
          >
            {RESOLVED_WINDOWS.map((w) => (
              <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select size="small" label="Assignee" value={filters.assignee_id}
            onChange={set('assignee_id')} sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="unassigned"><em>Unassigned</em></MenuItem>
            {[...users].sort(byDisplayName).map((u) => (
              <MenuItem key={u.id} value={u.id}>
                <UserChip user={u} size={22} />
              </MenuItem>
            ))}
          </TextField>
          {activeFilterCount > 0 && (
            <Button size="small" startIcon={<ClearIcon />}
              onClick={() => { setFilters(EMPTY_FILTERS); setActiveView('') }}>
              Clear
            </Button>
          )}
        </Stack>

        <Stack direction="row" sx={{ mt: 2, gap: 1, alignItems: 'center' }}>
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
        </Stack>
      </Paper>

      <Paper sx={{ height: 620 }}>
        <DataGrid
          rows={filtered} columns={columns} loading={loading}
          disableRowSelectionOnClick
          onRowClick={(p) => openIssue(p.row.id)}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      <IssueDetail
        issueId={selected} open={Boolean(selected)}
        onClose={closeIssue} onSaved={load}
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

function Filter({ label, value, onChange, options = [] }) {
  return (
    <TextField select size="small" label={label} value={value} onChange={onChange} sx={{ minWidth: 140 }}>
      <MenuItem value="">All</MenuItem>
      {options.map((o) => <MenuItem key={o.id} value={o.name}>{o.name}</MenuItem>)}
    </TextField>
  )
}
