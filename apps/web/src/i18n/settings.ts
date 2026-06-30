import type { InitOptions } from 'i18next'

import { DEFAULT_LOCALE } from './locales'

export function getI18nSettings(lng: string, ns: string | string[] = 'common'): InitOptions {
  return {
    lng,
    fallbackLng: DEFAULT_LOCALE,
    ns,
    defaultNS: 'common',
    keySeparator: false,
    interpolation: {
      escapeValue: false,
    },
  }
}
