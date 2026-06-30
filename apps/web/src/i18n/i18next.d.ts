import type { DefaultResources } from '~/locales/default'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: DefaultResources
    keySeparator: false
  }
}
