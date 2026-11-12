import { useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import LockIcon from '@mui/icons-material/Lock'
import { supabase } from '../lib/supabase'
import { removeAttachmentFiles, uploadFile } from '../lib/storage'
import { ACCEPT, ATTACH_HINT, MAX_FILES } from '../lib/attachments'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { isEmptyDoc, normalizeDoc } from '../lib/richText'
import { MAX_CC, parseRecipients, signatureDoc } from '../lib/email'
import { completeRecipient, contactLabel, suggestContacts, typedRecipient } from '../lib/contacts'
import AttachmentGallery from './AttachmentGallery'
import useAttachmentDraft from './useAttachmentDraft'
import useProjectContacts from './useProjectContacts'
import TemplatePicker from './TemplatePicker'
import RichTextEditor, { RichTextView } from './RichTextEditor'
import { isSubmitChord, MOD_KEY_LABEL } from './composer'

/**
 * Reads the error an Edge Function answered with. invoke() reports any non-2xx
 * as a FunctionsHttpError whose `context` is the response; the sentence worth
 * showing is in its body.
 */
export async function functionError(error) {
  try {
    const body = await error.context?.json?.()
    if (body?.error) return body.error
  } catch { /* not JSON — fall through */ }
  return error.message
}

/** One labelled line above the box: "To", "Subject", "Ticket". */
export function ComposerLine({ label, children }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 52 }}>{label}</Typography>
      {children}
    </Stack>
  )
}

/**
 * The box an email to a customer is written in — on a ticket's Conversation
 * tab and in the Inbox alike. What it is about (`issueId`) and who it goes to
 * are the caller's to show in `header`; this is the Cc, the text with its
 * signature, files, templates and the send.
 *
 * The draft goes to `email-send` as a document — never HTML — with no subject
 * and no signature: the function decides both. `to` is sent only when the
 * caller names a recipient (`sendTo`); without it the email goes to the
 * ticket's requester, which is what the Conversation tab always means.
 *
 * `ready` lets the caller hold the send back (no ticket picked yet).
 */
export default function EmailComposer({
  issueId, projectId, to, sendTo = null, header = null, ready = true, onSent, onError,
}) {
  const { profile } = useAuth()
  const { templates } = useConfig()
  const [draft, setDraft] = useState(() => normalizeDoc(null))
  const [ccText, setCcText] = useState('')
  const [busy, setBusy] = useState(false)
  const attach = useAttachmentDraft(onError)
  const fileInput = useRef(null)
  const editor = useRef(null)
  const contacts = useProjectContacts(projectId)

  const cc = parseRecipients(ccText)
  const ccProblem = cc.invalid.length
    ? `Not an email address: ${cc.invalid.join(', ')}`
    : cc.valid.length > MAX_CC ? `At most ${MAX_CC} people can be copied` : ''

  // Addresses the project has met that would complete the one being typed —
  // never the recipient (already on the To line) or anyone already copied.
  const ccSuggestions = suggestContacts(contacts.contacts, typedRecipient(ccText),
    { exclude: [to, ...cc.valid] })

  const canSend = ready && Boolean(issueId) && !busy && !ccProblem && !isEmptyDoc(draft)

  // A template is written in at the caret like a paste, formatting and all.
  const insertTemplate = (doc) => editor.current?.insertDoc(doc)

  const send = async () => {
    if (!canSend) return
    setBusy(true); onError?.('')
    // The files go up first: `email-send` reads them from the bucket and
    // records them against the email once it has actually gone. Whatever was
    // uploaded for a send that then fails is tidied away again.
    const uploaded = []
    try {
      for (const file of attach.files) uploaded.push(await uploadFile(file, issueId))
    } catch (err) {
      await removeAttachmentFiles(uploaded.map((u) => u.path))
      setBusy(false)
      return onError?.(`A file did not upload, so nothing was sent: ${err.message}`)
    }
    const { error } = await supabase.functions.invoke('email-send', {
      // The document, not HTML: `email-send` checks it and builds the email.
      // No signature either — that is read from your profile there.
      body: {
        issue_id: issueId, doc: draft, cc: cc.valid, attachments: uploaded,
        ...(sendTo ? { to: sendTo } : {}),
      },
    })
    if (error) {
      await removeAttachmentFiles(uploaded.map((u) => u.path))
      setBusy(false)
      return onError?.(await functionError(error))
    }
    setBusy(false)
    editor.current?.clear(); setCcText(''); attach.clear()
    onSent?.()
    // Whoever was just copied is now one of the project's addresses.
    if (cc.valid.length) contacts.reload()
  }

  return (
    <Stack spacing={1}>
      {header}
      {/* Still one line of addresses; the suggestions complete the one being
          typed, from the addresses this project has met. */}
      <Autocomplete freeSolo size="small" disableClearable
        options={ccSuggestions}
        filterOptions={(o) => o}
        getOptionLabel={(o) => (typeof o === 'string' ? o : o.email)}
        renderOption={({ key, ...props }, o) => (
          <li key={key} {...props}>{contactLabel(o)}</li>
        )}
        value={null}
        inputValue={ccText}
        onInputChange={(_e, v, reason) => { if (reason === 'input') setCcText(v) }}
        onChange={(_e, picked) => {
          if (picked && typeof picked === 'object') setCcText(completeRecipient(ccText, picked.email))
        }}
        renderInput={(params) => (
          <TextField {...params} label="Cc" placeholder="Optional — separate addresses with commas"
            error={Boolean(ccProblem)} helperText={ccProblem || undefined} />
        )} />
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
          onPick={insertTemplate} onError={onError} />
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.disabled"
          sx={{ display: { xs: 'none', sm: 'inline' } }}>
          {MOD_KEY_LABEL}+Enter to send
        </Typography>
        <Button size="small" variant="contained" onClick={send} disabled={!canSend}>
          {busy ? 'Sending…' : 'Send email'}
        </Button>
      </Stack>
    </Stack>
  )
}
