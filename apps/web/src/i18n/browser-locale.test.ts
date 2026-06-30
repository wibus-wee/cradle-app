import { afterEach, describe, expect, it } from 'vitest'

import { resolveInitialLocale } from './browser-locale'
import { LOCALE_COOKIE, LOCALE_QUERY_PARAM } from './locales'

function setNavigatorLanguages(languages: readonly string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: languages,
  })
}

function setUrl(query: string): void {
  window.history.replaceState(null, '', `/${query}`)
}

function setLocaleCookie(value: string): void {
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(value)};path=/`
}

afterEach(() => {
  document.cookie = `${LOCALE_COOKIE}=;path=/;max-age=0`
  document.documentElement.lang = ''
  document.documentElement.dir = ''
  setUrl('')
  setNavigatorLanguages(['en-US'])
})

describe('browser locale bootstrap', () => {
  it('lets query locale override a valid cookie', () => {
    setUrl(`?${LOCALE_QUERY_PARAM}=zh-CN`)
    setLocaleCookie('en-US')
    setNavigatorLanguages(['ja-JP'])

    expect(resolveInitialLocale()).toBe('zh-CN')
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=zh-CN`)
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('lets a valid cookie override browser language', () => {
    setLocaleCookie('es-ES')
    setNavigatorLanguages(['zh-CN'])

    expect(resolveInitialLocale()).toBe('es-ES')
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=es-ES`)
    expect(document.documentElement.lang).toBe('es-ES')
  })

  it('falls through unsupported cookie to browser language and rewrites the cookie', () => {
    setLocaleCookie('fr-FR')
    setNavigatorLanguages(['ja-JP'])

    expect(resolveInitialLocale()).toBe('ja-JP')
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=ja-JP`)
    expect(document.documentElement.lang).toBe('ja-JP')
  })

  it('falls through unsupported query to a supported locale before writing the cookie', () => {
    setUrl(`?${LOCALE_QUERY_PARAM}=fr-FR`)
    setLocaleCookie('zh-CN')
    setNavigatorLanguages(['ja-JP'])

    expect(resolveInitialLocale()).toBe('zh-CN')
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=zh-CN`)
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
