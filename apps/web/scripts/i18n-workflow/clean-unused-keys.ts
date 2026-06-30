import type { SupportedLocale } from '../../src/i18n/locales'
import { isSupportedLocale } from '../../src/i18n/locales'
import { localeNamespacePath, nonDefaultLocales, pathExists, readJson, resolveFromWebRoot, writeJson } from './utils'

interface UnusedReport {
  unusedKeys: Array<{
    namespace: string
    key: string
  }>
}

const dryRun = !process.argv.includes('--no-dry-run')
const reportPath = resolveFromWebRoot('i18n-unused-keys-report.json')

if (!(await pathExists(reportPath))) {
  console.error('Run i18n:analyze-unused before cleaning unused keys.')
  process.exit(1)
}

const report = await readJson(reportPath) as unknown as UnusedReport

for (const locale of nonDefaultLocales()) {
  if (!isSupportedLocale(locale)) {
    continue
  }

  for (const { namespace, key } of report.unusedKeys) {
    const filePath = resolveFromWebRoot(localeNamespacePath(locale as SupportedLocale, namespace as never))
    if (!(await pathExists(filePath))) {
      continue
    }

    const translations = await readJson(filePath)
    if (!(key in translations)) {
      continue
    }

    if (dryRun) {
      console.log(`[dry-run] ${locale}/${namespace}: remove ${key}`)
    }
    else {
      delete translations[key]
      await writeJson(filePath, translations)
    }
  }
}
