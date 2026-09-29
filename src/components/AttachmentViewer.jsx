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
        position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: { xs: 6, sm: 16 },
        color: 'common.white', bgcolor: 'rgba(0,0,0,0.45)',
        '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
        width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, zIndex: 1,
      }}
    >
      <Icon fontSize="large" />
    </IconButton>
  )

  // The controls ride on the media, not the corners of the screen: embedded in
  // a host page's popup, the corners of our frame can be scrolled or clipped
  // out of sight, but whatever is next to the picture is on screen with it.
  const control = { color: 'common.white', bgcolor: 'rgba(255,255,255,0.12)',
    '&:hover': { bgcolor: 'rgba(255,255,255,0.24)' } }
  const mediaMax = {
    maxWidth: { xs: 'calc(100vw - 24px)', sm: 'calc(100vw - 160px)' },
    maxHeight: 'calc(100dvh - 96px)',
  }

  return (
    <Dialog
      open fullScreen onClose={() => onIndex(null)}
      aria-label={`Attachment ${index + 1} of ${count}: ${item.name}`}
      slotProps={{ paper: { sx: { bgcolor: 'rgba(12,12,14,0.96)', border: 0, color: 'common.white' } } }}
    >
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
          display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1.5,
        }}
      >
        {arrow(-1, ChevronLeftIcon, 'left', 'Previous attachment')}

        {/* The frame is as wide as the media; the bar above it follows. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 'min(280px, 100%)' }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, width: 0, minWidth: '100%' }}>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }} title={item.name}>
                {item.name}
              </Typography>
              <Typography variant="caption" noWrap component="div" sx={{ color: 'grey.400' }}>
                {count > 1 && `${index + 1} of ${count}`}
                {count > 1 && size && ' · '}
                {size}
              </Typography>
            </Box>
            <Tooltip title="Open original in a new tab">
              <IconButton
                component="a" href={item.url} target="_blank" rel="noopener"
                aria-label="Open original" size="small" sx={control}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close (Esc)">
              <IconButton aria-label="Close" onClick={() => onIndex(null)} size="small" sx={control}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 120 }}>
            {kind === 'image' && !loaded && !failed && (
              <CircularProgress sx={{ position: 'absolute', color: 'grey.500' }} />
            )}
            {failed ? (
              <Typography variant="body2" sx={{ color: 'grey.400', textAlign: 'center', py: 4 }}>
                This file could not be shown here. Try opening the original.
              </Typography>
            ) : kind === 'image' ? (
              <Box
                component="img" key={item.url} src={item.url} alt={item.name}
                onLoad={() => setLoadedUrl(item.url)} onError={() => setFailedUrl(item.url)}
                sx={{
                  ...mediaMax, display: 'block', objectFit: 'contain',
                  borderRadius: 1, boxShadow: 8, userSelect: 'none',
                  opacity: loaded ? 1 : 0, transition: 'opacity 150ms',
                }}
              />
            ) : (
              <Box
                component="video" key={item.url} src={item.url} controls autoPlay playsInline
                onError={() => setFailedUrl(item.url)}
                sx={{ ...mediaMax, display: 'block', borderRadius: 1, boxShadow: 8, bgcolor: 'black' }}
              />
            )}
          </Box>
        </Box>

        {arrow(1, ChevronRightIcon, 'right', 'Next attachment')}
      </Box>
    </Dialog>
  )
}
