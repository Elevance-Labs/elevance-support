// The private `attachments` bucket: putting a file there, and getting a URL to
// draw one. Like `supabase.js`, this exists to talk to Supabase — the rules
// about what may be attached are in `attachments.js`.
import { supabase } from './supabase'

/**
 * Uploads `file` and records it against a ticket — or against one comment on
 * it, when `commentId` is given. Throws on the first failure.
 */
export async function uploadAttachment(file, { issueId, commentId = null }) {
  const path = `${issueId}/${crypto.randomUUID()}-${file.name}`
  const { error: upErr } = await supabase.storage
    .from('attachments').upload(path, file, { contentType: file.type })
  if (upErr) throw upErr
  const { error: attErr } = await supabase.from('attachments').insert({
    issue_id: issueId, file_name: file.name, file_path: path,
    mime_type: file.type, size_bytes: file.size,
    ...(commentId ? { comment_id: commentId } : {}),
  })
  if (attErr) throw attErr
}

// The bucket is private, so every attachment needs a signed URL before it can
// be drawn as a thumbnail. One batch call; an hour covers a long look at a ticket.
const SIGNED_URL_TTL_SECONDS = 60 * 60

/** Attachment rows → gallery items, each with a signed URL (or null). */
export async function signAttachments(rows) {
  if (rows.length === 0) return []
  const { data } = await supabase.storage.from('attachments')
    .createSignedUrls(rows.map((r) => r.file_path), SIGNED_URL_TTL_SECONDS)
  const urlByPath = Object.fromEntries((data ?? []).map((d) => [d.path, d.signedUrl]))
  return rows.map((r) => ({
    key: r.id, name: r.file_name, mime: r.mime_type, size: r.size_bytes,
    path: r.file_path, url: urlByPath[r.file_path] ?? null,
  }))
}

/** Deletes stored files whose rows are already gone. Best effort: a leftover file harms nobody. */
export async function removeAttachmentFiles(paths) {
  if (paths.length === 0) return
  await supabase.storage.from('attachments').remove(paths)
}
