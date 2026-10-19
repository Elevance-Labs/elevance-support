import { useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, Stack, Switch, Tab, Table, TableBody, TableCell,
  TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useConfig, LIST_TYPES } from '../context/ConfigContext'
import { STATUS_TYPES, STATUS_TYPE_LABELS, STATUS_TYPE_COLORS } from '../lib/sla'
import { can } from '../lib/permissions'
import { isEmptyDoc, storedDoc, toStored } from '../lib/richText'
import Tag from '../components/Tag'
import RichTextEditor, { StoredRichText } from '../components/RichTextEditor'

/** "8h", "3d", "36h" — SLA targets read better than a raw hour count. */
function formatSla(hours) {
  if (hours % 24 === 0 && hours >= 24) return `${hours / 24}d`
  return `${hours}h`
}

const blank = {
  name: '', color: '', sort_order: 0, is_active: true,
  status_type: 'new',   // only used by the Statuses tab
  description: '',      // Statuses tab too: what customers read on the company page
  // Both only used by the Severities tab: what the team promises, and that
  // promise as a number the SLA clock can read.
  sla_hours: '',
  behavior: '',
}

// Templates sit after the dropdown lists: they are configuration too, but text
// for the comment box rather than a list anything is picked from on a ticket.
const TEMPLATES = 'templates'

export default function Configuration() {
  const { profile } = useAuth()
  // Only the tabs this person may manage: everything for an admin, labels and
  // templates for a manager. The database draws the same line.
  const lists = LIST_TYPES.filter((l) => can.manageList(profile, l.key))
  const tabs = [...lists.map((l) => l.key), ...(can.manageTemplates(profile) ? [TEMPLATES] : [])]
  const [picked, setPicked] = useState(null)
  const tab = tabs.includes(picked) ? picked : tabs[0]
  const list = lists.find((l) => l.key === tab)

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Configuration</Typography>
      <Typography variant="body2" color="text.secondary">
        These lists drive every dropdown on the intake form and in the dashboard,
        and the templates offered under the comment box.
        {!can.manageConfig(profile) && ' The other lists are managed by an admin.'}
      </Typography>

      {tab && (
        <Paper>
          <Tabs value={tab} onChange={(_e, v) => setPicked(v)} sx={{ borderBottom: '1px solid #e5e7eb' }}>
            {lists.map((l) => <Tab key={l.key} value={l.key} label={l.label} />)}
            {tabs.includes(TEMPLATES) && <Tab value={TEMPLATES} label="Templates" />}
          </Tabs>

          {tab === TEMPLATES
            ? <TemplatesPanel />
            : <ListPanel key={list.key} type={list} />}
        </Paper>
      )}
    </Stack>
  )
}

