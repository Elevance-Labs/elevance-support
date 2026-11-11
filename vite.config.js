import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pwa } from './vite.pwa.js'

// GitHub Pages serves a project site from /<repo>/, so the bundle has to be
// built with that prefix. Set VITE_BASE at build time ('/elevance-support/');
// leave it unset for Vercel, a custom domain, or local dev, all of which are
// served from the root.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    // Installable, with the app's own files kept for a fast start. The public
    // pages — the embedded form, share links, company pages — are always
    // fetched fresh and never answered from the cached app.
    pwa({
      id: 'el-support',
      name: 'Elevance Support',
      shortName: 'Support',
      description: 'Support intake and tracking',
      themeColor: '#2563eb',
      backgroundColor: '#f6f7f9',
      passthrough: ['embed/', 'i/', 'tickets'],
    }),
  ],
})
