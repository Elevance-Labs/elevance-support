import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/** More than any box will ever show, and as many as one read returns. */
const FETCH_LIMIT = 1000

/**
 * The addresses a project has met, newest first — what the requester email and
 * the Cc suggest. Staff only: the table is not readable without a session, so
 * the public form must not ask (pass `enabled: false`). A failed read just
 * means no suggestions; nothing here is worth an error on the form.
 *
 * `reload` is for after a send: the database remembers a Cc once the email has
 * gone, so the next one can offer it.
 */
export default function useProjectContacts(projectId, { enabled = true } = {}) {
  const [contacts, setContacts] = useState([])

  const reload = useCallback(async () => {
    if (!enabled || !projectId) return setContacts([])
    const { data, error } = await supabase.from('project_contacts')
      .select('email, name, last_seen_at')
      .eq('project_id', projectId)
      .order('last_seen_at', { ascending: false })
      .limit(FETCH_LIMIT)
    setContacts(error ? [] : (data ?? []))
  }, [projectId, enabled])

  useEffect(() => { reload() }, [reload])

  return { contacts, reload }
}
