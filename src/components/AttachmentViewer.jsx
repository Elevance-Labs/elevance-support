import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, CircularProgress, Dialog, IconButton, Stack, Tooltip, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { attachmentKind, formatBytes } from '../lib/attachments'

// How far a finger has to travel sideways before it counts as a swipe.
const SWIPE_PX = 50

/**
 * Full-screen lightbox over a list of images and videos.
 *
 *   items   — [{ key, name, mime, size?, url }]; only viewable ones belong here
 *   index   — which one is showing, or null when closed
 *   onIndex — called with the new index (or null to close)
 *
 * Arrow keys and swipes step through; Escape closes. The original is always one
 * tap away in a new tab, for zooming past what the screen can show.
 */
export default function AttachmentViewer({ items, index, onIndex }) {
  const open = index != null && items[index] != null
  const count = items.length
  const item = open ? items[index] : null
  // Keyed by URL, so stepping to the next item starts it unloaded without an effect.
  const [loadedUrl, setLoadedUrl] = useState(null)
  const [failedUrl, setFailedUrl] = useState(null)
  const loaded = item != null && loadedUrl === item.url
  const failed = item != null && failedUrl === item.url
  const touchX = useRef(null)

  const step = useCallback((by) => {
    if (count < 2 || index == null) return
    onIndex((index + by + count) % count)
  }, [count, index, onIndex])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step])

  if (!open) return null
  const kind = attachmentKind(item.mime)
  const size = formatBytes(item.size)

  const arrow = (by, Icon, side, label) => count > 1 && (
    <IconButton
      aria-label={label} onClick={() => step(by)}
      sx={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: { xs: 4, sm: 16 },
        color: 'common.white', bgcolor: 'rgba(0,0,0,0.45)',
        '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
        width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, zIndex: 1,
      }}
    >
      <Icon fontSize="large" />
    </IconButton>
  )

  return (
    <Dialog
      open fullScreen onClose={() => onIndex(null)}
      aria-label={`Attachment ${index + 1} of ${count}: ${item.name}`}
      slotProps={{ paper: { sx: { bgcolor: 'rgba(12,12,14,0.96)', border: 0, color: 'common.white' } } }}
    >
      {/* Top bar: where you are, what it is, and the ways out. */}
      <Stack
        direction="row"
        sx={{ alignItems: 'center', gap: 1, px: { xs: 1.5, sm: 2.5 }, py: 1, minHeight: 56 }}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }} title={item.name}>
            {item.name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'grey.400' }}>
            {count > 1 && `${index + 1} of ${count}`}
            {count > 1 && size && ' · '}
            {size}
          </Typography>
        </Box>
        <Tooltip title="Open original in a new tab">
          <IconButton
            component="a" href={item.url} target="_blank" rel="noopener"
            aria-label="Open original" sx={{ color: 'common.white' }}
          >
            <OpenInNewIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close (Esc)">
          <IconButton aria-label="Close" onClick={() => onIndex(null)} sx={{ color: 'common.white' }}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Stage. Clicking the backdrop around the media closes, like every lightbox. */}
      <Box
        onClick={(e) => { if (e.target === e.currentTarget) onIndex(null) }}
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null }}
        onTouchEnd={(e) => {
          const start = touchX.current
          touchX.current = null
          const end = e.changedTouches[0]?.clientX
          if (start == null || end == null) return
          if (end - start > SWIPE_PX) step(-1)
          if (start - end > SWIPE_PX) step(1)
        }}
        sx={{
          position: 'relative', flexGrow: 1, minHeight: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          px: { xs: 1, sm: 9 }, pb: { xs: 1, sm: 2 },
        }}
      >
        {arrow(-1, ChevronLeftIcon, 'left', 'Previous attachment')}

        {kind === 'image' && !loaded && !failed && (
          <CircularProgress sx={{ position: 'absolute', color: 'grey.500' }} />
        )}
        {failed ? (
          <Typography variant="body2" sx={{ color: 'grey.400', textAlign: 'center' }}>
            This file could not be shown here. Try opening the original.
          </Typography>
        ) : kind === 'image' ? (
          <Box
            component="img" key={item.url} src={item.url} alt={item.name}
            onLoad={() => setLoadedUrl(item.url)} onError={() => setFailedUrl(item.url)}
            sx={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              borderRadius: 1, boxShadow: 8, userSelect: 'none',
              opacity: loaded ? 1 : 0, transition: 'opacity 150ms',
            }}
          />
        ) : (
          <Box
            component="video" key={item.url} src={item.url} controls autoPlay playsInline
            onError={() => setFailedUrl(item.url)}
            sx={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 1, boxShadow: 8, bgcolor: 'black' }}
          />
        )}

        {arrow(1, ChevronRightIcon, 'right', 'Next attachment')}
      </Box>
    </Dialog>
  )
}
