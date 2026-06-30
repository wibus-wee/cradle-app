import type { SupportedLocale } from '../../src/i18n/locales'
import { isSupportedLocale } from '../../src/i18n/locales'
import { allNamespaces } from '../../src/locales/default'
import { localeNamespacePath, pathExists, resolveFromWebRoot, writeJson } from './utils'

const locale = process.argv[2] as SupportedLocale | undefined

if (!locale || !isSupportedLocale(locale)) {
  console.error(`Locale must be one of the supported locales. Received: ${locale ?? '(missing)'}`)
  process.exit(1)
}

for (const namespace of allNamespaces) {
  const filePath = resolveFromWebRoot(localeNamespacePath(locale, namespace))
  if (!(await pathExists(filePath))) {
    await writeJson(filePath, {})
  }
}
