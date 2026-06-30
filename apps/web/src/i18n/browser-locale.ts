import type { SupportedLocale } from './locales'
import {
  DEFAULT_LOCALE,
  isRtl,
  LOCALE_COOKIE,
  LOCALE_QUERY_PARAM,
  matchSupportedLocale,
  resolveBrowserLanguage,
} from './locales'

const COOKIE_MAX_AGE_SECONDS = 365 * 86400

function readCookie(name: string): string | null {
  const match = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))

  if (!match) {
    return null
  }

  return decodeURIComponent(match.slice(name.length + 1))
}

export function writeLocaleCookie(locale: SupportedLocale): void {
  const secure = window.location.protocol === 'https:' ? ';secure' : ''
  document.cookie = [
    `${LOCALE_COOKIE}=${encodeURIComponent(locale)}`,
    'path=/',
    `max-age=${COOKIE_MAX_AGE_SECONDS}`,
    'samesite=lax',
  ].join(';') + secure
}

export function applyDocumentLocale(locale: SupportedLocale): void {
  document.documentElement.lang = locale
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr'
}

export function resolveInitialLocale(): SupportedLocale {
  const url = new URL(window.location.href)
  const queryLocale = url.searchParams.get(LOCALE_QUERY_PARAM)
  const cookieLocale = readCookie(LOCALE_COOKIE)
  const queryMatch = matchSupportedLocale(queryLocale)
  const cookieMatch = matchSupportedLocale(cookieLocale)
  const browserLocale = resolveBrowserLanguage(navigator.languages ?? [navigator.language].filter(Boolean))

  const resolvedLocale = queryMatch ?? cookieMatch ?? browserLocale ?? DEFAULT_LOCALE

  if (queryLocale || !cookieMatch) {
    writeLocaleCookie(resolvedLocale)
  }

  applyDocumentLocale(resolvedLocale)
  return resolvedLocale
}
