import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const mock = path.resolve('test/mockSupabase.js')

// A VAPID public key, so the device-notification controls have something to
// subscribe with. Read by Vite as the build would read it from the env.
process.env.VITE_VAPID_PUBLIC_KEY ??=
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mock-supabase',
      enforce: 'pre',
      resolveId(source, importer) {
        if (/(^|\/)lib\/supabase(\.js)?$/.test(source)) return mock
        // Modules inside src/lib import their sibling as './supabase'.
        if (/^\.\/supabase(\.js)?$/.test(source) && importer?.includes('/src/lib/')) return mock
        return null
      },
    },
  ],
})
