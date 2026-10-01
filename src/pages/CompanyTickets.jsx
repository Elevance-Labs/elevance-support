import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, CircularProgress,
  Container, Divider, InputAdornment, Link, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SearchIcon from '@mui/icons-material/Search'
import { fetchCompanyTickets } from '../lib/publicLink'
import { TICKET_GROUPS, groupTickets, searchTickets, sortByStatus } from '../lib/companies'
import { statusColor } from '../lib/sla'
import { formatDateTime } from '../lib/format'
import AttachmentGallery from '../components/AttachmentGallery'
import Tag from '../components/Tag'

// The same spellings the embed form accepts for a company, so a link written
// for one works on the other.
const COMPANY_PARAMS = ['company', 'org', 'company_code', 'code']

/**
 * Every ticket filed for one company, for that company to read.
 *
 * Public and read-only, like a share link, and addressed by the `company`
 * parameter — `/tickets?company=wupi`. The list is sorted by status, in
 * workflow order, and can be searched and grouped. Each row opens to the request as it was
 * submitted: description, attachments, who asked and when, plus the product,
 * area and current status. Comments, assignees, the status timeline and SLA are
 * the team's own and are not sent to this page at all.
 *
 * Signed-in staff see exactly what the customer sees — this is the page to check
 * before sending the link, not a second place to work.
 */
export default function CompanyTickets() {
  const [params, setParams] = useSearchParams()
  const company = COMPANY_PARAMS.map((p) => params.get(p)?.trim()).find(Boolean) ?? ''
  // The grouping lives in the URL too, so a link can be sent already grouped.
  const group = TICKET_GROUPS.find((g) => g.field === params.get('group'))?.field ?? null

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(''); setData(null)
      // No company in the link dead-ends here, without a pointless round trip.
      if (!company) { setLoading(false); return }
      try {
        const payload = await fetchCompanyTickets(company)
        if (!cancelled) setData(payload)
      } catch (err) {
        if (!cancelled) setError(err.message ?? 'This page could not be opened.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [company])

  const tickets = data?.tickets
  const statuses = data?.statuses
  // Sorted by status first, so every grouping inherits that order within a group.
  const { shown, groups } = useMemo(() => {
    const order = (statuses ?? []).map((s) => s.name)
    const shown = searchTickets(sortByStatus(tickets ?? [], order), query)
    return { shown, groups: groupTickets(shown, group, group === 'status' ? order : []) }
  }, [tickets, statuses, group, query])

  const setGroup = (_, field) => {
    const next = new URLSearchParams(params)
    if (field) next.set('group', field)
    else next.delete('group')
    setParams(next, { replace: true })
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!data || error) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity={error ? 'error' : 'warning'}>
          {error || 'No such company. Check the link, or ask whoever shared it for the right one.'}
        </Alert>
      </Container>
    )
  }

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh', py: { xs: 3, md: 6 } }}>
      <Container maxWidth="md">
        <Stack spacing={3}>
          {/* Search and grouping share a row; the company is named in the
              footer, so the list starts at the top of the page. */}
          {tickets.length > 0 && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}
              sx={{ alignItems: { sm: 'center' } }}>
              <TextField
                size="small" type="search" value={query} sx={{ flexGrow: 1 }}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, description or requester"
                slotProps={{
                  htmlInput: { 'aria-label': 'Search tickets' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                    ),
                  },
                }}
              />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary">Group by</Typography>
                <ToggleButtonGroup size="small" exclusive value={group} onChange={setGroup}
                  aria-label="Group tickets by">
                  {TICKET_GROUPS.map((g) => (
                    <ToggleButton key={g.field} value={g.field} sx={{ px: 1.5 }}>
                      {g.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
            </Stack>
          )}

          {tickets.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tickets have been reported yet.
            </Typography>
          ) : shown.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tickets match “{query.trim()}”.
            </Typography>
          ) : groups.map((g) => (
            <Box key={g.name ?? ''}>
              {/* Ungrouped, the one group is headed the same way, so the count
                  is always in the same place. */}
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                {group ? g.name ?? `No ${group}` : 'All tickets'} ({g.tickets.length})
              </Typography>
              {g.tickets.map((t) => (
                <TicketRow key={`${t.project.key}-${t.number}`} ticket={t}
                  color={statusColor(statuses, t.status)} />
              ))}
            </Box>
          ))}

          <Typography variant="caption" color="text.disabled">
            This is a read-only view of {data.company.name} support tickets.
            {data.closed_visible_days > 0
              && ` Tickets closed more than ${data.closed_visible_days} days ago are not shown.`}
            {data.truncated && ' Only the most recent are shown.'}
          </Typography>
        </Stack>
      </Container>
    </Box>
  )
}

function TicketRow({ ticket: t, color }) {
  const [open, setOpen] = useState(false)
  const filed = [t.product, t.area].filter(Boolean).join(' · ')

  return (
    <Accordion disableGutters expanded={open} onChange={(_, next) => setOpen(next)}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ minWidth: 0, flexGrow: 1, pr: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t.project.key}-{t.number}
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
            {t.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {filed ? `${filed} · ` : ''}Submitted {formatDateTime(t.submitted_date)}
          </Typography>
        </Box>
        {/* Coloured by status type, as everywhere else in the app. */}
        <Box sx={{ flexShrink: 0, alignSelf: 'center', mr: 1 }}>
          <Tag value={t.status} color={color} />
        </Box>
      </AccordionSummary>
      {/* Built only once opened: a long list shouldn't fetch every thumbnail. */}
      {open && (
        <AccordionDetails>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {t.description || <em>No description provided.</em>}
          </Typography>

          {t.attachments?.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <AttachmentGallery items={t.attachments.map(toItem)} />
            </Box>
          )}

          <Divider sx={{ my: 2 }} />
          <Box sx={{
            display: 'grid', columnGap: 3, rowGap: 1,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          }}>
            <Field label="Project" value={t.project.name} />
            <Field label="Company" value={t.company} />
            <Field label="Product" value={t.product} />
            <Field label="Area" value={t.area} />
            <Field label="Requester" value={t.requester_name} />
            <Field label="Source" value={t.source} />
            <Field label="Submitted" value={formatDateTime(t.submitted_date)} />
            <Field label="Source URL" value={safeUrl(t.source_url)
              ? <Link href={t.source_url} target="_blank" rel="noopener"
                  sx={{ overflowWrap: 'anywhere' }}>{t.source_url}</Link>
              : t.source_url} />
          </Box>
        </AccordionDetails>
      )}
    </Accordion>
  )
}

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{value || '—'}</Typography>
  </Box>
)

// A source URL is whatever the requester's form sent. On a public page it is
// only made clickable when it is an ordinary web address.
const safeUrl = (url) => /^https?:\/\//i.test(url ?? '')

// The function's attachment shape → the gallery's.
const toItem = (a) => ({
  key: a.id, name: a.file_name, mime: a.mime_type, size: a.size_bytes, url: a.url,
})
