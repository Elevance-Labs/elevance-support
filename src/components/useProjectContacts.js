import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withContactNames } from '../lib/contacts'

/** More than any box will ever show, and as many as one read returns. */
const FETCH_LIMIT = 1000

/**
 * The addresses a project has met, newest first, each named after its contact
 * — what the requester email and the Cc suggest, searchable by either. Staff only: the table is not readable without a session, so
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
    // The addresses, and the people they belong to — so a name finds them all.
    const [{ data, error }, { data: people }] = await Promise.all([
      supabase.from('project_contacts')
        .select('email, contact_id, last_seen_at')
        .eq('project_id', projectId)
        .order('last_seen_at', { ascending: false })
        .limit(FETCH_LIMIT),
      supabase.from('contacts').select('id, name').eq('project_id', projectId),
    ])
    setContacts(error ? [] : withContactNames(data ?? [], people ?? []))
  }, [projectId, enabled])

  useEffect(() => { reload() }, [reload])

  return { contacts, reload }
}
