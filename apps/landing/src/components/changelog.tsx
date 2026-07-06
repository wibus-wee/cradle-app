/**
 * Changelog — editorial release manifest
 *
 * Asymmetric two-column layout: a sticky left rail with version stations
 * (scroll-spy + keyboard nav), and a right column where each release is a
 * card. The latest release wears the StarBorders frame; the rest read like
 * a thoughtfully typeset markdown changelog.
 *
 * Release bodies are markdown strings rendered via `marked`. Styling lives
 * in styles.css under the `.changelog-md` scope so headings, lists, code,
 * and the leading blockquote tagline all read cleanly inside the blueprint
 * aesthetic.
 *
 * Data is loaded at runtime from /changelog/index.json + individual .md files.
 */

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { marked } from 'marked'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { StarBorders } from './blueprint-annotations'
import { MeshGradient } from './mesh-gradient'

marked.setOptions({ gfm: true, breaks: false })

/* ─── Types ───────────────────────────────────────────────────── */

interface ChangelogIndexEntry {
  version: string
  date: string
  title: Record<string, string>
  languages: string[]
}

interface Release {
  version: string
  date: string
  title: string
  body: string
  featured?: boolean
}

function resolveLocale(): string {
  const lang = navigator.language || 'zh'
  const short = lang.split('-')[0].toLowerCase()
  return short === 'en' ? 'en' : 'zh'
}

/* ─── Frontmatter parser ──────────────────────────────────────── */

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

/* ─── Data fetching ───────────────────────────────────────────── */

function useChangelogData() {
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const indexRes = await fetch('/changelog/index.json')
        if (!indexRes.ok) { throw new Error('Failed to fetch changelog index') }
        const index: ChangelogIndexEntry[] = await indexRes.json()

        const locale = resolveLocale()

        const loaded: Release[] = await Promise.all(
          index.map(async (entry, i) => {
            const lang = entry.languages.includes(locale)
              ? locale
              : entry.languages.includes('zh') ? 'zh' : entry.languages[0]
            const res = await fetch(`/changelog/${entry.version}.${lang}.md`)
            if (!res.ok) { throw new Error(`Failed to fetch ${entry.version}.${lang}.md`) }
            const raw = await res.text()
            const { body } = parseFrontmatter(raw)
            return {
              version: entry.version,
              date: entry.date,
              title: entry.title[locale] || entry.title.zh || entry.title.en || Object.values(entry.title)[0] || '',
              body,
              featured: i === 0,
            }
          }),
        )

        if (!cancelled) {
          setReleases(loaded)
          setLoading(false)
        }
      }
      catch (err) {
        console.error('Failed to load changelog:', err)
        if (!cancelled) { setLoading(false) }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  return { releases, loading }
}

/* ─── Date formatter ───────────────────────────────────────────── */

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/* ─── Markdown body ────────────────────────────────────────────── */

