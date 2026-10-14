import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, IconButton, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import LockIcon from '@mui/icons-material/Lock'
import RefreshIcon from '@mui/icons-material/Refresh'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CallReceivedIcon from '@mui/icons-material/CallReceived'
import { supabase } from '../lib/supabase'
import { removeAttachmentFiles, signAttachments, uploadFile } from '../lib/storage'
import { ACCEPT, ATTACH_HINT, MAX_FILES } from '../lib/attachments'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { formatDateTime } from '../lib/format'
import { can } from '../lib/permissions'
import { displayName } from '../lib/users'
import { isEmptyDoc, normalizeDoc } from '../lib/richText'
import {
  deliveryOf, isEmail, MAX_CC, messageText, newestFirst, parseRecipients, signatureDoc,
  ticketSubject,
} from '../lib/email'
import UserAvatar from './UserAvatar'
import AttachmentGallery from './AttachmentGallery'
import useAttachmentDraft from './useAttachmentDraft'
import TemplatePicker from './TemplatePicker'
import RichTextEditor, { RichTextView } from './RichTextEditor'
import { isSubmitChord, MOD_KEY_LABEL } from './composer'

/**
 * Reads the error an Edge Function answered with. invoke() reports any non-2xx
 * as a FunctionsHttpError whose `context` is the response; the sentence worth
 * showing is in its body.
 */
async function functionError(error) {
  try {
    const body = await error.context?.json?.()
    if (body?.error) return body.error
  } catch { /* not JSON — fall through */ }
  return error.message
}

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
 * in the message above it.
 */
