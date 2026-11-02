import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Autocomplete, Box, IconButton, Link, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { Link as RouterLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useProject } from '../context/ProjectContext'
import { publicIssuePath } from '../lib/projects'
import { statusTypeOf } from '../lib/sla'
import {
  escapeLike, linkPair, otherEnd, parseTicketQuery, rankCandidates,
} from '../lib/links'
import { StatusLabel } from './StatusDot'

// Enough of a ticket to recognise it by, in this list or in the picker.
const COLUMNS = 'id, project_id, number, title, status, company, company_code, submitted_date'

/**
 * The tickets this one is linked to, and a picker to link another.
 *
 * Takes effect at once, like a comment — not part of the dialog's draft, so
 * "Save changes" never has a link to lose. A link has no direction: linking
 * here shows on the other ticket too, and unlinking from either end removes it
 * from both.
 *
 * Linked tickets may sit in other projects, so each is named by its own
 * project's key, and opens through its share link in a new tab: that resolves
 * the project for staff, and leaves this ticket open beside it to compare.
 */
export default function LinkedTickets({ issue, canLink, onError }) {
  const { lists } = useConfig()
  const { projects } = useProject()
  const keyOf = useMemo(
    () => Object.fromEntries((projects ?? []).map((p) => [p.id, p.key])), [projects])
  const refOf = (t) => (keyOf[t.project_id] ? `${keyOf[t.project_id]}-${t.number}` : `#${t.number}`)

  const [linked, setLinked] = useState([])
  const [input, setInput] = useState('')
  const [options, setOptions] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    // Two reads, one per end of the pair: this ticket may be either.
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.from('issue_links').select('*').eq('issue_a', issue.id),
      supabase.from('issue_links').select('*').eq('issue_b', issue.id),
    ])
    const ids = [...(a ?? []), ...(b ?? [])].map((l) => otherEnd(l, issue.id))
    if (!ids.length) return setLinked([])
    const { data: rows } = await supabase.from('issues').select(COLUMNS).in('id', ids)
    // By project, then number: the order the references read in.
    setLinked([...(rows ?? [])].sort((x, y) =>
      String(keyOf[x.project_id] ?? '').localeCompare(String(keyOf[y.project_id] ?? ''))
      || x.number - y.number))
  }, [issue.id, keyOf])

  useEffect(() => { load() }, [load])

  // What the picker offers, fetched as the box changes. An empty box suggests
  // the same company's tickets — where a duplicate nearly always comes from.
  useEffect(() => {
    if (!canLink) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      const q = parseTicketQuery(input)
      let query = supabase.from('issues').select(COLUMNS)
      if (!q) {
        query = issue.company
          ? query.eq('company', issue.company)
          : query.eq('project_id', issue.project_id)
      } else if (q.key) {
        const project = (projects ?? []).find((p) => p.key === q.key)
        query = project ? query.eq('project_id', project.id).eq('number', q.number) : null
      } else if (q.number != null) {
        query = query.eq('number', q.number)
      } else {
        query = query.ilike('title', `%${escapeLike(q.title)}%`)
      }
      const { data } = query
        ? await query.order('submitted_date', { ascending: false }).limit(100)
        : { data: [] }
      if (cancelled) return
      setOptions(rankCandidates(data, issue, linked.map((t) => t.id)))
      setSearching(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [input, canLink, issue, projects, linked])

  const link = async (other) => {
    if (!other) return
    setBusy(true)
    const { error } = await supabase.from('issue_links').insert(linkPair(issue.id, other.id))
    setBusy(false); setInput('')
    // A pair already linked — from the other ticket, a moment ago — is no error.
    if (error && error.code !== '23505') return onError?.(error.message)
    load()
  }

  const unlink = async (other) => {
    setBusy(true)
    const pair = linkPair(issue.id, other.id)
    const { data, error } = await supabase.from('issue_links').delete()
      .eq('issue_a', pair.issue_a).eq('issue_b', pair.issue_b).select()
    setBusy(false)
    if (error) return onError?.(error.message)
    // RLS refuses by matching nothing, which is not an error to the client.
    if (!data?.length) onError?.('That link could not be removed — it may already be gone.')
    load()
  }

  const statusType = (name) => statusTypeOf(lists.status ?? [], name)

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
        {linked.length ? `Linked tickets (${linked.length})` : 'Linked tickets'}
      </Typography>
      <Stack spacing={1} data-linked-tickets>
        {linked.map((t) => (
          <Stack key={t.id} direction="row" spacing={1} data-linked-ticket={refOf(t)}
            sx={{ alignItems: 'flex-start' }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Link component={RouterLink} to={publicIssuePath(keyOf[t.project_id], t.number)}
                target="_blank" rel="noopener" variant="body2" underline="hover"
                sx={{ fontWeight: 600 }}>
                {refOf(t)} <OpenInNewIcon sx={{ fontSize: 12, verticalAlign: 'middle' }} />
              </Link>
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{t.title}</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" component="div">
                  <StatusLabel name={t.status} statusType={statusType(t.status)} />
                </Typography>
                {t.company && (
                  <Typography variant="caption" color="text.secondary">· {t.company}</Typography>
                )}
              </Stack>
            </Box>
            {canLink && (
              <Tooltip title="Unlink — from both tickets">
                <span>
                  <IconButton size="small" onClick={() => unlink(t)} disabled={busy}
                    aria-label={`Unlink ${refOf(t)}`}>
                    <LinkOffIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        ))}
        {canLink && (
          <Autocomplete size="small"
            options={options} value={null} inputValue={input}
            onInputChange={(_e, v, reason) => { if (reason !== 'reset') setInput(v) }}
            onChange={(_e, picked) => link(picked)}
            // Already filtered by the database; the box must not filter again
            // on a label the typed reference may not appear in.
            filterOptions={(x) => x}
            loading={searching} disabled={busy}
            getOptionLabel={(t) => `${refOf(t)} ${t.title}`}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            noOptionsText={input ? 'No matching ticket' : 'Type a reference or part of a title'}
            renderOption={({ key, ...props }, t) => (
              <li key={key} {...props}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">
                    <strong>{refOf(t)}</strong> {t.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[t.company, t.status].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={(p) => (
              <TextField {...p} label="Link a ticket" placeholder="ACME-42 or a title" />
            )} />
        )}
      </Stack>
    </Paper>
  )
}