function MarkdownBody({ body, featured }: { body: string, featured?: boolean }) {
  const html = useMemo(() => marked.parse(body) as string, [body])
  return (
    <div
      className={`changelog-md${featured ? ' changelog-md--featured' : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/* ─── Compact commit graph strip (hero decoration) ─────────────── */

function CommitGraph() {
  const dots = useMemo(() => {
    const n = 18
    return Array.from({ length: n }, (_, i) => {
      const seed = (i * 9301 + 49297) % 233280
      const r = seed / 233280
      return { i, offset: r * 4 - 2, hot: i === n - 3 }
    })
  }, [])
  return (
    <div aria-hidden style={{ position: 'relative', height: 32, width: '100%', marginTop: 36 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'var(--border-subtle)' }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${dots.length}, 1fr)`,
          alignItems: 'center',
        }}
      >
        {dots.map(d => (
          <div
            key={d.i}
            style={{
              justifySelf: 'center',
              width: d.hot ? 5 : 3,
              height: d.hot ? 5 : 3,
              borderRadius: '50%',
              transform: `translateY(${d.offset}px)`,
              background: d.hot ? 'var(--text-secondary)' : 'var(--border)',
              opacity: d.hot ? 1 : 0.7,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/* ─── Release entry ────────────────────────────────────────────── */

function ReleaseCard({ release }: { release: Release }) {
  const inner = (
    <motion.article
      id={`release-${release.version}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px -10% 0px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{ marginBottom: 56, scrollMarginTop: 80 }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-muted)',
            letterSpacing: '-0.02em',
          }}
        >
          v
{release.version}
        </span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--border-strong)' }} />
        <time
          style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          dateTime={release.date}
        >
          {formatDate(release.date)}
        </time>
        {release.featured && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--text)',
              background: 'var(--fill-hover)',
              border: '1px solid var(--border-strong)',
              padding: '3px 8px',
              textTransform: 'uppercase',
            }}
          >
            Latest
          </span>
        )}
      </header>

      <MarkdownBody body={release.body} featured={release.featured} />
    </motion.article>
  )

  if (release.featured) {
    return (
      <div style={{ marginBottom: 56 }}>
        <StarBorders>
          <div style={{ padding: '28px 28px 22px' }}>{inner}</div>
        </StarBorders>
      </div>
    )
  }
  return inner
}

/* ─── Sticky left rail with version stations ───────────────────── */

function VersionRail({
  releases,
  active,
  onSelect,
}: {
  releases: Release[]
  active: string
  onSelect: (v: string) => void
}) {
  return (
    <aside style={{ position: 'sticky', top: 80, alignSelf: 'start' }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 18,
          paddingLeft: 20,
        }}
      >
        Releases
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
        <div
          aria-hidden
          style={{ position: 'absolute', left: 7, top: 6, bottom: 6, width: 1, background: 'var(--border)' }}
        />
        {releases.map((r) => {
          const isActive = r.version === active
          return (
            <li key={r.version} style={{ position: 'relative' }}>
              <button
                onClick={() => onSelect(r.version)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '7px 0 7px 20px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 3,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: isActive ? 9 : 7,
                    height: isActive ? 9 : 7,
                    borderRadius: '50%',
                    background: isActive ? 'var(--text)' : 'var(--bg)',
                    border: `1px solid ${isActive ? 'var(--text)' : 'var(--border-strong)'}`,
                    boxShadow: isActive ? '0 0 0 3px var(--bg), 0 0 0 4px var(--text)' : 'none',
                    transition: 'all 0.25s',
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: isActive ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: isActive ? 600 : 400,
                    transition: 'color 0.2s',
                  }}
                >
                  v
{r.version}
                </span>
                {isActive && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', paddingRight: 4 }}>
                    {formatDate(r.date).split(' ')[0]}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>

      <div
        style={{
          marginTop: 24,
          paddingLeft: 20,
          fontSize: 11,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <kbd style={kbdStyle}>↑</kbd>
        <kbd style={kbdStyle}>↓</kbd>
        <span>to jump releases</span>
      </div>
    </aside>
  )
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 4px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-secondary)',
  background: 'var(--fill)',
  border: '1px solid var(--border)',
  borderRadius: 3,
}

/* ─── Page ─────────────────────────────────────────────────────── */

export function ChangelogPage({ onBack }: { onBack: () => void }) {
  const { releases, loading } = useChangelogData()
  const [active, setActive] = useState('')
  const railRefs = useRef<Map<string, Element>>(new Map())

  // Set initial active version once data loads
  useEffect(() => {
    if (releases.length > 0 && !active) {
      setActive(releases[0].version)
    }
  }, [releases, active])

  useEffect(() => {
    if (releases.length === 0) { return }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          setActive(visible[0].target.id.replace('release-', ''))
        }
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: 0 },
    )
    for (const r of releases) {
      const el = document.getElementById(`release-${r.version}`)
      if (el) {
        observer.observe(el)
        railRefs.current.set(r.version, el)
      }
    }
    return () => observer.disconnect()
  }, [releases])

  useEffect(() => {
    if (releases.length === 0) { return }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return }
      const idx = releases.findIndex(r => r.version === active)
      if (idx === -1) { return }
      const next = e.key === 'ArrowDown' ? Math.min(idx + 1, releases.length - 1) : Math.max(idx - 1, 0)
      const target = releases[next]
      if (target.version === active) { return }
      e.preventDefault()
      railRefs.current.get(target.version)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActive(target.version)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, releases])

  const jumpTo = useCallback((v: string) => {
    railRefs.current.get(v)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(v)
  }, [])

  if (loading) {
    return (
      <main style={{ paddingTop: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>Loading changelog…</span>
      </main>
    )
  }

  return (
    <main style={{ paddingTop: 48 }}>
      <section
        style={{
          padding: 'clamp(60px, 12dvh, 120px) 24px 40px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <MeshGradient />
        <div style={{ maxWidth: 960, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              onClick={onBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                marginBottom: 36,
                color: 'var(--text-muted)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <ArrowLeft style={{ width: 12, height: 12 }} />
              back to landing
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <span style={{ fontSize: 14 }}>✦</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Changelog
              </span>
            </div>

            <h1
              style={{
                fontSize: 'clamp(2.4rem, 7vw, 4.6rem)',
                fontWeight: 700,
                lineHeight: 0.95,
                letterSpacing: '-0.04em',
                color: 'var(--text)',
                marginBottom: 16,
              }}
            >
              What shifted,
              <br />
              <span style={{ color: 'var(--text-muted)' }}>release by release.</span>
            </h1>

            <p
              style={{
                fontSize: 'clamp(0.95rem, 1.4vw, 1.05rem)',
                lineHeight: 1.7,
                color: 'var(--text-secondary)',
                maxWidth: 480,
              }}
            >
              Every change to the command center, in the order it shipped.
            </p>

            <CommitGraph />
          </motion.div>
        </div>
      </section>

      <section
        style={{
          padding: '20px 24px 80px',
          background: 'var(--bg-subtle)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '200px 1fr',
            gap: 56,
            alignItems: 'start',
          }}
        >
          <VersionRail releases={releases} active={active} onSelect={jumpTo} />

          <div>
            {releases.map(r => (
              <ReleaseCard key={r.version} release={r} />
            ))}

            <div
              style={{
                marginTop: 24,
                paddingTop: 32,
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.2em',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                — End of log —
              </span>
              <button
                onClick={onBack}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text)'
                  e.currentTarget.style.borderColor = 'var(--border-strong)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)'
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                back to landing
                <ArrowRight style={{ width: 12, height: 12 }} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
