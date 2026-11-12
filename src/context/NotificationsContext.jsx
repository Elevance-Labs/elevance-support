import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { badgeCount, unreadCount } from '../lib/notifications'
import { onWorkerMessage, setAppBadge } from '../pwa'

/** How many of the latest the bell holds. Older ones stay in the table. */
const FEED_SIZE = 50

// The ticket and comment come along so the bell can say which ticket and
// quote the comment without a second round trip.
const SELECT = '*, issue:issues(id, number, title, project_id), comment:comments(body)'

// Outside a provider — a page rendered on its own in a test — everything is a
// harmless no-op rather than a crash.
const NotificationsContext = createContext({
  items: [], unread: 0, loading: false,
  reload: async () => {}, markRead: async () => {}, markIssueRead: async () => {}, markAllRead: async () => {},
})
export const useNotifications = () => useContext(NotificationsContext)

/**
 * Your notifications, for the bell and for whatever marks them read.
 *
 * Live: rows arrive over Supabase Realtime as the triggers write them (RLS
 * sends each person only their own), and again whenever a push lands or the
 * app comes back to the front — a phone asleep in a pocket misses realtime
 * messages, and the push is what woke it. The unread count is also the badge
 * on an installed app's icon.
 *
 * Whether this device gets them as well is the bell's to check (it asks
 * `usePushDevice`, which also refreshes the device's registration).
 *
 * Opening a ticket marks its notifications read (`markIssueRead`, called by
 * the ticket dialog): having looked is what reading one means.
 */
export function NotificationsProvider({ children }) {
  const { profile } = useAuth()
  const me = profile?.id
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const pending = useRef(null)

  const reload = useCallback(async () => {
    if (!me) return
    const { data } = await supabase.from('notifications').select(SELECT)
      .eq('recipient_id', me).order('created_at', { ascending: false }).limit(FEED_SIZE)
    setItems(data ?? [])
    setLoading(false)
  }, [me])

  // A burst of rows (a comment reaching five watchers) is one reload.
  const soon = useCallback(() => {
    clearTimeout(pending.current)
    pending.current = setTimeout(reload, 250)
  }, [reload])

  useEffect(() => {
    if (!me) return undefined
    reload()
    const channel = supabase.channel?.(`notifications:${me}`)
      ?.on?.('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me}` }, soon)
      ?.subscribe?.()
    const offWorker = onWorkerMessage((m) => { if (m.type === 'push') soon() })
    const onVisible = () => { if (document.visibilityState === 'visible') soon() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(pending.current)
      if (channel) supabase.removeChannel?.(channel)
      offWorker()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [me, reload, soon])

  const unread = unreadCount(items)
  useEffect(() => { setAppBadge(badgeCount(unread)) }, [unread])

  /** Marks these read — on screen at once, then in the table. */
  const markRead = useCallback(async (ids) => {
    const list = (ids ?? []).filter(Boolean)
    if (!list.length) return
    const now = new Date().toISOString()
    setItems((rows) => rows.map((r) => (list.includes(r.id) && !r.read_at ? { ...r, read_at: now } : r)))
    await supabase.from('notifications').update({ read_at: now }).in('id', list)
  }, [])

  // Called by the ticket dialog when the feed holds something unread about
  // the ticket it is showing.
  const markIssueRead = useCallback(async (issueId) => {
    if (!issueId || !me) return
    const now = new Date().toISOString()
    setItems((rows) => rows.map((r) => (r.issue_id === issueId && !r.read_at ? { ...r, read_at: now } : r)))
    // By ticket rather than by the ids on screen: older unread ones about it,
    // past the end of the feed, are just as read.
    await supabase.from('notifications').update({ read_at: now })
      .eq('recipient_id', me).eq('issue_id', issueId).is('read_at', null)
  }, [me])

  const markAllRead = useCallback(async () => {
    if (!me) return
    const now = new Date().toISOString()
    setItems((rows) => rows.map((r) => (r.read_at ? r : { ...r, read_at: now })))
    await supabase.from('notifications').update({ read_at: now })
      .eq('recipient_id', me).is('read_at', null)
  }, [me])

  const value = useMemo(
    () => ({ items, unread, loading, reload, markRead, markIssueRead, markAllRead }),
    [items, unread, loading, reload, markRead, markIssueRead, markAllRead],
  )
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}
