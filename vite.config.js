import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project site from /<repo>/, so the bundle has to be
// built with that prefix. Set VITE_BASE at build time ('/elevance-support/');
// leave it unset for Vercel, a custom domain, or local dev, all of which are
// served from the root.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
})
