import { useMemo, useState } from 'react'
import { Box, IconButton, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import { copyText } from '../lib/publicLink'
import { docToHtml, docToText, storedDoc } from '../lib/richText'

/**
 * The "Insert template…" menu under a composer: the comment box and the email
 * box. Picking one hands its document to `onPick` — formatting included, and a
 * template saved before rich text read as plain lines — and nothing is ever
 * sent from here. Each row also has a copy button, for pasting it elsewhere.
 *
 * Draws nothing when no template is active.
 */
export default function TemplatePicker({ templates, disabled, onPick, onError }) {
  const [copiedId, setCopiedId] = useState(null) // template just copied, for the tick
  const offered = useMemo(() => templates.filter((t) => t.is_active), [templates])

  /**
   * The copy button on a template's row. Stops the click there, so the row's
   * own click — which writes into the box and closes the menu — never fires.
   */
  const copyTemplate = async (e, template) => {
    e.stopPropagation()
    const doc = storedDoc(template)
    if (await copyText(docToText(doc), docToHtml(doc))) {
      setCopiedId(template.id)
      setTimeout(() => setCopiedId((id) => (id === template.id ? null : id)), 2000)
    } else {
      // No Clipboard API (an insecure origin, usually).
      onError('Could not copy to the clipboard — pick the template to put it in the box instead.')
    }
  }

  if (offered.length === 0) return null

  return (
    // Always shows its prompt rather than the last pick: it is an action, and
    // the same template may be wanted twice.
    <TextField select size="small" value="" disabled={disabled}
      onChange={(e) => {
        const template = offered.find((t) => t.id === e.target.value)
        if (template) onPick(storedDoc(template))
      }}
      sx={{ minWidth: 180 }}
      slotProps={{
        select: {
          displayEmpty: true,
          renderValue: () => (
            <Typography variant="body2" color="text.secondary">Insert template…</Typography>
          ),
          inputProps: { 'aria-label': 'Insert template' },
        },
      }}>
      {offered.map((t) => (
        <MenuItem key={t.id} value={t.id} sx={{
          gap: 1,
          // The copy button shows on hover (or keyboard focus) only, so the
          // list reads as titles until you are on one.
          '& .template-copy': { opacity: 0 },
          '&:hover .template-copy, &.Mui-focusVisible .template-copy, & .template-copy.copied':
            { opacity: 1 },
        }}>
          <Box sx={{ flexGrow: 1 }}>{t.title}</Box>
          <Tooltip title={copiedId === t.id ? 'Copied' : 'Copy text'}>
            <IconButton size="small"
              className={copiedId === t.id ? 'template-copy copied' : 'template-copy'}
              aria-label={`Copy ${t.title}`}
              onClick={(e) => copyTemplate(e, t)}>
              {copiedId === t.id
                ? <CheckIcon color="success" sx={{ fontSize: 16 }} />
                : <ContentCopyIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
        </MenuItem>
      ))}
    </TextField>
  )
}
