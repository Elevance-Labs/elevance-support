import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && key && !url.includes('your-project'))

if (!isConfigured) {
  console.warn('Supabase is not configured — copy .env.example to .env and fill it in.')
}

// PKCE: Google sign-in comes back with a one-time code in the query string,
// which only this browser can exchange, instead of tokens in the address.
export const supabase = createClient(url || 'http://localhost', key || 'public-anon-key', {
  auth: { flowType: 'pkce' },
})
