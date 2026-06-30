import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkgRoot = fileURLToPath(new URL('.', import.meta.url))
const showcaseRoot = join(pkgRoot, 'showcase')

export default defineConfig({
  root: showcaseRoot,
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { outDir: join(showcaseRoot, 'dist'), emptyOutDir: true },
})
