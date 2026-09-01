import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

const ConfigContext = createContext(null)
export const useConfig = () => useContext(ConfigContext)

// `label` names the tab, `singular` names the Add/Edit button and dialog title.
// Both are spelled out because "Statuses" and "Priorities" don't singularise by
// trimming a trailing "s".
export const LIST_TYPES = [
  { key: 'type',     label: 'Types',      singular: 'Type' },
  { key: 'product',  label: 'Products',   singular: 'Product' },
  { key: 'area',     label: 'Areas',      singular: 'Area' },
  { key: 'priority', label: 'Priorities', singular: 'Priority' },
  { key: 'status',   label: 'Statuses',   singular: 'Status' },
  { key: 'labels',   label: 'Labels',     singular: 'Label' },
  { key: 'source',   label: 'Sources',    singular: 'Source' },
]

/**
 * The one source staff never pick: it means the request came through the public
 * embed form, which the database stamps for itself. Renaming or deactivating it
 * on the Configuration page changes only how it reads, not what gets stored.
 */
export const PUBLIC_SOURCE = 'Form'

/**
 * Loads every configuration list once and exposes them grouped by list_type.
 * Also carries the user roster, since assignee pickers need it everywhere.
 */
export function ConfigProvider({ children, withUsers = true }) {
  const [items, setItems] = useState([])
  const [users, setUsers] = useState([])
  // Companies have no Configuration tab — they are maintained in the Supabase
  // dashboard — but every form and filter needs the list, so it loads here with
  // the rest of the vocabulary.
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('list_items').select('*')
      .order('list_type').order('sort_order').order('name')
    setItems(data ?? [])
    const { data: c } = await supabase.from('companies').select('*').order('name')
    setCompanies(c ?? [])
    if (withUsers) {
      const { data: u } = await supabase.from('profiles').select('*').order('full_name')
      setUsers(u ?? [])
    }
    setLoading(false)
  }, [withUsers])

  useEffect(() => { refresh() }, [refresh])

  const lists = useMemo(() => {
    const grouped = Object.fromEntries(LIST_TYPES.map((l) => [l.key, []]))
    for (const item of items) (grouped[item.list_type] ??= []).push(item)
    return grouped
  }, [items])

  const colorOf = useCallback(
    (listType, name) => lists[listType]?.find((i) => i.name === name)?.color ?? null,
    [lists],
  )

  const statuses = useMemo(
    () => (lists.status ?? []).filter((s) => s.is_active),
    [lists.status],
  )

  return (
    <ConfigContext.Provider
      value={{ lists, users, companies, statuses, loading, refresh, colorOf }}>
      {children}
    </ConfigContext.Provider>
  )
}
