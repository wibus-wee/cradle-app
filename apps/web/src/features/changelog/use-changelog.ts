// Changelog data fetching for the What's New feature (i18n-aware).
import { useQuery } from '@tanstack/react-query'

const CHANGELOG_BASE_URL = 'https://app.cradle.wibus.ren/changelog'
const SUPPORTED_LOCALES = ['zh', 'en'] as const
const DEFAULT_LOCALE = 'zh'

export interface ChangelogEntry {
  version: string
  date: string
  title: Record<string, string>
  summary?: Record<string, string>
  announce?: boolean
  showAfter?: string
  /** Inline localized markdown body. Dev mocks only — real entries fetch remote files. */
  markdown?: Record<string, string>
  languages: string[]
}

export const CHANGELOG_INDEX_QUERY_KEY = ['changelog', 'index'] as const

function resolveLocale(): string {
  // Try to get locale from i18next or browser language
  const lang = document.documentElement.lang || navigator.language || DEFAULT_LOCALE
  const short = lang.split('-')[0].toLowerCase()
  return SUPPORTED_LOCALES.includes(short as typeof SUPPORTED_LOCALES[number]) ? short : DEFAULT_LOCALE
}

function resolveLanguage(entry: ChangelogEntry, locale: string): string {
  if (entry.languages.includes(locale)) { return locale }
  if (entry.languages.includes(DEFAULT_LOCALE)) { return DEFAULT_LOCALE }
  return entry.languages[0]
}

/** Resolve a localized frontmatter field (title/summary) against the current locale. */
export function resolveLocalizedText(text: Record<string, string> | string | undefined, fallback = ''): string {
  if (!text) { return fallback }
  if (typeof text === 'string') { return text }
  const short = resolveLocale()
  return text[short] || text.zh || text.en || Object.values(text)[0] || fallback
}

/** Dev-only: prepend mock entries so the What's New surfaces are previewable offline. */
async function withDevMockEntries(entries: ChangelogEntry[]): Promise<ChangelogEntry[]> {
  if (!import.meta.env.DEV) { return entries }
  const { devMockChangelogEntries } = await import('./whats-new-dev-mocks')
  const mockVersions = new Set(devMockChangelogEntries.map(e => e.version))
  return [...devMockChangelogEntries, ...entries.filter(e => !mockVersions.has(e.version))]
}

async function fetchChangelogIndex(): Promise<ChangelogEntry[]> {
  try {
    const res = await fetch(`${CHANGELOG_BASE_URL}/index.json`)
    if (!res.ok) { throw new Error(`Failed to fetch changelog index: ${res.status}`) }
    return withDevMockEntries(await res.json())
  }
  catch (error) {
    // In dev, fall back to mocks alone so previews work offline.
    if (import.meta.env.DEV) { return withDevMockEntries([]) }
    throw error
  }
}

export function useChangelogIndex() {
  return useQuery({
    queryKey: CHANGELOG_INDEX_QUERY_KEY,
    queryFn: fetchChangelogIndex,
    staleTime: 1000 * 60 * 30, // 30 minutes
    retry: 1,
  })
}

export function useChangelogEntry(version: string | null, entry?: ChangelogEntry | null) {
  const locale = resolveLocale()

  return useQuery({
    queryKey: ['changelog', 'entry', version, locale],
    queryFn: async () => {
      if (!version || !entry) { return null }
      // Dev mocks carry their markdown inline instead of a remote file.
      if (entry.markdown) { return resolveLocalizedText(entry.markdown) }
      const lang = resolveLanguage(entry, locale)
      const res = await fetch(`${CHANGELOG_BASE_URL}/${version}.${lang}.md`)
      if (!res.ok) { throw new Error(`Failed to fetch changelog for ${version} (${lang}): ${res.status}`) }
      return res.text()
    },
    enabled: !!version && !!entry,
    staleTime: 1000 * 60 * 60, // 1 hour — changelog content is immutable
    retry: 1,
  })
}
