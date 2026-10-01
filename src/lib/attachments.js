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

// ---- what may be attached ----
// The request form and the comment composer take the same files under the same
// limits, so both read them from here.

export const MAX_FILES = 5
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const DOC_TYPES = ['application/pdf']
// A screen recording is often the clearest bug report there is, so video is
// worth the extra room — but only the containers a browser can play back.
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
export const ACCEPT = [...IMAGE_TYPES, ...DOC_TYPES, ...VIDEO_TYPES]

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024
// The storage bucket allows the larger of the two; the per-type limit is here,
// so a 30MB screenshot is still refused.
export const limitFor = (type) => (VIDEO_TYPES.includes(type) ? MAX_VIDEO_BYTES : MAX_BYTES)
export const asMb = (bytes) => Math.round(bytes / (1024 * 1024))

export const ATTACH_HINT =
  `PDF, images or video · up to ${MAX_FILES} files · ` +
  `${asMb(MAX_BYTES)}MB each, ${asMb(MAX_VIDEO_BYTES)}MB for video`

/**
 * Adds `picked` to `current`, keeping only what the rules allow.
 * Returns the new list and the message for the last file turned away, if any.
 */
export function acceptFiles(current, picked) {
  const files = [...current]
  let error = ''
  for (const f of picked) {
    if (files.length >= MAX_FILES) { error = `You can attach at most ${MAX_FILES} files.`; break }
    if (!ACCEPT.includes(f.type)) { error = `${f.name} is not a PDF, image or video.`; continue }
    if (f.size > limitFor(f.type)) { error = `${f.name} is larger than ${asMb(limitFor(f.type))}MB.`; continue }
    files.push(f)
  }
  return { files, error }
}

// A pasted screenshot arrives as a file the clipboard names `image.png` — the
// same name every time — so it is renamed to keep five of them apart.
// Milliseconds included: two screenshots pasted a second apart must not land
// on the same name.
export function pastedName(file, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.]/g, '').replace('Z', '')
  const ext = file.name?.match(/\.[a-z0-9]+$/i)?.[0]
    ?? `.${(file.type.split('/')[1] ?? 'png')}`
  return `pasted-${stamp}${ext}`
}
