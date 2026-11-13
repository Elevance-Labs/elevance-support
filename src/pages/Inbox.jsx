import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Chip, Drawer, IconButton, InputAdornment, List, ListItemAvatar,
  ListItemButton, ListItemText, ListSubheader, MenuItem, Paper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import RefreshIcon from '@mui/icons-material/Refresh'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EditIcon from '@mui/icons-material/EditOutlined'
import InfoIcon from '@mui/icons-material/InfoOutlined'
import CloseIcon from '@mui/icons-material/Close'
import { supabase } from '../lib/supabase'
import { signAttachments } from '../lib/storage'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { useProject } from '../context/ProjectContext'
import { useRefreshSignal } from '../context/RefreshContext'
import { can } from '../lib/permissions'
import { mayResend, newestFirst, resentIds, ticketSubject } from '../lib/email'
import { issueRef } from '../lib/projects'
import {
  buildInbox, contactName, defaultRecipient, groupByCompany, NO_COMPANY, searchInbox, ticketOptions,
} from '../lib/inbox'
import { NoProject } from '../components/ProjectFilter'
import UserAvatar from '../components/UserAvatar'
import EmailComposer, { ComposerLine, resendEmail } from '../components/EmailComposer'
import EmailMessage, { LastEmail } from '../components/EmailMessage'
import ContactPanel from '../components/ContactPanel'
import IssueDetail from '../components/IssueDetail'

/** How many of the project's emails the list is built from, newest first. */
const MESSAGE_LIMIT = 2000
/** How many of one person's emails the conversation draws. */
const THREAD_LIMIT = 200

const GROUP_KEY = 'el-support.inbox.group'
const readGroup = () => {
  try { return localStorage.getItem(GROUP_KEY) === 'company' ? 'company' : 'recent' } catch { return 'recent' }
}
const writeGroup = (v) => {
  try { localStorage.setItem(GROUP_KEY, v) } catch { /* a convenience only */ }
}

/** One person in the left-hand list: who, where from, and who spoke last. */
function ContactRow({ entry, selected, onSelect }) {
  const name = contactName(entry)
  const detail = [entry.company?.name, entry.emails[0]?.email].filter(Boolean).join(' · ')
  return (
    <ListItemButton selected={selected} onClick={() => onSelect(entry.key)}
      data-inbox-contact={entry.key} sx={{ alignItems: 'flex-start', py: 1 }}>
      <ListItemAvatar sx={{ minWidth: 44, mt: 0.25 }}>
        <UserAvatar name={name} size={32} />
      </ListItemAvatar>
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}>{name}</Typography>
            {entry.last
              ? <LastEmail message={entry.last} />
              : <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>No emails</Typography>}
          </Stack>
        }
        secondary={
          <Stack direction="row" spacing={0.75} component="span" sx={{ alignItems: 'center' }}>
            <Typography component="span" variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {detail}
            </Typography>
            {entry.emails.length > 1 && (
              <Typography component="span" variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                +{entry.emails.length - 1}
              </Typography>
            )}
            {!entry.saved && <Chip size="small" label="Not saved" sx={{ height: 18, fontSize: 11 }} />}
          </Stack>
        }
        slotProps={{ secondary: { component: 'div' } }}
      />
    </ListItemButton>
  )
}

/** The left-hand column: everyone, searchable, by last email or by company. */
function ContactList({ entries, selectedKey, onSelect, loading }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(readGroup)
  const shown = searchInbox(entries, query)
  const groups = group === 'company' ? groupByCompany(shown) : [{ company: null, entries: shown }]
  return (
    <Stack sx={{ minHeight: 0, height: '100%' }}>
      <Stack spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <TextField size="small" placeholder="Search people or companies" value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search contacts' },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }} />
        <ToggleButtonGroup size="small" exclusive fullWidth value={group}
          onChange={(_e, v) => { if (v) { setGroup(v); writeGroup(v) } }}>
          <ToggleButton value="recent">Recent</ToggleButton>
          <ToggleButton value="company">By company</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <List dense disablePadding sx={{ overflowY: 'auto', flexGrow: 1, minHeight: 0 }}>
        {!loading && shown.length === 0 && (
          <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>
            {query ? 'Nobody matches.' : 'Nobody has emailed this project yet.'}
          </Typography>
        )}
        {groups.map((g) => (
          <li key={g.company ?? 'all'}>
            <ul style={{ padding: 0 }}>
              {g.company && (
                <ListSubheader data-inbox-company={g.company}
                  sx={{ lineHeight: '32px', fontWeight: 600, color: g.company === NO_COMPANY ? 'text.disabled' : 'text.secondary' }}>
                  {g.company} · {g.entries.length}
                </ListSubheader>
              )}
              {g.entries.map((e) => (
                <ContactRow key={e.key} entry={e} selected={e.key === selectedKey} onSelect={onSelect} />
              ))}
            </ul>
          </li>
        ))}
      </List>
    </Stack>
  )
}

