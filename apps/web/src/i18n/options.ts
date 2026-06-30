import type { SupportedLocale } from './resources'

export interface LocaleOption {
  value: SupportedLocale
}

export const localeOptions: LocaleOption[] = [
  { value: 'en-US' },
  { value: 'zh-CN' },
  { value: 'ja-JP' },
  { value: 'es-ES' },
]
