import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { supabase } from '../lib/supabase'
import { signAttachments } from '../lib/storage'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { can } from '../lib/permissions'
import { isEmail, latestMessage, newestFirst, ticketSubject } from '../lib/email'
import EmailComposer, { ComposerLine } from './EmailComposer'
import EmailMessage, { LastEmail } from './EmailMessage'

// Where it has always been imported from.
export { LastEmail }

/**
 * The email thread with the requester — the ticket's Conversation tab.
 *
 * Laid out like the comment thread on purpose: a composer on top, the newest
 * message under it. What differs is who reads it. A comment is the team
 * talking to itself; everything written here goes to the customer's inbox, so
 * the composer says who it is going to and under what subject before anything
 * is sent.
 *
 * Every message is sent and received server-side (`email-send`,
 * `email-webhook`); this only reads the thread and hands a draft over. The
 * thread shows what a person wrote — the quoted history underneath is already
 * in the message above it. The composer and the message cards are the Inbox's
 * too (`EmailComposer`, `EmailMessage`).
 */
export default function ConversationThread({ issue, ticketRef, onCount, onLast }) {
  const { profile } = useAuth()
  const { users } = useConfig()
  const [messages, setMessages] = useState([])
  const [filesOf, setFilesOf] = useState({}) // message id → gallery items
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const issueId = issue?.id
  const mayWrite = can.emailCustomer(profile)

  const load = useCallback(async () => {
    if (!issueId) return
    setLoading(true)
    const [{ data, error }, { data: rows }] = await Promise.all([
      supabase.from('email_messages').select('*').eq('issue_id', issueId)
        .order('created_at', { ascending: false }),
      supabase.from('attachments').select('*').eq('issue_id', issueId)
        .not('email_message_id', 'is', null).order('created_at'),
    ])
    if (error) setError(error.message)
    setMessages(newestFirst(data ?? []))
    const items = await signAttachments(rows ?? [])
    const grouped = {}
    rows?.forEach((r, i) => { (grouped[r.email_message_id] ??= []).push(items[i]) })
    setFilesOf(grouped)
    setLoading(false)
  }, [issueId])

  useEffect(() => { load() }, [load])
  useEffect(() => { onCount?.(messages.length) }, [messages.length, onCount])

  const last = latestMessage(messages)
  useEffect(() => { onLast?.(last) }, [last, onLast])

  const senderOf = useMemo(() => {
    const map = Object.fromEntries(users.map((u) => [u.id, u]))
    return (id) => map[id]
  }, [users])

  const to = (issue?.requester_email ?? '').trim()
  const reachable = isEmail(to)
  const subject = ticketSubject(ticketRef, issue?.title)

  return (
    <Stack spacing={1.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {mayWrite && (
        <Paper sx={{ p: 1.5 }}>
          {reachable ? (
            <EmailComposer issueId={issueId} projectId={issue?.project_id} to={to}
              onSent={load} onError={setError}
              header={<>
                <ComposerLine label="To">
                  <Typography variant="body2">
                    {issue.requester_name ? `${issue.requester_name} <${to}>` : to}
                  </Typography>
                </ComposerLine>
                <ComposerLine label="Subject">
                  <Typography variant="body2">{subject}</Typography>
                </ComposerLine>
              </>} />
          ) : (
            <Alert severity="info">
              This ticket has no requester email, so there is nobody to write to.
            </Alert>
          )}
        </Paper>
      )}

      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {mayWrite
            ? 'Emails go to the customer. Their replies appear here on their own.'
            : 'The email thread with the customer. Ask an admin if you need to send from here.'}
        </Typography>
        <Tooltip title="Check for new email">
          <span>
            <IconButton size="small" onClick={load} disabled={loading} aria-label="Refresh conversation">
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {!loading && messages.length === 0 && (
        <Typography variant="caption" color="text.disabled">
          No emails on this ticket yet.
        </Typography>
      )}

      <Stack spacing={1}>
        {messages.map((m) => (
          <EmailMessage key={m.id} message={m}
            sender={m.direction === 'outbound' ? senderOf(m.sent_by) : null}
            files={filesOf[m.id]} />
        ))}
      </Stack>
    </Stack>
  )
}
