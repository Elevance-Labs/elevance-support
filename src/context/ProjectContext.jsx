import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { byName } from '../lib/projects'

// An inert default, following RefreshContext: a component rendered outside the
// provider degrades to "no project selected" rather than throwing. Nothing in
// the app relies on it — it exists so a dialog can't take the page down.
const EMPTY = {
  projects: [], project: null, projectId: null,
  setProjectId: () => {}, refresh: () => {}, loading: true,
}

const ProjectContext = createContext(EMPTY)
export const useProject = () => useContext(ProjectContext)

/** Where the last-used project is remembered, so it survives a reload. */
export const STORAGE_KEY = 'el-support.project'

// localStorage is unavailable in a private window and throws rather than
// returning null, so neither side of it may be called bare.
const readStored = () => {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}
const writeStored = (id) => {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* not fatal */ }
}

/**
 * Which project everything is scoped to.
 *
 * Exactly one is always selected: there is no "all projects" view, and no state
 * in which the pages have nothing to show but data. The choice persists, so
 * signing in lands you back where you were working.
 *
 * `pick` decides the opening selection: the remembered project when it is still
 * one you can see, otherwise the first. A project you have been removed from
 * cannot be resurrected by a stale localStorage entry.
 */
export function chooseProject(projects, storedId) {
  if (!projects?.length) return null
  if (storedId && projects.some((p) => p.id === storedId)) return storedId
  return projects[0].id
}

export function ProjectProvider({ children }) {
  const [projects, setProjects] = useState([])
  const [projectId, setId] = useState(readStored)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    // RLS returns only the projects this user belongs to (admins see them all),
    // so the picker can never offer a project whose tickets would come back empty.
    const { data } = await supabase
      .from('projects').select('*').order('name')
    const rows = [...(data ?? [])].sort(byName)
    setProjects(rows)
    setId((current) => {
      const next = chooseProject(rows, current)
      // Remember the opening choice as well as a deliberate one — otherwise a
      // reload keeps landing on the first project instead of this one.
      if (next && next !== current) writeStored(next)
      return next
    })
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const setProjectId = useCallback((id) => {
    if (!id) return
    setId(id)
    writeStored(id)
  }, [])

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  )

  const value = useMemo(
    () => ({ projects, project, projectId, setProjectId, refresh, loading }),
    [projects, project, projectId, setProjectId, refresh, loading],
  )

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}
