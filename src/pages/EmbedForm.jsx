import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Paper, Stack, Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import IssueForm from '../components/IssueForm'
import { supabase } from '../lib/supabase'
import { normalizeKey } from '../lib/projects'

// Query-param aliases so embedders can use whichever reads naturally.
const FIELDS = {
  type:            ['type'],
  product:         ['product'],
  area:            ['area'],
  priority:        ['priority'],
  title:           ['title', 'subject'],
  description:     ['description', 'body'],
  // A company may be named or, better, given by its short code: ?company=wupi.
  company:         ['company', 'org', 'company_code', 'code'],
  requester_name:  ['requester_name', 'name'],
  requester_email: ['requester_email', 'email'],
  source_url:      ['source_url', 'url'],
}

/**
 * Only the submission details disappear when supplied — they describe who is
 * asking, which the embedder already knows and the requester shouldn't have to
 * retype. Everything about the request itself stays on the form: a pre-filled
 * type or priority is a starting suggestion the requester can still correct.
 */
const HIDEABLE = new Set(['company', 'requester_name', 'requester_email', 'source_url'])

export default function EmbedForm() {
  const { key: rawKey } = useParams()
  const [params] = useSearchParams()
  const [done, setDone] = useState(false)

  // The key in the path decides which project the request is filed against.
  const key = normalizeKey(rawKey ?? '')
  const [project, setProject] = useState(null)
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setResolving(true)
      const { data } = await supabase
        .from('projects').select('id, name, key').eq('key', key).maybeSingle()
      if (cancelled) return
      setProject(data ?? null)
      setResolving(false)
    })()
    return () => { cancelled = true }
  }, [key])

  // Split what the embedder supplied: submission details are hidden, the rest
  // pre-fill visible fields.
  const { hidden, supplied } = useMemo(() => {
    const hidden = {}
    const supplied = {}
    for (const [field, aliases] of Object.entries(FIELDS)) {
      for (const alias of aliases) {
        const v = params.get(alias)
        if (v != null && v !== '') {
          if (HIDEABLE.has(field)) hidden[field] = v
          else supplied[field] = v
          break
        }
      }
    }
    return { hidden, supplied }
  }, [params])

  // The embedding page's URL is a helpful guess rather than something the
  // embedder asserted, so it pre-fills a visible field instead of hiding one.
  const defaults = useMemo(() => {
    const out = { ...supplied }
    if (!hidden.source_url) {
      try {
        if (document.referrer) out.source_url = document.referrer
      } catch { /* referrer can be blocked by the embedding page's policy */ }
    }
    return out
  }, [supplied, hidden.source_url])

  if (resolving) {
    return (
      <Wrapper>
        <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
          <CircularProgress />
        </Box>
      </Wrapper>
    )
  }

  // An unknown key is the embedder's mistake, not the requester's. Say which
  // key failed rather than showing a form whose submissions would go nowhere.
  if (!project) {
    return (
      <Wrapper>
        <Alert severity="warning">
          This form isn’t available. The address should be
          {' '}<code>/embed/&lt;project key&gt;/form</code>
          {rawKey ? <> — <code>{rawKey}</code> doesn’t match a project.</> : '.'}
        </Alert>
      </Wrapper>
    )
  }

  if (done) {
    return (
      <Wrapper project={project}>
        <Stack spacing={2} sx={{ py: 6, textAlign: 'center', alignItems: 'center' }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
          <Typography variant="h6">Thanks — your request is in.</Typography>
          <Typography variant="body2" color="text.secondary">
            The team will pick it up and follow up by email.
          </Typography>
          <Button onClick={() => setDone(false)}>Submit another request</Button>
        </Stack>
      </Wrapper>
    )
  }

  return (
    <Wrapper project={project}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6">Submit a support request</Typography>
        <Typography variant="body2" color="text.secondary">
          Tell us what you need and we'll route it to the right person.
        </Typography>
      </Box>
      <IssueForm
        hidden={hidden} defaults={defaults} projectId={project.id}
        onSubmitted={() => setDone(true)}
      />
    </Wrapper>
  )
}

/*
 * Renders well both full-page and boxed inside an iframe.
 *
 * The project name sits above the form as a quiet label rather than a heading:
 * the requester wants to know they're in the right place, not to read the
 * internal name of a queue.
 */
function Wrapper({ children, project }) {
  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh', py: { xs: 2, sm: 4 }, px: 2 }}>
      <Paper sx={{ maxWidth: 640, mx: 'auto', p: { xs: 2.5, sm: 4 } }}>
        {project && (
          <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {project.name}
          </Typography>
        )}
        {children}
      </Paper>
    </Box>
  )
}
