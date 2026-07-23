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
  summary?: Record<string, string>
  announce?: boolean
  showAfter?: string
  languages: string[]
}

interface BlogEntry {
  slug: string
  date: string
  title: Record<string, string>
  description: Record<string, string>
  cover?: string
  author?: string
  tags: string[]
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
      const versionMap = new Map<string, {
        languages: string[]
        title: Record<string, string>
        summary?: Record<string, string>
        announce?: boolean
        showAfter?: string
        date: string
      }>()

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
          if (meta.summary) {
            existing.summary = existing.summary || {}
            existing.summary[locale] = meta.summary
          }
          if (meta.announce === 'true') { existing.announce = true }
          if (meta.showAfter) { existing.showAfter = meta.showAfter }
        }
        else {
          versionMap.set(meta.version, {
            date: meta.date,
            languages: [locale],
            title: { [locale]: meta.title || '' },
            summary: meta.summary ? { [locale]: meta.summary } : undefined,
            announce: meta.announce === 'true' ? true : undefined,
            showAfter: meta.showAfter || undefined,
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

function blogIndexPlugin(): Plugin {
  const blogDir = resolve(__dirname, 'blog')
  const outDir = resolve(__dirname, 'public', 'blog')

  return {
    name: 'blog-index',
    buildStart() {
      mkdirSync(outDir, { recursive: true })

      let files: string[] = []
      try {
        files = readdirSync(blogDir).filter(f => f.endsWith('.md'))
      }
      catch {
        writeFileSync(join(outDir, 'index.json'), '[]')
        return
      }

      // Group files by slug: slug.zh.md / slug.en.md → slug
      const postMap = new Map<string, { languages: string[], title: Record<string, string>, description: Record<string, string>, date: string, cover?: string, author?: string, tags: string[] }>()

      for (const file of files) {
        const content = readFileSync(join(blogDir, file), 'utf-8')
        const { meta } = parseFrontmatter(content)
        if (!meta.date || !meta.title) { continue }

        // Extract slug + locale from filename: hello-cradle.zh.md → hello-cradle, zh
        const nameMatch = /^(.+)\.(\w+)\.md$/.exec(file)
        if (!nameMatch) { continue }
        const slug = nameMatch[1]
        const locale = nameMatch[2]
        const tags = meta.tags ? meta.tags.split(',').map(t => t.trim()).filter(Boolean) : []

        const existing = postMap.get(slug)
        if (existing) {
          existing.languages.push(locale)
          existing.title[locale] = meta.title
          existing.description[locale] = meta.description || ''
          if (meta.cover) { existing.cover = meta.cover }
          if (meta.author) { existing.author = meta.author }
          if (tags.length > 0) { existing.tags = tags }
        }
        else {
          postMap.set(slug, {
            date: meta.date,
            languages: [locale],
            title: { [locale]: meta.title },
            description: { [locale]: meta.description || '' },
            cover: meta.cover || undefined,
            author: meta.author || undefined,
            tags,
          })
        }

        // Copy .md file to public/blog/
        cpSync(join(blogDir, file), join(outDir, file), { recursive: true })
      }

      const entries: BlogEntry[] = Array.from(postMap.entries(), ([slug, data]) => ({ slug, ...data }))
        .sort((a, b) => b.date.localeCompare(a.date))

      writeFileSync(join(outDir, 'index.json'), JSON.stringify(entries, null, 2))

      // RSS feed (English titles preferred, fall back to whatever exists)
      const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const items = entries.map((e) => {
        const title = e.title.en || Object.values(e.title)[0] || e.slug
        const description = e.description.en || Object.values(e.description)[0] || ''
        return [
          '    <item>',
          `      <title>${escapeXml(title)}</title>`,
          `      <link>https://cradle.app/#/blog/${e.slug}</link>`,
          `      <guid>https://cradle.app/#/blog/${e.slug}</guid>`,
          `      <pubDate>${new Date(`${e.date}T00:00:00Z`).toUTCString()}</pubDate>`,
          `      <description>${escapeXml(description)}</description>`,
          '    </item>',
        ].join('\n')
      }).join('\n')
      const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Cradle Blog</title>
    <link>https://cradle.app/#/blog</link>
    <description>Longer-form writing about what we're building and why.</description>
${items}
  </channel>
</rss>
`
      writeFileSync(join(outDir, 'rss.xml'), rss)
    },
  }
}

/**
 * Feature tips for the in-app corner popup. The source is a hand-maintained
 * JSON file (`tips/index.json`); this copies it to `public/tips/` so the
 * desktop app can fetch it alongside the changelog.
 */
function tipsIndexPlugin(): Plugin {
  const tipsFile = resolve(__dirname, 'tips', 'index.json')
  const outDir = resolve(__dirname, 'public', 'tips')

  return {
    name: 'tips-index',
    buildStart() {
      mkdirSync(outDir, { recursive: true })
      let content = '[]'
      try {
        content = readFileSync(tipsFile, 'utf-8')
      }
      catch {
        // No tips defined — serve an empty index.
      }
      writeFileSync(join(outDir, 'index.json'), content)
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), changelogIndexPlugin(), blogIndexPlugin(), tipsIndexPlugin()],
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
