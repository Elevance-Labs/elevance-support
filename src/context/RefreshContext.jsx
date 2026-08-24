import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/**
 * A bump counter that lets an action in the app chrome (creating an issue from
 * the header) tell whichever page is mounted to reload, without either side
 * knowing about the other.
 */
const RefreshContext = createContext({ signal: 0, refresh: () => {} })

export const useRefreshSignal = () => useContext(RefreshContext)

export function RefreshProvider({ children }) {
  const [signal, setSignal] = useState(0)
  const refresh = useCallback(() => setSignal((n) => n + 1), [])
  const value = useMemo(() => ({ signal, refresh }), [signal, refresh])
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}
