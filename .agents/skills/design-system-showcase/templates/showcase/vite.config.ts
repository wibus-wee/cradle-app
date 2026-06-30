import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Copy this file to showcase/vite.config.ts — no modification needed.
// The root is set to the showcase/ directory so index.html is found automatically.

const showcaseRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: showcaseRoot,
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
})
