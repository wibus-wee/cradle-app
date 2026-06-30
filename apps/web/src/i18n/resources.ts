export const DEFAULT_LOCALE = 'en-US'
export const LOCALE_COOKIE = 'cradle-locale'
export const LOCALE_QUERY_PARAM = 'hl'

export const locales = ['en-US', 'zh-CN', 'ja-JP', 'es-ES'] as const
export type SupportedLocale = (typeof locales)[number]

const localeMap: Record<string, SupportedLocale> = {
  'en': 'en-US',
  'en-us': 'en-US',
  'zh': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'ja': 'ja-JP',
  'ja-jp': 'ja-JP',
  'es': 'es-ES',
  'es-es': 'es-ES',
}

export function normalizeLocale(raw?: string | null): SupportedLocale {
  if (!raw) {
    return DEFAULT_LOCALE
  }

  const lower = raw.trim().toLowerCase()
  if (localeMap[lower]) {
    return localeMap[lower]
  }

  const prefix = lower.split(/[-_]/)[0]
  if (localeMap[prefix]) {
    return localeMap[prefix]
  }

  return DEFAULT_LOCALE
}

export function isSupportedLocale(raw: string): raw is SupportedLocale {
  return (locales as readonly string[]).includes(raw)
}

export function matchSupportedLocale(raw?: string | null): SupportedLocale | null {
  if (!raw) {
    return null
  }

  const lower = raw.trim().toLowerCase()
  if (localeMap[lower]) {
    return localeMap[lower]
  }

  const prefix = lower.split(/[-_]/)[0]
  return localeMap[prefix] ?? null
}

export function resolveAcceptLanguage(header: string): SupportedLocale {
  const candidates = header
    .split(',')
    .map((item, index) => {
      const [tag, ...params] = item.trim().split(';')
      const qualityParam = params
        .map(param => param.trim())
        .find(param => param.startsWith('q='))
        ?.slice(2)

      return {
        index,
        locale: matchSupportedLocale(tag),
        quality: qualityParam ? Number.parseFloat(qualityParam) : 1,
      }
    })
    .filter((item): item is { index: number, locale: SupportedLocale, quality: number } => {
      return item.locale !== null && Number.isFinite(item.quality)
    })
    .sort((a, b) => {
      if (b.quality !== a.quality) {
        return b.quality - a.quality
      }
      return a.index - b.index
    })

  return candidates[0]?.locale ?? DEFAULT_LOCALE
}

export function resolveBrowserLanguage(languages: readonly string[] = []): SupportedLocale {
  if (languages.length === 0) {
    return DEFAULT_LOCALE
  }

  return resolveAcceptLanguage(languages.join(','))
}

const rtlLanguageCodes = new Set(['ar', 'he', 'fa', 'ur'])

export function isRtl(locale: string): boolean {
  const prefix = locale.split(/[-_]/)[0].toLowerCase()
  return rtlLanguageCodes.has(prefix)
}
