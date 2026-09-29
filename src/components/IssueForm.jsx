import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, CircularProgress, Divider, MenuItem,
  Stack, TextField, Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import { supabase } from '../lib/supabase'
import { useConfig, PUBLIC_SOURCE } from '../context/ConfigContext'
import { toInputDateTime } from '../lib/format'
import { activeCompanies, findCompany } from '../lib/companies'
import { SeverityOption, SeverityValue } from './SeverityOption'
import AttachmentGallery from './AttachmentGallery'

const MAX_FILES = 5
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const DOC_TYPES = ['application/pdf']
// A screen recording is often the clearest bug report there is, so video is
// worth the extra room — but only the containers a browser can play back.
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const ACCEPT = [...IMAGE_TYPES, ...DOC_TYPES, ...VIDEO_TYPES]

const MAX_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 30 * 1024 * 1024
// The storage bucket allows the larger of the two; the per-type limit is here,
// so a 30MB screenshot is still refused.
const limitFor = (type) => (VIDEO_TYPES.includes(type) ? MAX_VIDEO_BYTES : MAX_BYTES)
const asMb = (bytes) => Math.round(bytes / (1024 * 1024))
// Null where there is no object URL support (tests); the tile falls back to an icon.
const objectUrl = (file) => {
  try { return URL.createObjectURL(file) } catch { return null }
}

export const EMPTY_ISSUE = {
  type: '', product: '', area: '', priority: '', title: '', description: '',
  company: '', requester_name: '', requester_email: '', source_url: '',
}

// Staff-only fields. The public form neither shows nor sends them: `source` is
// stamped `Form` by the database, the submission date is the moment it arrives,
// labels are the team's own triage vocabulary, and severity is the team's own
// judgement — the database drops one sent by an anonymous submission.
const EMPTY_STAFF = { source: '', labels: [], severity: '', submitted_date: '' }

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
 * `staff`     — this is the internal dialog rather than the public form: the
 *               person filling it in is logging somebody else's request, so they
 *               also say which channel it came through, when it arrived, and
 *               which labels it starts with — and must attach the original
 *               request as evidence.
 */
