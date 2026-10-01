import { useEffect, useMemo, useState } from 'react'
import { acceptFiles, pastedName } from '../lib/attachments'

// Null where there is no object URL support (tests); the tile falls back to an icon.
const objectUrl = (file) => {
  try { return URL.createObjectURL(file) } catch { return null }
}

/**
 * Files picked but not yet uploaded — the request form's and the comment
 * composer's. Every file goes through the same gate, whether it came from the
 * picker or was pasted into a text box; `onError` hears about the ones turned
 * away.
 */
export default function useAttachmentDraft(onError) {
  const [files, setFiles] = useState([])

  const add = (picked) => {
    const next = acceptFiles(files, picked)
    onError(next.error)
    setFiles(next.files)
  }

  // Local previews of what is about to be uploaded. Each object URL is released
  // when its file leaves the list, or the form goes away.
  const previews = useMemo(() => files.map((f, i) => ({
    key: `${f.name}-${f.size}-${i}`, name: f.name, mime: f.type, size: f.size,
    // Only images get a preview URL; a video or PDF tile is just an icon.
    url: f.type.startsWith('image/') ? objectUrl(f) : null,
  })), [files])
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews])

  return {
    files,
    previews,
    clear: () => setFiles([]),
    remove: (i) => setFiles(files.filter((_, j) => j !== i)),
    // For an <input type="file" onChange>.
    onPick: (e) => {
      add(Array.from(e.target.files ?? []))
      e.target.value = ''   // allow re-picking the same file
    },
    // For a text box's onPaste: a screenshot becomes an attachment, ordinary
    // text is left alone for the browser to paste as usual.
    onPaste: (e) => {
      const picked = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.kind === 'file')
        .map((i) => i.getAsFile())
        .filter(Boolean)
      if (picked.length === 0) return
      e.preventDefault()
      add(picked.map((f) => (
        f.type.startsWith('image/') ? new File([f], pastedName(f), { type: f.type }) : f
      )))
    },
  }
}
