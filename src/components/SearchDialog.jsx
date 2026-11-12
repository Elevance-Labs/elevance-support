// Search (Cmd/Ctrl+S, or the box in the header): one box that finds tickets
// across every project you can see — by reference (ACME-42), by number (42),
// or by words of the title. Arrow keys move, Enter opens the ticket.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Dialog, InputAdornment, List, ListItemButton, ListItemText, TextField, Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { supabase } from '../lib/supabase'
import { useConfig } from '../context/ConfigContext'
import { useProject } from '../context/ProjectContext'
import { escapeLike, parseTicketQuery } from '../lib/links'
import { issueRef } from '../lib/projects'
import { statusTypeOf } from '../lib/sla'
import { SEARCH_LIMIT, ticketPath } from '../lib/search'
import { StatusLabel } from './StatusDot'

const COLUMNS = 'id, project_id, number, title, status, company, submitted_date'

// Mounted only while open, so each opening starts with an empty box.
export default function SearchDialog({ onClose }) {
  const navigate = useNavigate()
  const { lists } = useConfig()
  const { projects } = useProject()
  const [q, setQ] = useState('')
  const [found, setFound] = useState({ q: '', rows: [] })
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const text = q.trim()

  const projectById = useMemo(
    () => Object.fromEntries((projects ?? []).map((p) => [p.id, p])), [projects])

  useEffect(() => {
    if (!text) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const parsed = parseTicketQuery(text)
      let query = supabase.from('issues').select(COLUMNS)
      if (parsed.key) {
        const project = (projects ?? []).find((p) => p.key === parsed.key)
        query = project ? query.eq('project_id', project.id).eq('number', parsed.number) : null
      } else if (parsed.number != null) {
        query = query.eq('number', parsed.number)
      } else {
        query = query.ilike('title', `%${escapeLike(parsed.title)}%`)
      }
      const { data } = query
        ? await query.order('submitted_date', { ascending: false }).limit(SEARCH_LIMIT)
        : { data: [] }
      if (!cancelled) setFound({ q: text, rows: data ?? [] })
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [text, projects])

  const results = found.q === text ? found.rows : []
  const loading = Boolean(text) && found.q !== text
  const current = Math.min(active, Math.max(results.length - 1, 0))

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const go = (issue) => {
    onClose()
    navigate(ticketPath(issue))
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!results.length) return
      const by = e.key === 'ArrowDown' ? 1 : -1
      setActive((current + by + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[current]) go(results[current])
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm"
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
      slotProps={{ paper: { sx: { mt: { xs: 2, sm: '10vh' }, mx: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: undefined } } } }}>
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <TextField autoFocus fullWidth placeholder="Search tickets" value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          slotProps={{
            htmlInput: {
              'aria-label': 'Search tickets', role: 'combobox', 'aria-expanded': results.length > 0,
              'aria-controls': 'search-results', autoComplete: 'off',
              'aria-activedescendant': results[current] ? `search-${results[current].id}` : undefined,
            },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }} />
      </Box>
      {!text ? (
        <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
          Type a reference like ACME-42, a number, or words from a title.
        </Typography>
      ) : (
        <List id="search-results" role="listbox" ref={listRef} dense sx={{ maxHeight: '60vh', overflow: 'auto', py: 0 }}>
          {results.map((r, index) => {
            const project = projectById[r.project_id]
            return (
              <ListItemButton key={r.id} id={`search-${r.id}`} role="option" data-result={issueRef(project, r)}
                aria-selected={index === current} selected={index === current}
                onMouseMove={() => index !== current && setActive(index)} onClick={() => go(r)} sx={{ gap: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0, minWidth: 64 }}>
                  {issueRef(project, r)}
                </Typography>
                <ListItemText primary={r.title}
                  secondary={[project?.name, r.company].filter(Boolean).join(' · ')}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} sx={{ minWidth: 0 }} />
                <Box sx={{ flexShrink: 0 }}>
                  <StatusLabel name={r.status} statusType={statusTypeOf(lists.status ?? [], r.status)} />
                </Box>
              </ListItemButton>
            )
          })}
          {loading && !results.length && (
            <Typography variant="body2" sx={{ px: 2, py: 1.5, color: 'text.secondary' }}>Searching…</Typography>
          )}
          {!loading && !results.length && (
            <Typography variant="body2" sx={{ px: 2, py: 1.5, color: 'text.secondary' }}>Nothing matches “{text}”.</Typography>
          )}
        </List>
      )}
    </Dialog>
  )
}
