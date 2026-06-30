import type { i18n as I18nInstance } from 'i18next'
import { createContext, useContext } from 'react'

export interface I18nContextValue {
  i18n: I18nInstance
  switchLang: (locale: string) => Promise<void>
}

export const I18nContext = createContext<I18nContextValue | null>(null)

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return value
}
