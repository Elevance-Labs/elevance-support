import { useEffect, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  IconButton, Link, List, ListItem, ListItemText, Stack, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from '@mui/material'
import EditIcon from '@mui/icons-material/EditOutlined'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMoveOutlined'
import BusinessIcon from '@mui/icons-material/BusinessOutlined'
import PersonAddIcon from '@mui/icons-material/PersonAddAlt1Outlined'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'
import { isEmail } from '../lib/email'
import { contactName, moveTargets, ownerOf, splitTickets } from '../lib/inbox'
import { issueRef } from '../lib/projects'
import { statusTypeOf } from '../lib/sla'
import { StatusLabel } from './StatusDot'
import UserAvatar from './UserAvatar'

const NEW_CONTACT = { key: '__new' }

/** Ticket rows: reference (linked), title, status. */
function TicketRows({ tickets, project, statuses, onOpen }) {
  return (
    <Stack spacing={0.75}>
      {tickets.map((i) => (
        <Box key={i.id} data-contact-ticket={issueRef(project, i)}>
          <Link component="button" type="button" onClick={() => onOpen?.(i.id)}
            variant="body2" underline="hover" sx={{ fontWeight: 600, verticalAlign: 'baseline' }}>
            {issueRef(project, i)}
          </Link>
          <Typography variant="body2" component="span" sx={{ ml: 0.75 }}>{i.title}</Typography>
          <Box sx={{ color: 'text.secondary' }}>
            <StatusLabel name={i.status} statusType={statusTypeOf(statuses, i.status)} />
          </Box>
        </Box>
      ))}
    </Stack>
  )
}

const TICKET_COLUMNS = 'id, number, title, status, company, company_code, requester_email, submitted_date, created_at'

/**
 * The contact's tickets, one list at a time: **Their tickets** (they asked
 * for them) or **Copied on** (someone else's, they are on its emails).
 *
 * Only open tickets come with the Inbox. Closed ones are fetched for this
 * person when asked — theirs by requester address, the copied ones by the
 * tickets their emails were on — and are then split the same way.
 */
function TicketsSection({ entry, project, issues, statuses, onOpen }) {
  const [which, setWhich] = useState('own')
  const [closed, setClosed] = useState(null) // null until asked for
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Another person: back to their own tickets, and nothing closed fetched.
  useEffect(() => { setWhich('own'); setClosed(null); setError('') }, [entry.key])

  const byId = new Map(issues.map((i) => [i.id, i]))
  const open = {
    own: entry.ownIssueIds.map((id) => byId.get(id)).filter(Boolean),
    copied: entry.copiedIssueIds.map((id) => byId.get(id)).filter(Boolean),
  }
  const closedSplit = closed ? splitTickets(entry, closed) : null
  const shown = open[which]

  const loadClosed = async () => {
    const names = statuses.filter((s) => s.status_type === 'closed').map((s) => s.name)
    if (!names.length) return setClosed([])
    setBusy(true); setError('')
    // A requester address is stored as it was typed, so it is matched
    // ignoring case — and checked exactly again by splitTickets().
    const asked = entry.emails.map((a) => `requester_email.ilike."${a.email.replace(/"/g, '')}"`).join(',')
    const [mine, onEmails] = await Promise.all([
      supabase.from('issues').select(TICKET_COLUMNS).eq('project_id', project?.id)
        .in('status', names).or(asked),
      entry.issueIds.length
        ? supabase.from('issues').select(TICKET_COLUMNS).eq('project_id', project?.id)
          .in('status', names).in('id', entry.issueIds)
        : Promise.resolve({ data: [] }),
    ])
    setBusy(false)
    const failed = mine.error ?? onEmails.error
    if (failed) return setError(failed.message)
    const seen = new Set()
    setClosed([...(mine.data ?? []), ...(onEmails.data ?? [])]
      .filter((i) => names.includes(i.status) && !seen.has(i.id) && seen.add(i.id)))
  }

  return (
    <Box data-contact-tickets={which}>
      <Typography variant="overline" color="text.secondary">Tickets</Typography>
      <ToggleButtonGroup size="small" exclusive fullWidth value={which} sx={{ mb: 1.5 }}
        onChange={(_e, v) => { if (v) setWhich(v) }}>
        <ToggleButton value="own">Their tickets · {open.own.length + (closedSplit?.own.length ?? 0)}</ToggleButton>
        <Tooltip title="Someone else’s tickets they are on the emails of — usually as Cc.">
          <ToggleButton value="copied">Copied on · {open.copied.length + (closedSplit?.copied.length ?? 0)}</ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      {shown.length === 0 && (
        <Typography variant="body2" color="text.disabled">
          {which === 'own' ? 'No open tickets of their own.' : 'Not on anyone else’s open tickets.'}
        </Typography>
      )}
      <TicketRows tickets={shown} project={project} statuses={statuses} onOpen={onOpen} />
      {closedSplit ? (
        <Box sx={{ mt: 1.5 }} data-closed-tickets>
          <Typography variant="caption" color="text.secondary">Closed</Typography>
          {closedSplit[which].length === 0
            ? <Typography variant="body2" color="text.disabled">None closed.</Typography>
            : <TicketRows tickets={closedSplit[which]} project={project} statuses={statuses} onOpen={onOpen} />}
        </Box>
      ) : (
        <Button size="small" sx={{ mt: 1 }} onClick={loadClosed} disabled={busy}>
          {busy ? 'Loading…' : 'Show closed tickets'}
        </Button>
      )}
    </Box>
  )
}

/** "Jane Doe · jane@acme.com, jane@gmail.com" — enough to tell two Janes apart. */
const targetLabel = (e) => (e === NEW_CONTACT
  ? 'A new contact of its own'
  : `${contactName(e)} · ${e.emails.map((a) => a.email).join(', ')}`)

/**
 * Where an address goes: another contact, or — when its contact has others —
 * a new one of its own. An unsaved sender is "moved" the same way, into a
 * contact for the first time.
 */
function MoveDialog({ email, from, entries, onClose, onMove }) {
  const { targets, split } = moveTargets(entries, from)
  const options = split ? [NEW_CONTACT, ...targets] : targets
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{from?.saved && from?.id ? 'Move address' : 'Add to a contact'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          <strong>{email}</strong> will belong to the contact you pick, along with its
          emails. {from?.saved && from?.id && from.emails.length === 1
            ? `It is ${contactName(from)}'s only address, so ${contactName(from)} is merged into that contact, notes and all.`
            : ''}
        </Typography>
        <Autocomplete size="small" options={options} value={target}
          onChange={(_e, v) => setTarget(v)}
          getOptionLabel={targetLabel}
          isOptionEqualToValue={(a, b) => a.key === b.key}
          renderInput={(params) => <TextField {...params} label="Contact" autoFocus />} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!target || busy}
          onClick={async () => {
            setBusy(true)
            await onMove(target === NEW_CONTACT ? null : target.id)
            setBusy(false)
          }}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * The right-hand column of the Inbox: who this person is. Their name, their
 * addresses, the company they are with and the notes the team keeps on them,
 * then their tickets — the ones they asked for, or other people's they were
 * copied on, one at a time; closed ones only when asked for.
 *
 * Names and notes are written straight to `contacts` (RLS: project members,
 * those two columns only). A contact always has a name — the database makes
 * one from the address — so a rename may change it but never empty it.
 * Addresses carry no name of their own; they move through
 * `move_contact_email()`, which is also how one is added — and an address
 * takes the name it brought with it along. None is ever removed — there is
 * no button for it because there is no way to.
 *
 * A ticket opens through `onOpenIssue(id)` — over the Inbox, not on Issues.
 *
 * `onChanged(key)` reloads the Inbox, and selects `key` when the person now
 * lives under another contact (merged, or saved for the first time).
 */
export default function ContactPanel({ entry, entries, project, issues, statuses, onChanged, onOpenIssue }) {
  const { profile } = useAuth()
  const mayEdit = can.editContacts(profile)
  const saved = Boolean(entry?.saved && entry?.id)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [adding, setAdding] = useState('')
  const [moving, setMoving] = useState(null) // the address being moved
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // A different person, or the same one reloaded: start from what is stored.
  useEffect(() => {
    setNaming(false); setNotes(entry?.notes ?? ''); setAdding(''); setError('')
  }, [entry?.key, entry?.notes])

  if (!entry) return null
  const shown = contactName(entry)

  const save = async (patch) => {
    setBusy(true); setError('')
    const { data, error } = await supabase.from('contacts').update(patch).eq('id', entry.id).select('id')
    setBusy(false)
    // Row-level security refuses by matching nothing, not by erroring.
    if (error || !data?.length) {
      setError(error?.message ?? 'Not saved — you may not edit this project’s contacts.')
      return false
    }
    onChanged?.()
    return true
  }

  const move = async (email, contactId, label) => {
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('move_contact_email', {
      p_project: project?.id, p_email: email, p_contact: contactId, p_name: label ?? null,
    })
    setBusy(false)
    if (error) { setError(error.message); return null }
    return data
  }

  const typed = adding.trim().toLowerCase()
  const addProblem = typed && !isEmail(typed) ? 'Not an email address'
    : entry.emails.some((a) => a.email === typed) ? 'Already one of theirs' : ''
  const owner = typed && !addProblem ? ownerOf(entries, typed, entry) : null

  const add = async () => {
    if (!typed || addProblem) return
    const into = await move(typed, entry.id)
    if (into) { setAdding(''); onChanged?.(into) }
  }


  return (
    <Stack spacing={2} sx={{ p: 2 }} data-contact-panel>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <UserAvatar name={shown} size={56} />
        {naming ? (
          <Stack spacing={1} sx={{ width: '100%' }}>
            <TextField size="small" label="Name" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (name.trim() && await save({ name })) setNaming(false) }
                if (e.key === 'Escape') setNaming(false)
              }}
              slotProps={{ htmlInput: { maxLength: 200 } }} />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setNaming(false)}>Cancel</Button>
              <Button size="small" variant="contained" disabled={busy || !name.trim()}
                onClick={async () => { if (await save({ name })) setNaming(false) }}>
                Save
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', maxWidth: '100%' }}>
            <Typography variant="h6" noWrap data-contact-name>{shown}</Typography>
            {saved && mayEdit && (
              <Tooltip title="Rename">
                <IconButton size="small" aria-label="Rename contact"
                  onClick={() => { setName(shown); setNaming(true) }}>
                  <EditIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}
        {entry.company && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
            <BusinessIcon sx={{ fontSize: 16 }} />
            <Typography variant="body2">{entry.company.name}</Typography>
          </Stack>
        )}
      </Stack>

      {!saved && (
        <Alert severity="info" icon={<PersonAddIcon />}>
          {entry.saved
            ? 'This address is not under a contact yet.'
            : 'This sender wrote in but is not one of the project’s contacts yet. Save them to write back from here.'}
          {mayEdit && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <Button size="small" variant="contained" disabled={busy}
                onClick={async () => {
                  const into = await move(entry.emails[0].email, null, entry.name)
                  if (into) onChanged?.(into)
                }}>
                Save as contact
              </Button>
              <Button size="small" disabled={busy} onClick={() => setMoving(entry.emails[0].email)}>
                Add to a contact…
              </Button>
            </Stack>
          )}
        </Alert>
      )}

      <Divider />
      <Box>
        <Typography variant="overline" color="text.secondary">Email addresses</Typography>
        <List dense disablePadding>
          {entry.emails.map((a) => (
            <ListItem key={a.email} disableGutters data-contact-email={a.email}
              secondaryAction={saved && mayEdit && (
                <Tooltip title="Move to another contact">
                  <IconButton edge="end" size="small" aria-label={`Move ${a.email}`}
                    onClick={() => setMoving(a.email)}>
                    <DriveFileMoveIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}>
              <ListItemText primary={a.email}
                slotProps={{ primary: { noWrap: true, title: a.email, variant: 'body2' } }} />
            </ListItem>
          ))}
        </List>
        {saved && mayEdit && (
          <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'flex-start' }}>
            <TextField size="small" fullWidth placeholder="Add an address" value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
              error={Boolean(addProblem)}
              helperText={addProblem || (owner ? `Now under ${contactName(owner)} — adding moves it here.` : undefined)}
              slotProps={{ htmlInput: { 'aria-label': 'Add an email address' } }} />
            <Button size="small" variant="outlined" onClick={add}
              disabled={!typed || Boolean(addProblem) || busy} sx={{ mt: 0.25 }}>
              Add
            </Button>
          </Stack>
        )}
      </Box>

      {saved && (
        <>
          <Divider />
          <Box>
            <Typography variant="overline" color="text.secondary">Notes</Typography>
            <TextField multiline minRows={3} maxRows={12} fullWidth size="small" value={notes}
              placeholder={mayEdit ? 'What the team should know about them' : 'No notes'}
              disabled={!mayEdit}
              onChange={(e) => setNotes(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 10000, 'aria-label': 'Notes' } }} />
            {mayEdit && notes !== (entry.notes ?? '') && (
              <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => setNotes(entry.notes ?? '')}>Discard</Button>
                <Button size="small" variant="contained" disabled={busy}
                  onClick={() => save({ notes })}>
                  Save notes
                </Button>
              </Stack>
            )}
          </Box>
        </>
      )}

      <Divider />
      <TicketsSection entry={entry} project={project} issues={issues} statuses={statuses} onOpen={onOpenIssue} />

      {moving && (
        <MoveDialog email={moving} from={entry} entries={entries}
          onClose={() => setMoving(null)}
          onMove={async (contactId) => {
            const into = await move(moving, contactId, entry.saved ? null : entry.name)
            setMoving(null)
            if (!into) return
            // The person on screen is the one the address left, unless that
            // was their last one and they are now part of the other.
            const stays = entry.saved && entry.id && entry.emails.length > 1
            onChanged?.(stays ? entry.key : into)
          }} />
      )}
    </Stack>
  )
}