/** One `list_items` type: its table, and the add/edit dialog. */
function ListPanel({ type }) {
  const { lists, refresh } = useConfig()
  const [dialog, setDialog] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const listType = type.key
  const items = lists[listType] ?? []

  const save = async () => {
    setBusy(true); setError('')
    const { id, values } = dialog
    const payload = {
      list_type: listType,
      name: values.name.trim(),
      // Statuses are coloured by their status type, so they never store one.
      color: listType === 'status' ? null : (values.color.trim() || null),
      sort_order: Number(values.sort_order) || 0,
      is_active: values.is_active,
      // Only the tab that owns a column writes it.
      ...(listType === 'status'
        ? { status_type: values.status_type, description: values.description.trim() || null }
        : {}),
      // A severity without its behaviour is just a second priority list, so the
      // database refuses a blank one — the form asks for it rather than letting
      // that come back as an error. The target rides along with it: the SLA is
      // a commitment to what the ticket costs, so it is set where that is said.
      ...(listType === 'severity'
        ? {
            behavior: values.behavior.trim(),
            sla_hours: values.sla_hours === '' ? null : Number(values.sla_hours),
          }
        : {}),
    }
    if (listType === 'severity' && !payload.behavior) {
      setBusy(false)
      return setError('Say what this severity commits the team to.')
    }
    const { error } = id
      ? await supabase.from('list_items').update(payload).eq('id', id)
      : await supabase.from('list_items').insert(payload)
    setBusy(false)
    if (error) return setError(error.message)
    setDialog(null)
    refresh()
  }

  const remove = async (item) => {
    if (!confirm(
      `Delete "${item.name}"? Issues already using it keep the value, ` +
      `but it will no longer be selectable.`
    )) return
    const { error } = await supabase.from('list_items').delete().eq('id', item.id)
    if (error) return setError(error.message)
    refresh()
  }

  const toggleActive = async (item) => {
    const { error } = await supabase.from('list_items')
      .update({ is_active: !item.is_active }).eq('id', item.id)
    if (error) return setError(error.message)
    refresh()
  }

  // Kept in step with the header below rather than spelled out again, so the
  // empty-state row can't drift out of line with the columns above it.
  const columnCount = 4                                   // Name, Order, Active, Actions
    + (listType === 'status' ? 2 : 0)                     // Status type, Description
    + (listType === 'severity' ? 2 : 0)                   // Behaviour, SLA target
    + (listType === 'status' ? 0 : 1)                     // Colour

  const patch = (field) => (e) =>
    setDialog((d) => ({
      ...d,
      values: {
        ...d.values,
        [field]: field === 'is_active' ? e.target.checked : e.target.value,
      },
    }))

  return (
    <>
      <Box sx={{ p: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
        <Stack direction="row" sx={{ mb: 1, justifyContent: 'flex-end' }}>
          <Button size="small" variant="contained" startIcon={<AddIcon />}
            onClick={() => setDialog({ id: null, values: { ...blank, sort_order: items.length + 1 } })}>
            Add {type.singular}
          </Button>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              {listType === 'status' && <TableCell width={190}>Status type</TableCell>}
              {listType === 'status' && <TableCell>Description</TableCell>}
              {listType === 'severity' && <TableCell>Behaviour</TableCell>}
              {listType === 'severity' && <TableCell width={120}>SLA target</TableCell>}
              {listType !== 'status' && <TableCell width={110}>Colour</TableCell>}
              <TableCell width={90}>Order</TableCell>
              <TableCell width={90}>Active</TableCell>
              <TableCell align="right" width={100}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} hover>
                <TableCell>
                  <Tag value={item.name}
                    color={listType === 'status'
                      ? STATUS_TYPE_COLORS[item.status_type]
                      : item.color} />
                </TableCell>
                {listType === 'status' && (
                  <TableCell>
                    {item.status_type
                      ? (
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Box sx={{
                            width: 12, height: 12, borderRadius: '3px',
                            bgcolor: STATUS_TYPE_COLORS[item.status_type],
                          }} />
                          <Typography variant="body2">
                            {STATUS_TYPE_LABELS[item.status_type]}
                          </Typography>
                        </Stack>
                      )
                      : <Typography variant="caption" color="error">Not set</Typography>}
                  </TableCell>
                )}
                {listType === 'status' && (
                  <TableCell>
                    {item.description
                      ? <Typography variant="body2" color="text.secondary">{item.description}</Typography>
                      : <Typography variant="caption" color="text.disabled">None</Typography>}
                  </TableCell>
                )}
                {listType === 'severity' && (
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {item.behavior}
                    </Typography>
                  </TableCell>
                )}
                {listType === 'severity' && (
                  <TableCell>
                    {item.sla_hours
                      ? <Typography variant="body2">{formatSla(item.sla_hours)}</Typography>
                      : <Typography variant="caption" color="text.disabled">No SLA</Typography>}
                  </TableCell>
                )}
                {listType !== 'status' && (
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Box sx={{
                        width: 14, height: 14, borderRadius: '3px',
                        bgcolor: item.color ?? 'transparent',
                        border: '1px solid #d1d5db',
                      }} />
                      <Typography variant="caption">{item.color ?? 'auto'}</Typography>
                    </Stack>
                  </TableCell>
                )}
                <TableCell>{item.sort_order}</TableCell>
                <TableCell>
                  <Tooltip title={item.is_active ? 'Hide from dropdowns' : 'Show in dropdowns'}>
                    <Switch size="small" checked={item.is_active}
                      onChange={() => toggleActive(item)} />
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => setDialog({
                    id: item.id,
                    values: {
                      name: item.name, color: item.color ?? '',
                      sort_order: item.sort_order, is_active: item.is_active,
                      status_type: item.status_type ?? 'new',
                      description: item.description ?? '',
                      sla_hours: item.sla_hours ?? '',
                      behavior: item.behavior ?? '',
                    },
                  })}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => remove(item)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                    Nothing configured yet.
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{dialog?.id ? 'Edit' : 'Add'} {type.singular}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" fullWidth autoFocus
              value={dialog?.values.name ?? ''} onChange={patch('name')} />

            {listType === 'status' && (
              <TextField select label="Status type" fullWidth
                value={dialog?.values.status_type ?? 'new'} onChange={patch('status_type')}
                helperText="Sets the status colour, and how the ticket may move: New → In Progress → Closed. Paused can be entered from anywhere and stops the SLA clock.">
                {STATUS_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{STATUS_TYPE_LABELS[t]}</MenuItem>
                ))}
              </TextField>
            )}

            {listType === 'status' && (
              <TextField label="Description" fullWidth multiline minRows={2}
                value={dialog?.values.description ?? ''} onChange={patch('description')}
                helperText="What this status means for the customer, in a sentence. Shown on the public company page when tickets are grouped by status — anyone with that link can read it." />
            )}

            {listType === 'severity' && (
              <TextField label="Behaviour" fullWidth multiline minRows={2}
                value={dialog?.values.behavior ?? ''} onChange={patch('behavior')}
                helperText="What the team commits to at this severity, in one sentence. Shown beside the name wherever a severity is picked." />
            )}

            {listType === 'severity' && (
              <TextField label="SLA target (hours)" type="number" fullWidth
                value={dialog?.values.sla_hours ?? ''} onChange={patch('sla_hours')}
                slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
                helperText="Time from submission until the ticket reaches a Closed status — the clock runs from when the request arrived, not from triage. Leave blank for no SLA." />
            )}
            {listType !== 'status' && <TextField label="Colour" fullWidth placeholder="#1976d2"
              value={dialog?.values.color ?? ''} onChange={patch('color')}
              helperText="Hex colour. Leave blank to auto-generate one."
              slotProps={{
                input: {
                  endAdornment: (
                    <input type="color" value={dialog?.values.color || '#1976d2'}
                      onChange={patch('color')}
                      style={{ width: 28, height: 28, border: 'none', background: 'none' }} />
                  ),
                },
              }} />}
            <TextField label="Sort order" type="number" fullWidth
              value={dialog?.values.sort_order ?? 0} onChange={patch('sort_order')} />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Switch checked={dialog?.values.is_active ?? true} onChange={patch('is_active')} />
              <Typography variant="body2">Active</Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