export default function IssueForm({
  hidden = {},
  defaults = {},
  projectId,
  staff = false,
  submitLabel = 'Submit request',
  onSubmitted,
  children,
}) {
  const { lists, companies, loading: configLoading } = useConfig()
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

  // A company may arrive as a code (`?company=wupi`), which is what an embed
  // link carries. Whatever comes in, the form holds the display name.
  const resolvedCompany = (value) => findCompany(companies, value)?.name ?? value

  const seed = useMemo(
    () => ({
      ...EMPTY_ISSUE,
      // The date opens on "now" and is the only staff field that starts filled.
      ...(staff ? { ...EMPTY_STAFF, submitted_date: toInputDateTime(new Date()) } : {}),
      ...(defaultPriority ? { priority: defaultPriority } : {}),
      // An explicitly supplied value always wins over the pre-selection.
      ...defaults,
      ...hidden,
      ...(defaults.company || hidden.company
        ? { company: resolvedCompany(hidden.company ?? defaults.company) }
        : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultPriority, staff, companies, JSON.stringify(defaults), JSON.stringify(hidden)],
  )
  useEffect(() => setValues(seed), [seed])

  const isHidden = (field) => field in hidden
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  // The one gate every attachment goes through, whatever brought it here: the
  // file picker, or a screenshot pasted into the description.
  const acceptFiles = (picked) => {
    setError('')
    const next = [...files]
    for (const f of picked) {
      if (next.length >= MAX_FILES) { setError(`You can attach at most ${MAX_FILES} files.`); break }
      if (!ACCEPT.includes(f.type)) { setError(`${f.name} is not a PDF, image or video.`); continue }
      if (f.size > limitFor(f.type)) {
        setError(`${f.name} is larger than ${asMb(limitFor(f.type))}MB.`); continue
      }
      next.push(f)
    }
    setFiles(next)
  }

  // Local previews of what is about to be uploaded. Each object URL is released
  // when its file leaves the list, or the form goes away.
  const previews = useMemo(() => files.map((f, i) => ({
    key: `${f.name}-${f.size}-${i}`, name: f.name, mime: f.type, size: f.size,
    // Only images get a preview URL; a video or PDF tile is just an icon.
    url: f.type.startsWith('image/') ? objectUrl(f) : null,
  })), [files])
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews])

  const addFiles = (e) => {
    acceptFiles(Array.from(e.target.files ?? []))
    e.target.value = ''   // allow re-picking the same file
  }

  // A pasted screenshot arrives as a file the clipboard names `image.png` — the
  // same name every time — so it is renamed to keep five of them apart.
  const pastedName = (file) => {
    // Milliseconds included: two screenshots pasted a second apart must not
    // land on the same name.
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '')
    const ext = file.name?.match(/\.[a-z0-9]+$/i)?.[0]
      ?? `.${(file.type.split('/')[1] ?? 'png')}`
    return `pasted-${stamp}${ext}`
  }

  // Pasting into the description: a screenshot becomes an attachment, ordinary
  // text is left alone for the browser to paste as usual.
  const pasteFiles = (e) => {
    const picked = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter(Boolean)
    if (picked.length === 0) return
    e.preventDefault()
    acceptFiles(picked.map((f) => (
      f.type.startsWith('image/') ? new File([f], pastedName(f), { type: f.type }) : f
    )))
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      if (!projectId) throw new Error('Choose a project for this request.')
      // Staff are logging somebody else's request, so the ticket has to carry
      // the customer's own words — the email, the chat, the screenshot.
      if (staff && files.length === 0) {
        throw new Error("Attach the customer's original request before creating the ticket.")
      }
      // The id is minted here, not read back: `.select()` after an insert needs
      // a SELECT policy, and anon deliberately has none — asking for the row
      // back is what fails a public submission with 42501.
      const issueId = crypto.randomUUID()
      const { error: insertErr } = await supabase
        .from('issues')
        .insert({
          ...values,
          id: issueId,
          project_id: projectId,
          title: values.title.trim(),
          ...(staff ? {
            source: values.source || null,
            labels: values.labels ?? [],
            severity: values.severity || null,
          } : {}),
          // The name is what everyone reads; the code is what survives a rename.
          // The database resolves one from the other either way.
          company_code: findCompany(companies, values.company)?.code ?? null,
          requester_email: values.requester_email.trim() || null,
          source_url: values.source_url.trim() || null,
          // A public submission happens now; a staff one records when the
          // request actually arrived. The database enforces both.
          submitted_date: staff && values.submitted_date
            ? new Date(values.submitted_date).toISOString()
            : new Date().toISOString(),
        })
      if (insertErr) throw insertErr

      for (const file of files) {
        const path = `${issueId}/${crypto.randomUUID()}-${file.name}`
        const { error: upErr } = await supabase.storage
          .from('attachments').upload(path, file, { contentType: file.type })
        if (upErr) throw upErr
        const { error: attErr } = await supabase.from('attachments').insert({
          issue_id: issueId, file_name: file.name, file_path: path,
          mime_type: file.type, size_bytes: file.size,
        })
        if (attErr) throw attErr
      }
      setValues(seed); setFiles([])
      onSubmitted?.(issueId)
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
  const selectField = ({ field, label, options, required, ...rest }) =>
    isHidden(field) ? null : (
      <TextField
        key={field} select fullWidth label={label} value={values[field]}
        onChange={set(field)} required={required} size="small" {...rest}
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

  // Companies are picked, never typed. The value stored is the display name;
  // `findCompany` is what turns a code from a link into one.
  const companyOptions = activeCompanies(companies)
  const companyField = () => {
    if (isHidden('company')) return null
    const current = values.company ?? ''
    const known = companyOptions.some((c) => c.name === current)
    return (
      <TextField
        select fullWidth size="small" label="Company" required
        value={current}
        onChange={set('company')}
        helperText={companyOptions.length === 0
          ? 'No companies are set up yet — ask an admin to add one.'
          : undefined}
      >
        {/* An unrecognised value (an old ticket, a stale link) keeps its place
            in the list rather than disappearing when the form re-renders. */}
        {current && !known && <MenuItem value={current}>{current}</MenuItem>}
        {companyOptions.map((c) => (
          <MenuItem key={c.id} value={c.name}>{c.name}</MenuItem>
        ))}
      </TextField>
    )
  }

  // Severity reads as a promise: the open list shows each one's behaviour, the
  // closed field just the name that was chosen.
  const severityField = () => (
    <TextField
      select fullWidth size="small" label="Severity" value={values.severity ?? ''}
      onChange={set('severity')}
      slotProps={{
        select: {
          displayEmpty: true,
          renderValue: (name) => (
            <SeverityValue severities={lists.severity ?? []} name={name} />
          ),
        },
        inputLabel: { shrink: true },
      }}
      helperText="What this costs the customer, and what we commit to. Needed before the ticket can be started."
    >
      <MenuItem value=""><em>Not triaged yet</em></MenuItem>
      {(lists.severity ?? []).filter((o) => o.is_active).map((o) => (
        <MenuItem key={o.id} value={o.name}><SeverityOption item={o} /></MenuItem>
      ))}
    </TextField>
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
            {/* `Form` is what the database stamps on a public submission, so it
                is never something to pick here. */}
            {staff && selectField({
              field: 'source', label: 'Source', required: true,
              options: (lists.source ?? []).filter((o) => o.name !== PUBLIC_SOURCE),
              helperText: 'How this request reached us.',
            })}
            {/* The team's own reading of the ticket, so it is here and not on
                the public form. Optional at intake — triage can happen later —
                but the ticket cannot be started or paused without it. */}
            {staff && severityField()}
          </Section>
        )}

        <Section title="Issue details">
          {textField({ field: 'title', label: 'Title', required: true })}
          {textField({
            field: 'description', label: 'Description',
            multiline: true, minRows: 4, required: true,
            onPaste: pasteFiles,
            helperText: 'Paste a screenshot here and it is attached to the request.',
          })}

          {staff && (
            <Autocomplete
              multiple size="small"
              options={(lists.labels ?? []).filter((l) => l.is_active).map((l) => l.name)}
              value={values.labels ?? []}
              onChange={(_e, v) => setValues((prev) => ({ ...prev, labels: v }))}
              renderInput={(p) => <TextField {...p} label="Labels" />}
            />
          )}

          <Box>
            <Button
              startIcon={<AttachFileIcon />} variant="outlined" size="small"
              onClick={() => fileInput.current?.click()}
              disabled={files.length >= MAX_FILES}
            >
              {staff ? 'Attach the original request' : 'Attach files'}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
              PDF, images or video · up to {MAX_FILES} files ·
              {' '}{asMb(MAX_BYTES)}MB each, {asMb(MAX_VIDEO_BYTES)}MB for video
            </Typography>
            {staff && (
              <Typography
                variant="caption" color={files.length === 0 ? 'error' : 'text.secondary'}
                sx={{ display: 'block', mt: 1 }}
              >
                Required — attach the customer's own request: the email, or a
                screenshot of the email, chat or message it arrived in.
              </Typography>
            )}
            <input ref={fileInput} type="file" hidden multiple
              accept={ACCEPT.join(',')} onChange={addFiles} />
            {previews.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <AttachmentGallery items={previews} size="small"
                  onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
              </Box>
            )}
          </Box>
        </Section>

        {submissionSection && (
          <Section title="Submission details">
            {/* A list, not a text box: the same customer typed three ways is
                three customers in every report. A company already on a ticket
                but no longer on the list still shows, so an old value is never
                silently swapped. */}
            {companyField()}
            {textField({ field: 'requester_name', label: 'Requester name', required: true })}
            {textField({ field: 'requester_email', label: 'Requester email', type: 'email', required: true })}
            {textField({
              field: 'source_url', label: 'Source URL',
              placeholder: 'https://…',
              helperText: 'Where the request came from — a page, an email thread, a ticket link.',
            })}
            {/* When the request actually arrived, which is not when it is being
                logged. Defaults to now; the database refuses a future date. */}
            {staff && textField({
              field: 'submitted_date', label: 'Submitted', type: 'datetime-local',
              required: true,
              slotProps: {
                inputLabel: { shrink: true },
                htmlInput: { max: toInputDateTime(new Date()) },
              },
              helperText: 'When the customer sent it. Defaults to now.',
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
