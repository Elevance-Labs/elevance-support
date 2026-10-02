import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, IconButton, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import { supabase } from '../lib/supabase'
import { signAttachments, uploadAttachment, removeAttachmentFiles } from '../lib/storage'
import { ACCEPT, ATTACH_HINT, MAX_FILES } from '../lib/attachments'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { formatDateTime, toMillis } from '../lib/format'
import { can, COMMENT_EDIT_WINDOW_MS } from '../lib/permissions'
import { displayName } from '../lib/users'
import UserAvatar from './UserAvatar'
import AttachmentGallery from './AttachmentGallery'
import useAttachmentDraft from './useAttachmentDraft'

/**
 * Ctrl+Enter posts, and so does Cmd+Enter.
 *
 * Both are accepted rather than picking one per platform: a Mac user reaches
 * for Cmd, everyone else for Ctrl, and honouring both means the shortcut is
 * never the wrong one. The platform is only consulted to *name* the key in the
 * hint next to the button.
 *
 * `isComposing` guards an IME: mid-composition Enter commits the candidate word
 * and must not also post the comment.
 */
const isSubmitChord = (e) =>
  e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent?.isComposing

const MOD_KEY_LABEL =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')
    ? '⌘' : 'Ctrl'

/**
 * Re-renders when a comment's 5-minute edit window expires, so the edit and
 * delete buttons disappear on their own rather than lingering until the user
 * clicks and gets a permission error.
 */
function useEditWindowTick(comments) {
  const [, setTick] = useState(0)
  // Keyed on the comment timestamps so the effect re-arms when the list changes;
  // the clock is read inside the effect, never during render.
  const stamps = comments.map((c) => c.created_at).join(',')

  useEffect(() => {
    const expiries = stamps
      ? stamps.split(',')
          .map((t) => toMillis(t) + COMMENT_EDIT_WINDOW_MS - Date.now())
          .filter((ms) => ms > 0)
      : []
    if (expiries.length === 0) return
    // Wake up when the next window closes.
    const next = Math.min(...expiries)
    const timer = setTimeout(() => setTick((n) => n + 1), next + 250)
    return () => clearTimeout(timer)
  }, [stamps])
}

