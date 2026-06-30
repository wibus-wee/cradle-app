import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, isRtl, normalizeLocale, resolveAcceptLanguage, resolveBrowserLanguage } from './locales'

describe('locale resources', () => {
  it('normalizes supported aliases and unsupported input', () => {
    expect(normalizeLocale()).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('en')).toBe('en-US')
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN')
    expect(normalizeLocale('ja_JP')).toBe('ja-JP')
    expect(normalizeLocale('fr-CA')).toBe(DEFAULT_LOCALE)
  })

  it('resolves Accept-Language by quality and supported candidates', () => {
    expect(resolveAcceptLanguage('fr-CA,zh-CN;q=0.9,en-US;q=0.8')).toBe('zh-CN')
    expect(resolveAcceptLanguage('es-ES,zh-CN;q=0.9')).toBe('es-ES')
    expect(resolveAcceptLanguage('fr-CA,de-DE;q=0.8')).toBe(DEFAULT_LOCALE)
  })

  it('resolves browser language lists with the same matching semantics', () => {
    expect(resolveBrowserLanguage(['fr-CA', 'ja-JP'])).toBe('ja-JP')
    expect(resolveBrowserLanguage([])).toBe(DEFAULT_LOCALE)
  })

  it('detects RTL language families', () => {
    expect(isRtl('ar')).toBe(true)
    expect(isRtl('he-IL')).toBe(true)
    expect(isRtl('en-US')).toBe(false)
  })
})
