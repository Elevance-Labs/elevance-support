import { useCallback, useEffect, useState } from 'react'
import { Button, Tooltip } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { supabase } from '../lib/supabase'
import { watcherIds } from '../lib/notifications'

/**
 * The eye on a ticket — the same indicator as Elevance Work's: filled while
 * you watch, outlined while you don't, beside how many people do. Watching is
 * whether you hear about its comments, status changes and customer replies.
 * Saves at once, outside the dialog's draft.
 *
 * You start watching on your own when you are assigned, comment, are
 * mentioned or log the ticket. Unwatching is remembered — none of those puts
 * you back; only this button does (migration 0023).
 */
export default function WatchButton({ issueId, me, onError }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('issue_watchers').select('*').eq('issue_id', issueId)
    setRows(data ?? [])
  }, [issueId])

  useEffect(() => { if (issueId) load() }, [issueId, load])

  const watchers = watcherIds(rows)
  const watching = watchers.includes(me)

  const toggle = async () => {
    setBusy(true)
    const next = !watching
    // Shown at once; put back if the database says no.
    setRows((rs) => [...rs.filter((r) => r.user_id !== me), { issue_id: issueId, user_id: me, watching: next }])
    const { error } = await supabase.from('issue_watchers')
      .upsert({ issue_id: issueId, user_id: me, watching: next }, { onConflict: 'issue_id,user_id' })
    setBusy(false)
    if (error) onError?.(error.message)
    load()
  }

  return (
    <Tooltip title={watching ? 'Stop watching' : 'Watch: hear about every change'}>
      {/* A wrapper, so the tip still shows while a save has the button disabled. */}
      {/* Same size as the header's other buttons, and aligned as they are. */}
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>
        <Button color="inherit" disabled={busy || !me} onClick={toggle}
          startIcon={watching ? <VisibilityIcon /> : <VisibilityOutlinedIcon />}
          aria-pressed={watching} aria-label={watching ? 'Stop watching' : 'Watch'}>
          {watchers.length}
        </Button>
      </span>
    </Tooltip>
  )
}
