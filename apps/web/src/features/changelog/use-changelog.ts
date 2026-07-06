// Changelog data fetching for the What's New feature (i18n-aware).
import { useQuery } from '@tanstack/react-query'

const CHANGELOG_BASE_URL = 'https://app.cradle.wibus.ren/changelog'
const SUPPORTED_LOCALES = ['zh', 'en'] as const
const DEFAULT_LOCALE = 'zh'

export interface ChangelogEntry {
  version: string
  date: string
  title: Record<string, string>
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

async function fetchChangelogIndex(): Promise<ChangelogEntry[]> {
  const res = await fetch(`${CHANGELOG_BASE_URL}/index.json`)
  if (!res.ok) { throw new Error(`Failed to fetch changelog index: ${res.status}`) }
  return res.json()
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