export default function CommentsThread({ issueId }) {
  const { profile } = useAuth()
  const { users } = useConfig()
  const [comments, setComments] = useState([])
  const [filesOf, setFilesOf] = useState({}) // comment id → gallery items
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null) // { id, body }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const attach = useAttachmentDraft(setError)
  const fileInput = useRef(null)

  useEditWindowTick(comments)

  const load = useCallback(async () => {
    const [{ data, error }, { data: rows }] = await Promise.all([
      // Newest first: the latest word on a ticket is what a reader came for.
      supabase.from('comments').select('*').eq('issue_id', issueId)
        .order('created_at', { ascending: false }),
      // Only the comments' files; the request's own are drawn above the thread.
      supabase.from('attachments').select('*').eq('issue_id', issueId)
        .not('comment_id', 'is', null).order('created_at'),
    ])
    if (error) setError(error.message)
    setComments(data ?? [])
    const items = await signAttachments(rows ?? [])
    const grouped = {}
    rows?.forEach((r, i) => { (grouped[r.comment_id] ??= []).push(items[i]) })
    setFilesOf(grouped)
  }, [issueId])

  useEffect(() => { if (issueId) load() }, [issueId, load])

  const authorOf = useMemo(() => {
    const map = Object.fromEntries(users.map((u) => [u.id, u]))
    return (id) => map[id]
  }, [users])

  // A comment may be only a screenshot — text or a file, either will do.
  const canPost = !busy && (draft.trim() !== '' || attach.files.length > 0)

  const post = async () => {
    if (!canPost) return
    setBusy(true); setError('')
    // The id is minted here so the files can name their comment without
    // reading the row back.
    const id = crypto.randomUUID()
    const { error } = await supabase.from('comments')
      .insert({ id, issue_id: issueId, author_id: profile.id, body: draft.trim() })
    if (error) { setBusy(false); return setError(error.message) }
    try {
      for (const file of attach.files) await uploadAttachment(file, { issueId, commentId: id })
    } catch (err) {
      setError(`The comment was posted, but a file did not upload: ${err.message}`)
    }
    setBusy(false)
    setDraft(''); attach.clear(); load()
  }

  const saveEdit = async () => {
    const body = editing.body.trim()
    if (!body && !filesOf[editing.id]?.length) return
    setBusy(true); setError('')
    const { error } = await supabase.from('comments')
      .update({ body }).eq('id', editing.id)
    setBusy(false)
    if (error) {
      // The 5-minute rule is enforced by RLS too, so this can legitimately fail.
      return setError(`${error.message} — the 5 minute edit window may have closed.`)
    }
    setEditing(null); load()
  }

  const remove = async (comment) => {
    if (!confirm('Delete this comment?')) return
    const { data, error } = await supabase.from('comments')
      .delete().eq('id', comment.id).select('id')
    // RLS refuses a late delete by matching nothing, not by erroring.
    if (error || !data?.length) {
      return setError(`${error?.message ?? 'Not deleted'} — the 5 minute edit window may have closed.`)
    }
    // The rows go with the comment (on delete cascade); the files are ours to tidy.
    await removeAttachmentFiles((filesOf[comment.id] ?? []).map((f) => f.path))
    load()
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2" color="text.secondary">
        Comments {comments.length > 0 && `(${comments.length})`}
      </Typography>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {/* composer — above the thread, next to where its comment will land */}
      <Paper sx={{ p: 1.5 }}>
        <TextField
          fullWidth multiline minRows={2} size="small" placeholder="Add a comment…"
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onPaste={attach.onPaste}
          onKeyDown={(e) => {
            if (!isSubmitChord(e)) return
            e.preventDefault()          // otherwise the chord also types a newline
            post()
          }}
        />
        {attach.previews.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <AttachmentGallery items={attach.previews} size="small" onRemove={attach.remove} />
          </Box>
        )}
        <input ref={fileInput} type="file" hidden multiple
          accept={ACCEPT.join(',')} onChange={attach.onPick} />
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
          <Tooltip title={`Attach files — or paste a screenshot. ${ATTACH_HINT}`}>
            <span>
              <IconButton size="small" aria-label="Attach files"
                onClick={() => fileInput.current?.click()}
                disabled={busy || attach.files.length >= MAX_FILES}>
                <AttachFileIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" color="text.disabled">
            {MOD_KEY_LABEL}+Enter to post
          </Typography>
          <Button size="small" variant="contained" onClick={post} disabled={!canPost}>
            Comment
          </Button>
        </Stack>
      </Paper>

      {comments.length === 0 && (
        <Typography variant="caption" color="text.disabled">
          No comments yet.
        </Typography>
      )}

      <Stack spacing={1}>
        {comments.map((c) => {
          const author = authorOf(c.author_id)
          const name = displayName(author)
          const mine = can.modifyComment(profile, c)
          const isEditing = editing?.id === c.id
          const edited = c.updated_at && c.updated_at !== c.created_at

          return (
            <Paper key={c.id} sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1.5}>
                <UserAvatar user={author} name={name} size={30} />

                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(c.created_at)}
                    </Typography>
                    {edited && (
                      <Typography variant="caption" color="text.disabled">(edited)</Typography>
                    )}
                    <Box sx={{ flexGrow: 1 }} />
                    {mine && !isEditing && (
                      <>
                        <Tooltip title="Edit">
                          <IconButton size="small"
                            onClick={() => setEditing({ id: c.id, body: c.body })}>
                            <EditIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" onClick={() => remove(c)}>
                            <DeleteIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Stack>

                  {isEditing ? (
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      <TextField
                        fullWidth multiline size="small" autoFocus value={editing.body}
                        onChange={(e) => setEditing((s) => ({ ...s, body: e.target.value }))}
                        onKeyDown={(e) => {
                          // Same box, same chord — and Escape backs out, which is
                          // what every other cancellable edit in the app does.
                          if (isSubmitChord(e)) {
                            e.preventDefault()
                            if (!busy) saveEdit()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setEditing(null)
                          }
                        }}
                      />
                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="contained" onClick={saveEdit} disabled={busy}>
                          Save
                        </Button>
                        <Button size="small" onClick={() => setEditing(null)}>Cancel</Button>
                      </Stack>
                    </Stack>
                  ) : c.body && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                      {c.body}
                    </Typography>
                  )}

                  {filesOf[c.id]?.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <AttachmentGallery items={filesOf[c.id]} size="small" />
                    </Box>
                  )}
                </Box>
              </Stack>
            </Paper>
          )
        })}
      </Stack>
    </Stack>
  )
}
