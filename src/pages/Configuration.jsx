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
import { useConfig, LIST_TYPES } from '../context/ConfigContext'
import { STATUS_TYPES, STATUS_TYPE_LABELS, STATUS_TYPE_COLORS } from '../lib/sla'
import Tag from '../components/Tag'

/** "8h", "3d", "36h" — SLA targets read better than a raw hour count. */
function formatSla(hours) {
  if (hours % 24 === 0 && hours >= 24) return `${hours / 24}d`
  return `${hours}h`
}

const blank = {
  name: '', color: '', sort_order: 0, is_active: true,
  status_type: 'new',   // only used by the Statuses tab
  sla_hours: '',        // only used by the Types tab
}

export default function Configuration() {
  const { lists, refresh } = useConfig()
  const [tab, setTab] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const listType = LIST_TYPES[tab].key
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
      ...(listType === 'status' ? { status_type: values.status_type } : {}),
      ...(listType === 'type'
        ? { sla_hours: values.sla_hours === '' ? null : Number(values.sla_hours) }
        : {}),
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

  const patch = (field) => (e) =>
    setDialog((d) => ({
      ...d,
      values: {
        ...d.values,
        [field]: field === 'is_active' ? e.target.checked : e.target.value,
      },
    }))

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Configuration</Typography>
      <Typography variant="body2" color="text.secondary">
        These lists drive every dropdown on the intake form and in the dashboard.
      </Typography>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ borderBottom: '1px solid #e5e7eb' }}>
          {LIST_TYPES.map((l) => <Tab key={l.key} label={l.label} />)}
        </Tabs>

        <Box sx={{ p: 2 }}>
          <Stack direction="row" sx={{ mb: 1, justifyContent: 'flex-end' }}>
            <Button size="small" variant="contained" startIcon={<AddIcon />}
              onClick={() => setDialog({ id: null, values: { ...blank, sort_order: items.length + 1 } })}>
              Add {LIST_TYPES[tab].singular}
            </Button>
          </Stack>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                {listType === 'status' && <TableCell width={190}>Status type</TableCell>}
                {listType === 'type' && <TableCell width={120}>SLA target</TableCell>}
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
                  {listType === 'type' && (
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
                        sla_hours: item.sla_hours ?? '',
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
                  <TableCell colSpan={listType === 'status' || listType === 'type' ? 6 : 5}>
                    <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                      Nothing configured yet.
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{dialog?.id ? 'Edit' : 'Add'} {LIST_TYPES[tab].singular}</DialogTitle>
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

            {listType === 'type' && (
              <TextField label="SLA target (hours)" type="number" fullWidth
                value={dialog?.values.sla_hours ?? ''} onChange={patch('sla_hours')}
                slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
                helperText="Time from submission until the ticket reaches a Closed status. Leave blank for no SLA." />
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
    </Stack>
  )
}
