import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const mock = path.resolve('test/mockSupabase.js')

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
