import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Stack,
  TextField, Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CloseIcon from '@mui/icons-material/Close'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'

const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']

export const EMPTY_ISSUE = {
  type: '', product: '', area: '', priority: '', title: '', description: '',
  company: '', requester_name: '', requester_email: '', source_url: '',
}

/**
 * The support request form, shared by the public embed page and the internal
 * "Create issue" dialog.
 *
 * `hidden`    — fields the embedder supplied deliberately: filled in AND removed
 *               from the form.
 * `defaults`  — starting values that stay visible and editable. Auto-detected
 *               context (such as the embedding page's URL) belongs here, not in
 *               `hidden`, so the user can still see and correct it.
 * `projectId` — which project the ticket is filed against. The embed form takes
 *               it from the key in its URL; the internal dialog from whichever
 *               project the person is working in. There is no default: a ticket
 *               with no project is one nobody would ever see.
 * `children`  — extra fields the caller wants above the request details, used by
 *               the internal dialog for its project picker.
 */
export default function IssueForm({
  hidden = {},
  defaults = {},
  projectId,
  submitLabel = 'Submit request',
  onSubmitted,
  children,
}) {
  const { lists, loading: configLoading } = useConfig()
  const [values, setValues] = useState({ ...EMPTY_ISSUE, ...defaults, ...hidden })
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef(null)

  // Priority is optional, but the form opens on the first configured priority
  // rather than an empty box. The list is ordered by sort_order, so "first"
  // means whatever sits at the top of the Configuration → Priorities tab.
  const defaultPriority = useMemo(
    () => (lists.priority ?? []).find((o) => o.is_active)?.name ?? '',
    [lists.priority],
  )

  const seed = useMemo(
    () => ({
      ...EMPTY_ISSUE,
      ...(defaultPriority ? { priority: defaultPriority } : {}),
      // An explicitly supplied value always wins over the pre-selection.
      ...defaults,
      ...hidden,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultPriority, JSON.stringify(defaults), JSON.stringify(hidden)],
  )
  useEffect(() => setValues(seed), [seed])

  const isHidden = (field) => field in hidden
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  const addFiles = (e) => {
    setError('')
    const picked = Array.from(e.target.files ?? [])
    const next = [...files]
    for (const f of picked) {
      if (next.length >= MAX_FILES) { setError(`You can attach at most ${MAX_FILES} files.`); break }
      if (!ACCEPT.includes(f.type)) { setError(`${f.name} is not a PDF or image.`); continue }
      if (f.size > MAX_BYTES) { setError(`${f.name} is larger than 10MB.`); continue }
      next.push(f)
    }
    setFiles(next)
    e.target.value = ''   // allow re-picking the same file
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      if (!projectId) throw new Error('Choose a project for this request.')
      const { data: issue, error: insertErr } = await supabase
        .from('issues')
        .insert({
          ...values,
          project_id: projectId,
          title: values.title.trim(),
          requester_email: values.requester_email.trim() || null,
          source_url: values.source_url.trim() || null,
          submitted_date: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (insertErr) throw insertErr

      for (const file of files) {
        const path = `${issue.id}/${crypto.randomUUID()}-${file.name}`
        const { error: upErr } = await supabase.storage
          .from('attachments').upload(path, file, { contentType: file.type })
        if (upErr) throw upErr
        const { error: attErr } = await supabase.from('attachments').insert({
          issue_id: issue.id, file_name: file.name, file_path: path,
          mime_type: file.type, size_bytes: file.size,
        })
        if (attErr) throw attErr
      }
      setValues(seed); setFiles([])
      onSubmitted?.(issue.id)
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (configLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 240 }}><CircularProgress /></Box>
  }

  // Plain functions, not components — a component defined during render gets a
  // new identity each pass, which remounts the input and drops focus.
  const selectField = ({ field, label, options, required }) =>
    isHidden(field) ? null : (
      <TextField
        key={field} select fullWidth label={label} value={values[field]}
        onChange={set(field)} required={required} size="small"
      >
        {options.filter((o) => o.is_active).map((o) => (
          <MenuItem key={o.id} value={o.name}>{o.name}</MenuItem>
        ))}
      </TextField>
    )

  const textField = ({ field, label, ...rest }) =>
    isHidden(field) ? null : (
      <TextField
        key={field} fullWidth size="small" label={label} value={values[field]}
        onChange={set(field)} {...rest}
      />
    )

  const requestSection = ['type', 'product', 'area', 'priority'].some((f) => !isHidden(f))
  const submissionSection = ['company', 'requester_name', 'requester_email', 'source_url']
    .some((f) => !isHidden(f))

  return (
    <form onSubmit={submit}>
      <Stack spacing={3}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {children}

        {requestSection && (
          <Section title="Request details">
            {selectField({ field: 'type',     label: 'Type',     options: lists.type ?? [],     required: true })}
            {selectField({ field: 'product',  label: 'Product',  options: lists.product ?? [],  required: true })}
            {selectField({ field: 'area',     label: 'Area',     options: lists.area ?? [] })}
            {selectField({ field: 'priority', label: 'Priority', options: lists.priority ?? [] })}
          </Section>
        )}

        <Section title="Issue details">
          {textField({ field: 'title', label: 'Title', required: true })}
          {textField({ field: 'description', label: 'Description', multiline: true, minRows: 4, required: true })}

          <Box>
            <Button
              startIcon={<AttachFileIcon />} variant="outlined" size="small"
              onClick={() => fileInput.current?.click()}
              disabled={files.length >= MAX_FILES}
            >
              Attach files
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
              PDF or images · up to {MAX_FILES} files · 10MB each
            </Typography>
            <input ref={fileInput} type="file" hidden multiple
              accept={ACCEPT.join(',')} onChange={addFiles} />
            {files.length > 0 && (
              <Stack direction="row" sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
                {files.map((f, i) => (
                  <Chip key={`${f.name}-${i}`} label={f.name} size="small"
                    onDelete={() => setFiles(files.filter((_, j) => j !== i))}
                    deleteIcon={<CloseIcon />} />
                ))}
              </Stack>
            )}
          </Box>
        </Section>

        {submissionSection && (
          <Section title="Submission details">
            {textField({ field: 'company', label: 'Company', required: true })}
            {textField({ field: 'requester_name', label: 'Requester name', required: true })}
            {textField({ field: 'requester_email', label: 'Requester email', type: 'email', required: true })}
            {textField({
              field: 'source_url', label: 'Source URL',
              placeholder: 'https://…',
              helperText: 'Where the request came from — a page, an email thread, a ticket link.',
            })}
          </Section>
        )}

        <Button type="submit" variant="contained" size="large" disabled={busy || !projectId}>
          {busy ? 'Submitting…' : submitLabel}
        </Button>
      </Stack>
    </form>
  )
}

function Section({ title, children }) {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack spacing={2}>{children}</Stack>
    </Box>
  )
}
