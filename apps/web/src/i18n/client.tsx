import type { i18n as I18nInstance } from 'i18next'
import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import enUS, { allNamespaces } from '~/locales/default'

import { applyDocumentLocale, writeLocaleCookie } from './browser-locale'
import { I18nContext } from './i18n-context'
import { setI18nInstance } from './instance'
import type { SupportedLocale } from './locales'
import { DEFAULT_LOCALE, normalizeLocale } from './locales'
import { getI18nSettings } from './settings'

interface I18nRuntime {
  i18n: I18nInstance
  readyPromise: Promise<void>
}

function createI18nInstance(initialLocale: SupportedLocale): I18nRuntime {
  const instance = createInstance()

  const readyPromise = Promise.resolve(instance
    .use(initReactI18next)
    .use(
      resourcesToBackend(async (lng: string, ns: string) => {
        const normalizedLocale = normalizeLocale(lng)

        if (normalizedLocale === DEFAULT_LOCALE) {
          return enUS[ns as keyof typeof enUS] ?? {}
        }

        try {
          const mod = await import(`../locales/${normalizedLocale}/${ns}.json`)
          return mod.default ?? mod
        }
        catch {
          if (import.meta.env.DEV) {
            console.warn(`Missing i18n namespace: ${normalizedLocale}/${ns}`)
          }
          return enUS[ns as keyof typeof enUS] ?? {}
        }
      }),
    )
    .init({
      ...getI18nSettings(initialLocale, allNamespaces),
      partialBundledLanguages: true,
      returnEmptyString: false,
      returnNull: false,
      react: {
        useSuspense: false,
      },
    }))
    .then(() => undefined)

  return { i18n: instance, readyPromise }
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  initialLocale: SupportedLocale
}) {
  const runtime = createI18nInstance(initialLocale)
  const { i18n, readyPromise } = runtime
  setI18nInstance(i18n)
  const [isReady, setIsReady] = useState(() => i18n.isInitialized)

  useEffect(() => {
    if (i18n.isInitialized) {
      setIsReady(true)
      return
    }

    let cancelled = false
    void readyPromise.then(() => {
      if (!cancelled) {
        setIsReady(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [i18n, readyPromise])

  const value = {
      i18n,
      async switchLang(locale: string) {
        const normalizedLocale = normalizeLocale(locale)
        await i18n.changeLanguage(normalizedLocale)
        writeLocaleCookie(normalizedLocale)
        applyDocumentLocale(normalizedLocale)
      },
    }

  if (!isReady) {
    return null
  }

  return (
    <I18nContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </I18nContext.Provider>
  )
}