const blankTemplate = { title: '', doc: null, sort_order: 0, is_active: true }

/**
 * Comment templates: a title to pick by and the rich text it writes into the
 * comment box (or the email box). Inactive ones stay here but are not offered
 * under the box. One saved before rich text is opened as its plain lines, and
 * saved back as a document.
 */
function TemplatesPanel() {
  const { templates, refresh } = useConfig()
  const [dialog, setDialog] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const { id, values } = dialog
    const payload = {
      title: values.title.trim(),
      // The document, and its plain text for anything that reads `body`.
      ...toStored(values.doc),
      sort_order: Number(values.sort_order) || 0,
      is_active: values.is_active,
    }
    // The database refuses either blank; say so here rather than echo its error.
    if (!payload.title || isEmptyDoc(values.doc)) return setError('A template needs a title and text.')
    setBusy(true); setError('')
    const { error } = id
      ? await supabase.from('comment_templates').update(payload).eq('id', id)
      : await supabase.from('comment_templates').insert(payload)
    setBusy(false)
    if (error) return setError(error.message)
    setDialog(null)
    refresh()
  }

  const remove = async (item) => {
    if (!confirm(`Delete the "${item.title}" template? Comments already posted from it are unaffected.`)) return
    const { error } = await supabase.from('comment_templates').delete().eq('id', item.id)
    if (error) return setError(error.message)
    refresh()
  }

  const toggleActive = async (item) => {
    const { error } = await supabase.from('comment_templates')
      .update({ is_active: !item.is_active }).eq('id', item.id)
    if (error) return setError(error.message)
    refresh()
  }

  const patch = (field) => (e) =>
    setDialog((d) => ({
      ...d,
      values: {
        ...d.values,
        [field]: field === 'is_active' ? e.target.checked : e.target.value,
      },
    }))

  return (
    <>
      <Box sx={{ p: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
        <Stack direction="row" sx={{ mb: 1, justifyContent: 'flex-end' }}>
          <Button size="small" variant="contained" startIcon={<AddIcon />}
            onClick={() => setDialog({
              id: null, values: { ...blankTemplate, sort_order: templates.length + 1 },
            })}>
            Add Template
          </Button>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={220}>Title</TableCell>
              <TableCell>Text</TableCell>
              <TableCell width={90}>Order</TableCell>
              <TableCell width={90}>Active</TableCell>
              <TableCell align="right" width={100}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{t.title}</Typography>
                </TableCell>
                <TableCell>
                  {/* The first few lines, formatting and all. */}
                  <StoredRichText body={t.body} doc={t.body_doc} sx={{
                    color: 'text.secondary', maxHeight: '4.5em', overflow: 'hidden',
                  }} />
                </TableCell>
                <TableCell>{t.sort_order}</TableCell>
                <TableCell>
                  <Tooltip title={t.is_active ? 'Hide from the comment box' : 'Offer under the comment box'}>
                    <Switch size="small" checked={t.is_active} onChange={() => toggleActive(t)} />
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit template" onClick={() => setDialog({
                    id: t.id,
                    values: {
                      title: t.title, doc: storedDoc(t),
                      sort_order: t.sort_order, is_active: t.is_active,
                    },
                  })}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label="Delete template" onClick={() => remove(t)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                    No templates yet.
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>{dialog?.id ? 'Edit' : 'Add'} Template</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Title" fullWidth autoFocus
              value={dialog?.values.title ?? ''} onChange={patch('title')}
              helperText="What staff pick it by under the comment box." />
            <Box>
              {/* Keyed per template: the editor reads its starting text once. */}
              <RichTextEditor key={dialog?.id ?? 'new'} initialDoc={dialog?.values.doc}
                ariaLabel="Template text" placeholder="Text" minHeight={120}
                onChange={(doc) => setDialog((d) => d && ({ ...d, values: { ...d.values, doc } }))} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mx: 1.75 }}>
                Written into the comment box when picked, formatting and all. The author can still edit it before posting.
              </Typography>
            </Box>
            <TextField label="Sort order" type="number" fullWidth
              value={dialog?.values.sort_order ?? 0} onChange={patch('sort_order')} />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Switch checked={dialog?.values.is_active ?? true} onChange={patch('is_active')} />
              <Typography variant="body2">Active</Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
