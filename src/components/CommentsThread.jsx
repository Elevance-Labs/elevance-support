import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, IconButton, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { formatDateTime, toMillis } from '../lib/format'
import { can, COMMENT_EDIT_WINDOW_MS } from '../lib/permissions'
import { displayName } from '../lib/users'
import UserAvatar from './UserAvatar'

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
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null) // { id, body }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEditWindowTick(comments)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments').select('*').eq('issue_id', issueId).order('created_at')
    if (error) setError(error.message)
    setComments(data ?? [])
  }, [issueId])

  useEffect(() => { if (issueId) load() }, [issueId, load])

  const authorOf = useMemo(() => {
    const map = Object.fromEntries(users.map((u) => [u.id, u]))
    return (id) => map[id]
  }, [users])

  const post = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true); setError('')
    const { error } = await supabase.from('comments')
      .insert({ issue_id: issueId, author_id: profile.id, body })
    setBusy(false)
    if (error) return setError(error.message)
    setDraft(''); load()
  }

  const saveEdit = async () => {
    const body = editing.body.trim()
    if (!body) return
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
    const { error } = await supabase.from('comments').delete().eq('id', comment.id)
    if (error) {
      return setError(`${error.message} — the 5 minute edit window may have closed.`)
    }
    load()
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2" color="text.secondary">
        Comments {comments.length > 0 && `(${comments.length})`}
      </Typography>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

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
                            if (!busy && editing.body.trim()) saveEdit()
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
                  ) : (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                      {c.body}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Paper>
          )
        })}
      </Stack>
      {/* composer */}
      <Paper sx={{ p: 1.5 }}>
        <TextField
          fullWidth multiline minRows={2} size="small" placeholder="Add a comment…"
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (!isSubmitChord(e)) return
            e.preventDefault()          // otherwise the chord also types a newline
            if (!busy && draft.trim()) post()
          }}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
          <Typography variant="caption" color="text.disabled">
            {MOD_KEY_LABEL}+Enter to post
          </Typography>
          <Button size="small" variant="contained" onClick={post}
            disabled={busy || !draft.trim()}>
            Comment
          </Button>
        </Stack>
      </Paper>
    </Stack>
  )
}
