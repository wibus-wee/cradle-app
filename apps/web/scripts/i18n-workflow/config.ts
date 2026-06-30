export interface I18nWorkflowConfig {
  defaultLocale: string
  localesDir: string
  reportsDir: string
  sourceLocaleDir: string
  sourceLocaleIndex: string
}

export const i18nWorkflowConfig: I18nWorkflowConfig = {
  defaultLocale: 'en-US',
  localesDir: 'src/locales',
  reportsDir: '.',
  sourceLocaleDir: 'src/locales/default',
  sourceLocaleIndex: 'src/locales/default/index.ts',
}
