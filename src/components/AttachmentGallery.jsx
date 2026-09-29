import { useMemo, useState } from 'react'
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DescriptionIcon from '@mui/icons-material/Description'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import { attachmentKind, formatBytes, isViewable } from '../lib/attachments'
import AttachmentViewer from './AttachmentViewer'

/**
 * A responsive grid of attachment thumbnails. Every surface that shows
 * attachments uses it: the request form (before upload, with `onRemove`), the
 * staff ticket dialog and the public share page.
 *
 *   items    — [{ key, name, mime, size?, url }]; `url` null means "not available"
 *   onRemove — optional; when given, each tile gets a remove button
 *
 * Images and videos open in the in-page viewer; a PDF opens in a new tab.
 */
export default function AttachmentGallery({ items, onRemove, size = 'medium' }) {
  // The viewer steps through only what it can show, so its index is into this.
  const viewable = useMemo(() => items.filter((a) => a.url && isViewable(a.mime)), [items])
  const [viewing, setViewing] = useState(null)

  if (items.length === 0) return null
  const min = size === 'small' ? 88 : 120

  const open = (a) => {
    if (!a.url) return
    const i = viewable.indexOf(a)
    if (i >= 0) setViewing(i)
    else window.open(a.url, '_blank', 'noopener')
  }

  return (
    <>
      <Box
        sx={{
          display: 'grid', gap: 1.25,
          gridTemplateColumns: {
            xs: `repeat(auto-fill, minmax(${Math.round(min * 0.85)}px, 1fr))`,
            sm: `repeat(auto-fill, minmax(${min}px, 1fr))`,
          },
        }}
      >
        {items.map((a, i) => (
          <Tile key={a.key} item={a} onOpen={() => open(a)}
            onRemove={onRemove ? () => onRemove(i) : null} />
        ))}
      </Box>
      <AttachmentViewer items={viewable} index={viewing} onIndex={setViewing} />
    </>
  )
}

function Tile({ item, onOpen, onRemove }) {
  const kind = attachmentKind(item.mime)
  const [broken, setBroken] = useState(false)
  const size = formatBytes(item.size)
  const hint = !item.url ? '' : kind === 'pdf' || kind === 'file' ? 'Open in a new tab' : 'View'

  return (
    <Box
      sx={{
        position: 'relative', borderRadius: 1.5, overflow: 'hidden',
        border: 1, borderColor: 'divider', bgcolor: 'background.paper',
        transition: 'box-shadow 150ms, border-color 150ms',
        '&:hover': item.url ? { boxShadow: 3, borderColor: 'primary.light' } : undefined,
      }}
    >
      <Tooltip title={hint} placement="top" enterDelay={400}>
        <span>
          <ButtonBase
            onClick={onOpen} disabled={!item.url}
            aria-label={hint ? `${hint}: ${item.name}` : item.name}
            sx={{ display: 'block', width: '100%', textAlign: 'left' }}
          >
            <Box
              sx={{
                aspectRatio: '4 / 3', bgcolor: 'grey.100', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'text.secondary', overflow: 'hidden',
              }}
            >
              {kind === 'image' && item.url && !broken ? (
                <Box
                  component="img" src={item.url} alt={item.name} loading="lazy" decoding="async"
                  onError={() => setBroken(true)}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : kind === 'video' ? (
                // No frame preview: a video is only fetched once someone plays it.
                <PlayCircleIcon sx={{ fontSize: 44, color: 'primary.main' }} />
              ) : kind === 'pdf' ? (
                <DescriptionIcon sx={{ fontSize: 40, color: 'error.main' }} />
              ) : (
                <InsertDriveFileIcon sx={{ fontSize: 40 }} />
              )}
            </Box>
            <Box sx={{ px: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
              <Typography
                variant="caption" noWrap title={item.name} data-attachment-name=""
                sx={{ display: 'block', fontWeight: 500, color: 'text.primary' }}
              >
                {item.name}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.3 }}>
                {[kind === 'file' ? null : kind.toUpperCase(), size].filter(Boolean).join(' · ') || ' '}
              </Typography>
            </Box>
          </ButtonBase>
        </span>
      </Tooltip>

      {onRemove && (
        <IconButton
          size="small" aria-label={`Remove ${item.name}`} onClick={onRemove}
          sx={{
            position: 'absolute', top: 4, right: 4, p: 0.4,
            bgcolor: 'rgba(0,0,0,0.6)', color: 'common.white',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' },
          }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      )}
    </Box>
  )
}
