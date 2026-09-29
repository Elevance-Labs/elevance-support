// What an attachment is, for the purpose of showing it. Pure: the gallery and
// the viewer read it, and so do the tests.

// Only these open in the in-page viewer. Anything else (a PDF) opens in a tab,
// where the browser's own viewer does a better job than we could.
export function attachmentKind(mime) {
  if (!mime) return 'file'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

export const isViewable = (mime) => ['image', 'video'].includes(attachmentKind(mime))

// 1234567 → "1.2 MB". Null for an unknown size, so the caller can leave it out.
export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let n = bytes / 1024
  let u = 0
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++ }
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[u]}`
}