/**
 * A new email to this person. Every email belongs to a ticket — it carries the
 * ticket's subject and reply address, and their answer lands back on it — so
 * one has to be picked first; theirs that are still open are offered first.
 */
function NewEmail({ entry, project, issues, messages, onSent, onClose, onError }) {
  // Open tickets — the only ones the Inbox loads.
  const options = useMemo(() => ticketOptions(entry, issues), [entry, issues])
  const [ticket, setTicket] = useState(() => options.find((o) => o.suggested) ?? null)
  const [to, setTo] = useState(() => defaultRecipient(entry, ticket, messages))
  const ref = ticket ? issueRef(project, ticket) : ''

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-inbox-composer>
      <EmailComposer issueId={ticket?.id} projectId={project?.id} to={to} sendTo={to}
        ready={Boolean(ticket && to)} onError={onError} onSent={onSent}
        header={<>
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>New email</Typography>
            <IconButton size="small" aria-label="Close the new email" onClick={onClose}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
          <Autocomplete size="small" options={options} value={ticket}
            groupBy={(o) => (o.suggested ? 'Their open tickets' : 'Other open tickets')}
            getOptionLabel={(o) => `${issueRef(project, o)} · ${o.title}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_e, v) => {
              setTicket(v)
              // The address that asked for it is who an email about it goes to.
              if (v) setTo(defaultRecipient(entry, v, messages))
            }}
            renderInput={(params) => (
              <TextField {...params} label="Ticket" required
                helperText={ticket ? undefined : 'Every email is filed on a ticket, and replies come back to it.'} />
            )} />
          <TextField select size="small" label="To" value={to} onChange={(e) => setTo(e.target.value)}>
            {entry.emails.map((a) => (
              <MenuItem key={a.email} value={a.email}>
                {a.name ? `${a.name} <${a.email}>` : a.email}
              </MenuItem>
            ))}
          </TextField>
          {ticket && (
            <ComposerLine label="Subject">
              <Typography variant="body2">{ticketSubject(ref, ticket.title)}</Typography>
            </ComposerLine>
          )}
        </>} />
    </Paper>
  )
}

/** The middle column: everything sent to or received from this person. */
function Conversation({ entry, project, issues, listed, onBack, onDetails, onSent, onOpenIssue, compact }) {
  const { profile } = useAuth()
  const { users } = useConfig()
  const [messages, setMessages] = useState([])
  const [filesOf, setFilesOf] = useState({})
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')
  const mayWrite = can.emailCustomer(profile)
  const ids = (entry?.messageIds ?? []).slice(0, THREAD_LIMIT)
  const idsKey = ids.join(',')

  useEffect(() => { setWriting(false); setError('') }, [entry?.key])

  useEffect(() => {
    let live = true
    const wanted = idsKey ? idsKey.split(',') : []
    if (!wanted.length) { setMessages([]); setFilesOf({}); return undefined }
    ;(async () => {
      const [{ data, error }, { data: rows }] = await Promise.all([
        supabase.from('email_messages').select('*').in('id', wanted),
        supabase.from('attachments').select('*').in('email_message_id', wanted).order('created_at'),
      ])
      if (!live) return
      if (error) setError(error.message)
      setMessages(newestFirst(data ?? []))
      const items = await signAttachments(rows ?? [])
      if (!live) return
      const grouped = {}
      rows?.forEach((r, i) => { (grouped[r.email_message_id] ??= []).push(items[i]) })
      setFilesOf(grouped)
    })()
    return () => { live = false }
  }, [idsKey])

  const senderOf = useMemo(() => {
    const map = Object.fromEntries(users.map((u) => [u.id, u]))
    return (id) => map[id]
  }, [users])
  const resent = useMemo(() => resentIds(messages), [messages])
  const resend = async (m) => {
    setError('')
    const problem = await resendEmail(m)
    if (problem) setError(problem)
    else onSent?.()
  }

  // A message's ticket: from the list row, which carries one even when it is
  // closed (and so not among the open tickets loaded).
  const ticketOf = useMemo(() => Object.fromEntries(
    (listed ?? []).filter((m) => m.issues).map((m) => [m.id, { id: m.issue_id, ...m.issues }])), [listed])

  if (!entry) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', p: 3 }}>
        <Typography color="text.disabled">Pick someone to see your emails with them.</Typography>
      </Box>
    )
  }

  const name = contactName(entry)
  return (
    <Stack sx={{ minHeight: 0, height: '100%' }}>
      <Stack direction="row" spacing={1.5}
        sx={{ p: 1.5, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
        {onBack && (
          <IconButton aria-label="Back to people" onClick={onBack} edge="start">
            <ArrowBackIcon />
          </IconButton>
        )}
        <UserAvatar name={name} size={36} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>{name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {[entry.company?.name, entry.emails.map((a) => a.email).join(', ')].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <LastEmail message={entry.last} />
        {compact && (
          <Tooltip title="Contact details">
            <IconButton aria-label="Contact details" onClick={onDetails}><InfoIcon /></IconButton>
          </Tooltip>
        )}
      </Stack>

      <Stack spacing={1.5} sx={{ p: 1.5, overflowY: 'auto', flexGrow: 1, minHeight: 0 }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {mayWrite && entry.saved && (writing ? (
          <NewEmail entry={entry} project={project} issues={issues}
            messages={messages} onError={setError} onClose={() => setWriting(false)}
            onSent={() => { setWriting(false); onSent?.() }} />
        ) : (
          <Box>
            <Button variant="contained" size="small" startIcon={<EditIcon />} onClick={() => setWriting(true)}>
              Write email
            </Button>
          </Box>
        ))}

        {entry.messageIds.length === 0 && (
          <Typography variant="body2" color="text.disabled">No emails with {name} yet.</Typography>
        )}
        {entry.messageIds.length > THREAD_LIMIT && (
          <Typography variant="caption" color="text.secondary">
            Showing the latest {THREAD_LIMIT} of {entry.messageIds.length} emails. Older ones are on their tickets.
          </Typography>
        )}
        {messages.map((m) => {
          const issue = ticketOf[m.id]
          return (
            <EmailMessage key={m.id} message={m}
              sender={m.direction === 'outbound' ? senderOf(m.sent_by) : null}
              files={filesOf[m.id]} resent={resent.has(m.id)}
              onResend={mayWrite && mayResend(m, resent) ? () => resend(m) : null}
              ticket={issue
                ? { ref: issueRef(project, issue), title: issue.title, onOpen: () => onOpenIssue(issue.id) }
                : null} />
          )
        })}
      </Stack>
    </Stack>
  )
}

/**
 * The Inbox: the selected project's email, by person.
 *
 * Three columns — the people the project deals with, the emails with the one
 * picked, and who they are — so a support agent can read a customer's whole
 * history across tickets, write to them about one, and keep their contact
 * details straight, all in one place. Contacts have no page of their own; this
 * is where they are kept.
 *
 * Built from rows the app already has: `email_messages` on the project's
 * tickets, `project_contacts` (now grouped into `contacts`) and the tickets
 * themselves. The grouping is `lib/inbox.js`. Sending is `email-send`, as on a
 * ticket, with the recipient named.
 *
 * Below `lg` the contact's details open in a drawer; below `md` it is one
 * column at a time.
 */
export default function Inbox() {
  const { project, projectId, loading: projectLoading } = useProject()
  // Every status row, retired ones too: a ticket can still sit in one, and a
  // retired closed status is still closed.
  const { lists, loading: configLoading } = useConfig()
  const statuses = useMemo(() => lists.status ?? [], [lists.status])
  const { signal } = useRefreshSignal()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState({ contacts: [], addresses: [], issues: [], messages: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  // "Is it narrow?", so that where media queries are unknown (the tests) the
  // full three columns are what render.
  const narrow = useMediaQuery((t) => t.breakpoints.down('md'))
  const compact = useMediaQuery((t) => t.breakpoints.down('lg'))

  // Who is open, and which ticket is open over them, live in the address —
  // replaced, not pushed, as on Issues: neither is a place to go Back to.
  const setParam = useCallback((name, value) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (value) next.set(name, value)
    else next.delete(name)
    return next
  }, { replace: true }), [setParams])
  const selectedKey = params.get('contact')
  const select = useCallback((key) => setParam('contact', key), [setParam])
  // A ticket opens here, over the Inbox — the same dialog as on Issues.
  const openIssueId = params.get('issue')
  const openIssue = useCallback((id) => setParam('issue', id), [setParam])

  const load = useCallback(async () => {
    if (!projectId) { setRows({ contacts: [], addresses: [], issues: [], messages: [] }); setLoading(false); return }
    // Which statuses are closed comes from the configuration.
    if (configLoading) return
    setLoading(true)
    // Open tickets only: closed ones are fetched per person, when asked for.
    const closed = statuses.filter((st) => st.status_type === 'closed').map((st) => st.name)
    let openIssues = supabase.from('issues')
      .select('id, number, title, status, company, company_code, requester_name, requester_email, submitted_date, created_at')
      .eq('project_id', projectId)
    if (closed.length) {
      openIssues = openIssues.not('status', 'in', `(${closed.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',')})`)
    }
    const [c, a, i, m] = await Promise.all([
      supabase.from('contacts').select('id, name, notes, updated_at').eq('project_id', projectId),
      supabase.from('project_contacts').select('email, contact_id, last_seen_at')
        .eq('project_id', projectId),
      openIssues.order('submitted_date', { ascending: false }),
      // The list needs only who and when; a conversation reads its bodies.
      // Each row brings its ticket's reference, title and company along, so a
      // closed ticket can still be named and a person's company still known.
      supabase.from('email_messages')
        .select('id, issue_id, direction, status, from_email, from_name, to_emails, cc_emails, created_at, issues!inner(project_id, number, title, company, company_code, requester_email)')
        .eq('issues.project_id', projectId)
        .order('created_at', { ascending: false }).limit(MESSAGE_LIMIT),
    ])
    const failed = [c, a, i, m].find((r) => r.error)
    setError(failed ? failed.error.message : '')
    setRows({
      contacts: c.data ?? [], addresses: a.data ?? [],
      issues: (i.data ?? []).filter((x) => !closed.includes(x.status)),
      messages: m.data ?? [],
    })
    setLoading(false)
  }, [projectId, configLoading, statuses])

  useEffect(() => { load() }, [load, signal])

  const entries = useMemo(() => buildInbox(rows), [rows])
  const entry = entries.find((e) => e.key === selectedKey) ?? null

  // On a wide screen someone is always open; on a phone the list comes first.
  useEffect(() => {
    if (loading || narrow) return
    if (!entry && entries.length) select(entries[0].key)
  }, [loading, narrow, entry, entries, select])

  const changed = useCallback(async (key) => {
    await load()
    if (key) select(key)
  }, [load, select])

  if (!projectLoading && !projectId) return <NoProject />

  const list = <ContactList entries={entries} selectedKey={entry?.key} onSelect={select} loading={loading} />
  const conversation = (
    <Conversation entry={entry} project={project} issues={rows.issues} listed={rows.messages}
      compact={compact} onDetails={() => setDetailsOpen(true)}
      onBack={narrow ? () => select(null) : null} onSent={load} onOpenIssue={openIssue} />
  )
  const details = entry && (
    <ContactPanel entry={entry} entries={entries} project={project} issues={rows.issues}
      statuses={statuses} onChanged={changed} onOpenIssue={openIssue} />
  )

  return (
    <Stack spacing={2} sx={{ height: { md: 'calc(100dvh - 64px - 48px)' } }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Inbox</Typography>
          <Typography variant="body2" color="text.secondary">
            Every email with this project’s customers, by person — across all their tickets.
          </Typography>
        </Box>
        <Tooltip title="Check for new email">
          <span>
            <IconButton onClick={load} disabled={loading} aria-label="Refresh inbox"><RefreshIcon /></IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {narrow ? (
        <Paper sx={{ overflow: 'hidden' }}>
          {entry ? conversation : list}
        </Paper>
      ) : (
        <Paper data-inbox-columns sx={{
          flexGrow: 1, minHeight: 0, overflow: 'hidden', display: 'grid',
          gridTemplateColumns: compact ? '300px minmax(0, 1fr)' : '300px minmax(0, 1fr) 320px',
        }}>
          <Box sx={{ borderRight: 1, borderColor: 'divider', minHeight: 0 }}>{list}</Box>
          <Box sx={{ minHeight: 0 }}>{conversation}</Box>
          {!compact && (
            <Box sx={{ borderLeft: 1, borderColor: 'divider', overflowY: 'auto', minHeight: 0 }}>{details}</Box>
          )}
        </Paper>
      )}

      {compact && (
        <Drawer anchor="right" open={detailsOpen && Boolean(entry)} onClose={() => setDetailsOpen(false)}
          slotProps={{ paper: { sx: { width: { xs: '100%', sm: 360 } } } }}>
          <Stack direction="row" sx={{ justifyContent: 'flex-end', p: 1 }}>
            <IconButton aria-label="Close contact details" onClick={() => setDetailsOpen(false)}><CloseIcon /></IconButton>
          </Stack>
          {details}
        </Drawer>
      )}

      <IssueDetail issueId={openIssueId} open={Boolean(openIssueId)}
        onClose={() => openIssue(null)} onSaved={load} />
    </Stack>
  )
}