export default function ConversationThread({ issue, ticketRef, onCount }) {
  const { profile } = useAuth()
  const { users, templates } = useConfig()
  const [messages, setMessages] = useState([])
  const [filesOf, setFilesOf] = useState({}) // message id → gallery items
  const [draft, setDraft] = useState(() => normalizeDoc(null))
  const [ccText, setCcText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const attach = useAttachmentDraft(setError)
  const fileInput = useRef(null)
  const editor = useRef(null)
  const issueId = issue?.id

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

  const senderOf = useMemo(() => {
    const map = Object.fromEntries(users.map((u) => [u.id, u]))
    return (id) => map[id]
  }, [users])

  const mayWrite = can.emailCustomer(profile)
  const to = (issue?.requester_email ?? '').trim()
  const reachable = isEmail(to)
  const subject = ticketSubject(ticketRef, issue?.title)
  const cc = parseRecipients(ccText)
  const ccProblem = cc.invalid.length
    ? `Not an email address: ${cc.invalid.join(', ')}`
    : cc.valid.length > MAX_CC ? `At most ${MAX_CC} people can be copied` : ''

  const canSend = mayWrite && reachable && !busy && !ccProblem && !isEmptyDoc(draft)

  // A template is plain text, written in at the caret like a paste.
  const insertTemplate = (text) => editor.current?.insertText(text)

  const send = async () => {
    if (!canSend) return
    setBusy(true); setError('')
    // The files go up first: `email-send` reads them from the bucket and
    // records them against the email once it has actually gone. Whatever was
    // uploaded for a send that then fails is tidied away again.
    const uploaded = []
    try {
      for (const file of attach.files) uploaded.push(await uploadFile(file, issueId))
    } catch (err) {
      await removeAttachmentFiles(uploaded.map((u) => u.path))
      setBusy(false)
      return setError(`A file did not upload, so nothing was sent: ${err.message}`)
    }
    const { error } = await supabase.functions.invoke('email-send', {
      // The document, not HTML: `email-send` checks it and builds the email.
      // No signature either — that is read from your profile there.
      body: { issue_id: issueId, doc: draft, cc: cc.valid, attachments: uploaded },
    })
    if (error) {
      await removeAttachmentFiles(uploaded.map((u) => u.path))
      setBusy(false)
      return setError(await functionError(error))
    }
    setBusy(false)
    editor.current?.clear(); setCcText(''); attach.clear(); load()
  }

  return (
    <Stack spacing={1.5}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {mayWrite && (
        <Paper sx={{ p: 1.5 }}>
          {reachable ? (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 52 }}>To</Typography>
                <Typography variant="body2">
                  {issue.requester_name ? `${issue.requester_name} <${to}>` : to}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 52 }}>Subject</Typography>
                <Typography variant="body2">{subject}</Typography>
              </Stack>
              <TextField size="small" label="Cc" placeholder="Optional — separate addresses with commas"
                value={ccText} onChange={(e) => setCcText(e.target.value)}
                error={Boolean(ccProblem)} helperText={ccProblem || undefined} />
              <RichTextEditor ref={editor}
                placeholder="Write to the customer…"
                ariaLabel="Email to the customer"
                onChange={setDraft}
                onPasteFiles={attach.onPaste}
                disabled={busy}
                onKeyDown={(e) => {
                  if (!isSubmitChord(e)) return
                  e.preventDefault()
                  send()
                }}
                footer={
                  <Tooltip placement="top-start"
                    title="Added to every email you send. Change it on your Profile page.">
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}
                      data-email-signature>
                      <RichTextView doc={signatureDoc(profile)} sx={{ flexGrow: 1, color: 'text.secondary' }} />
                      <LockIcon sx={{ fontSize: 14, color: 'text.disabled', mt: 0.25 }} />
                    </Stack>
                  </Tooltip>
                }
              />
              {attach.previews.length > 0 && (
                <AttachmentGallery items={attach.previews} size="small" onRemove={attach.remove} />
              )}
              <input ref={fileInput} type="file" hidden multiple
                accept={ACCEPT.join(',')} onChange={attach.onPick} />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Tooltip title={`Attach files — or paste a screenshot. ${ATTACH_HINT}`}>
                  <span>
                    <IconButton size="small" aria-label="Attach files"
                      onClick={() => fileInput.current?.click()}
                      disabled={busy || attach.files.length >= MAX_FILES}>
                      <AttachFileIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <TemplatePicker templates={templates} disabled={busy}
                  onPick={insertTemplate} onError={setError} />
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="caption" color="text.disabled">
                  {MOD_KEY_LABEL}+Enter to send
                </Typography>
                <Button size="small" variant="contained" onClick={send} disabled={!canSend}>
                  {busy ? 'Sending…' : 'Send email'}
                </Button>
              </Stack>
            </Stack>
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
        {messages.map((m) => {
          const outbound = m.direction === 'outbound'
          const sender = outbound ? senderOf(m.sent_by) : null
          const name = outbound
            ? displayName(sender, m.from_name || 'Support')
            : (m.from_name || m.from_email || 'Customer')
          const delivery = deliveryOf(m)
          const text = messageText(m)
          return (
            <Paper key={m.id} data-email-message={m.direction}
              sx={{ p: 1.5, borderLeft: 3, borderLeftColor: outbound ? 'primary.main' : 'info.main' }}>
              <Stack direction="row" spacing={1.5}>
                <UserAvatar user={sender} name={name} size={30} />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {outbound
                      ? <CallMadeIcon sx={{ fontSize: 14, color: 'primary.main' }} titleAccess="Sent" />
                      : <CallReceivedIcon sx={{ fontSize: 14, color: 'info.main' }} titleAccess="Received" />}
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
                    {!outbound && m.from_email && m.from_name && (
                      <Typography variant="caption" color="text.secondary">{m.from_email}</Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(m.created_at)}
                    </Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <Tooltip title={m.status === 'failed' && m.error ? m.error : delivery.hint}>
                      <Chip size="small" variant="outlined" label={delivery.label} color={delivery.color} />
                    </Tooltip>
                  </Stack>
                  {/* Who else saw it: everyone on a sent one, the copied on a
                      received one (it was to us). */}
                  {(outbound || m.cc_emails?.length > 0) && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {outbound
                        ? `To ${[...(m.to_emails ?? []), ...(m.cc_emails ?? [])].join(', ')}`
                        : `Cc ${m.cc_emails.join(', ')}`}
                    </Typography>
                  )}
                  {/* A sent email is drawn from its document, with its
                      formatting; a received one as what its sender typed —
                      signature included, earlier messages left out, since each
                      of those is a card of its own. */}
                  {outbound && m.body_doc && !isEmptyDoc(normalizeDoc(m.body_doc))
                    ? <RichTextView doc={m.body_doc} sx={{ mt: 0.75 }} />
                    : text
                    ? (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.75, wordBreak: 'break-word' }}>
                        {text}
                      </Typography>
                    )
                    : (
                      <Typography variant="body2" color="text.disabled" sx={{ mt: 0.75 }}>
                        <em>No text in this email.</em>
                      </Typography>
                    )}
                  {/* On a received email this is a note, not a failure: what
                      the customer sent that could not be kept. */}
                  {m.status === 'received' && m.error && (
                    <Alert severity="warning" sx={{ mt: 1, py: 0 }}>{m.error}</Alert>
                  )}
                  {filesOf[m.id]?.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <AttachmentGallery items={filesOf[m.id]} size="small" />
                    </Box>
                  )}
                </Box>
              </Stack>
            </Paper>
          )
        })}
      </Stack>
    </Stack>
  )
}
