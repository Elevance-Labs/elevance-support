import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Exported so tests can inject a role without a real session.
export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) return setProfile(null)
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()

    // Banning the auth user blocks new sign-ins, but someone disabled mid-session
    // still holds a valid token until it expires. Drop them as soon as we notice.
    if (data && data.is_active === false) {
      await supabase.auth.signOut()
      setProfile(null)
      setSession(null)
      return
    }
    setProfile(data ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadProfile(s?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signIn = async (email, password) => {
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result.error) return result

    const { data: p } = await supabase
      .from('profiles').select('is_active').eq('id', result.data.user.id).single()
    if (p && p.is_active === false) {
      await supabase.auth.signOut()
      return { error: { message: 'This account has been disabled. Contact an administrator.' } }
    }
    return result
  }
  const signOut = () => supabase.auth.signOut()

  // The Profile page writes the signed-in user's own row; the header reads it.
  // Re-reading here is what keeps the two in step without either knowing about
  // the other.
  const refreshProfile = useCallback(
    () => loadProfile(session?.user?.id),
    [loadProfile, session?.user?.id],
  )

  return (
    <AuthContext.Provider
      value={{
        session, profile, loading, signIn, signOut, refreshProfile,
        isAdmin: profile?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
