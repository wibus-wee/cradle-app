import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

interface ChangelogEntry {
  version: string
  date: string
  title: Record<string, string>
  languages: string[]
}

function parseFrontmatter(content: string): { meta: Record<string, string>, body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content)
  if (!match) { return { meta: {}, body: content } }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }
  return { meta, body: match[2].trim() }
}

function changelogIndexPlugin(): Plugin {
  const changelogDir = resolve(__dirname, 'changelog')
  const outDir = resolve(__dirname, 'public', 'changelog')

  return {
    name: 'changelog-index',
    buildStart() {
      const files = readdirSync(changelogDir).filter(f => f.endsWith('.md'))

      // Group files by version: version.zh.md / version.en.md → version
      const versionMap = new Map<string, { languages: string[], title: Record<string, string>, date: string }>()

      mkdirSync(outDir, { recursive: true })

      for (const file of files) {
        const content = readFileSync(join(changelogDir, file), 'utf-8')
        const { meta } = parseFrontmatter(content)
        if (!meta.version || !meta.date) { continue }

        // Extract locale from filename: dev-20260621.1.zh.md → zh
        const localeMatch = /^(.+)\.(\w+)\.md$/.exec(file)
        const locale = localeMatch ? localeMatch[2] : 'zh'

        const existing = versionMap.get(meta.version)
        if (existing) {
          existing.languages.push(locale)
          existing.title[locale] = meta.title || ''
        }
 else {
          versionMap.set(meta.version, {
            date: meta.date,
            languages: [locale],
            title: { [locale]: meta.title || '' },
          })
        }

        // Copy .md file to public/changelog/
        cpSync(join(changelogDir, file), join(outDir, file), { recursive: true })
      }

      // Build sorted index
      const entries: ChangelogEntry[] = Array.from(versionMap.entries(), ([version, data]) => ({ version, ...data }))
        .sort((a, b) => b.date.localeCompare(a.date))

      const indexPath = join(outDir, 'index.json')
      writeFileSync(indexPath, JSON.stringify(entries, null, 2))
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), changelogIndexPlugin()],
  define: command === 'build'
? {
    'process.env.NODE_ENV': JSON.stringify('production'),
  }
: undefined,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) {
            return 'react'
          }
          if (id.includes('/node_modules/motion/') || id.includes('/node_modules/framer-motion/') || id.includes('/node_modules/gsap/') || id.includes('/node_modules/@gsap/react/')) {
            return 'animation'
          }
          if (id.includes('/node_modules/lucide-react/')) {
            return 'icons'
          }
        },
      },
    },
  },
}))
