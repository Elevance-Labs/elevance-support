import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { appOrigin } from '../lib/projects'
import { googleDomain, googleSignIn, returnedError, signInErrorMessage } from '../lib/signin'
import { SSO_PARAM, ssoHint } from '../lib/suite'
import { forgetPushDevice } from '../components/usePushDevice'

// A sign-in Google or Supabase refused comes back as an error in the address.
// Read once, as the module loads: the router replaces the address on its first
// redirect, and the login page still has to say what went wrong.
const refused = typeof window === 'undefined' ? '' : returnedError(window.location)

// Exported so tests can inject a role without a real session.
export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// A sibling app's switcher hands the person over with their company email in
// the address (`?sso=`). Read once, and taken out of the address so a reload,
// a bookmark or the return from Google never carries it again.
function takeSsoHint() {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  if (!url.searchParams.has(SSO_PARAM)) return null
  const hint = ssoHint(url.search, googleDomain())
  url.searchParams.delete(SSO_PARAM)
  window.history.replaceState(window.history.state, '', url)
  return hint
}
const handedOver = takeSsoHint()

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(() => signInErrorMessage(refused))

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
      // Handed over with no session here: straight to Google, naming the
      // account and showing no chooser. The page stays on its spinner until
      // Google takes over; only a sign-in that could not start falls through
      // to the login page.
      if (!data.session && handedOver) {
        const { error } = await supabase.auth.signInWithOAuth(
          googleSignIn(`${appOrigin()}/`, googleDomain(), handedOver))
        if (!error) return
        setAuthError(signInErrorMessage(error.message))
      }
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadProfile(s?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  // Off to Google and back. The account is found by its email: Supabase puts
  // the Google identity on the auth user that already has that address, so the
  // person returns to the profile — and the tickets — they always had. Someone
  // disabled is banned at the auth layer and comes back with an error instead;
  // `loadProfile` covers a session that was already open.
  const signIn = async () => {
    setAuthError('')
    const { error } = await supabase.auth.signInWithOAuth(googleSignIn(`${appOrigin()}/`))
    if (error) setAuthError(signInErrorMessage(error.message))
    return { error }
  }
  // This device stops getting the person's notifications first — while the
  // session that may delete its row still exists.
  const signOut = async () => {
    await forgetPushDevice()
    return supabase.auth.signOut()
  }

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
        session, profile, loading, authError, signIn, signOut, refreshProfile,
        isAdmin: profile?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
