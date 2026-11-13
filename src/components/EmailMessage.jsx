import { useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CallReceivedIcon from '@mui/icons-material/CallReceived'
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumberOutlined'
import ReplayIcon from '@mui/icons-material/Replay'
import { ago, formatDateTime } from '../lib/format'
import { displayName } from '../lib/users'
import { isEmptyDoc, normalizeDoc } from '../lib/richText'
import { deliveryOf, messageText } from '../lib/email'
import UserAvatar from './UserAvatar'
import AttachmentGallery from './AttachmentGallery'
import { RichTextView } from './RichTextEditor'

/**
 * One email in a thread — a ticket's Conversation tab, or a person's
 * conversation in the Inbox. `sender` is the profile of whoever sent an
 * outbound one; `files` its gallery items. `ticket` ({ ref, title, onOpen })
 * names the ticket it was filed on, and opens it — which only the Inbox needs:
 * there one person's emails span many tickets.
 *
 * `onResend` (async, answers when done) puts a "Send again" button on a
 * message that was not delivered — the caller offers it only where
 * `mayResend` agrees and the viewer may email. `resent` marks one that already
 * has been, whose resend is the newer card.
 */
export default function EmailMessage({ message: m, sender, files, ticket, onResend, resent = false }) {
  const [resending, setResending] = useState(false)
  const resend = async () => {
    setResending(true)
    try { await onResend() } finally { setResending(false) }
  }
  const outbound = m.direction === 'outbound'
  const name = outbound
    ? displayName(sender, m.from_name || 'Support')
    : (m.from_name || m.from_email || 'Customer')
  const delivery = deliveryOf(m)
  const text = messageText(m)
  return (
    <Paper data-email-message={m.direction}
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
            {onResend && (
              <Tooltip title={`Send this email again, as it was, to ${[...(m.to_emails ?? []), ...(m.cc_emails ?? [])].join(', ')}`}>
                <span>
                  <Button size="small" startIcon={<ReplayIcon />} onClick={resend} disabled={resending}
                    data-resend-email={m.id} sx={{ py: 0 }}>
                    {resending ? 'Sending…' : 'Send again'}
                  </Button>
                </span>
              </Tooltip>
            )}
            {resent && m.status === 'failed' && (
              <Typography variant="caption" color="text.secondary">Sent again</Typography>
            )}
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
          {ticket && (
            <Chip size="small" variant="outlined" clickable onClick={ticket.onOpen}
              data-email-ticket={ticket.ref}
              icon={<ConfirmationNumberIcon sx={{ fontSize: 16 }} />}
              label={ticket.title ? `${ticket.ref} · ${ticket.title}` : ticket.ref}
              sx={{ mt: 0.75, maxWidth: '100%' }} />
          )}
          {/* A sent email is drawn from its document, with its formatting; a
              received one as what its sender typed — signature included,
              earlier messages left out, since each of those is a card of its
              own. */}
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
          {/* On a received email this is a note, not a failure: what the
              customer sent that could not be kept. */}
          {m.status === 'received' && m.error && (
            <Alert severity="warning" sx={{ mt: 1, py: 0 }}>{m.error}</Alert>
          )}
          {files?.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <AttachmentGallery items={files} size="small" />
            </Box>
          )}
        </Box>
      </Stack>
    </Paper>
  )
}

/**
 * Who spoke last and how long ago — whether the ball is in our court or the
 * customer's: an in/out arrow and "1d 2h". Small enough for a tab's label or a
 * row in the Inbox, so it reads without opening the thread. Re-reads the clock
 * each minute, as the page may stay open.
 */
export function LastEmail({ message }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  if (!message) return null
  const outbound = message.direction === 'outbound'
  const Arrow = outbound ? CallMadeIcon : CallReceivedIcon
  return (
    <Tooltip title={`Last email ${outbound ? 'sent' : 'received'} ${formatDateTime(message.created_at)}`}>
      <Stack component="span" direction="row" spacing={0.25} data-last-email={message.direction}
        sx={{ alignItems: 'center', color: outbound ? 'primary.main' : 'info.main', flexShrink: 0 }}>
        <Arrow sx={{ fontSize: 14 }} />
        <Typography component="span" variant="caption" sx={{ fontWeight: 600 }}>
          {ago(message.created_at, now)}
        </Typography>
      </Stack>
    </Tooltip>
  )
}
