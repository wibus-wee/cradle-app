import type { SupportedLocale } from '../../src/i18n/locales'
import { isSupportedLocale } from '../../src/i18n/locales'
import type { Namespace } from '../../src/locales/default'
import { isNamespace } from '../../src/locales/default'
import { localeNamespacePath, nonDefaultLocales, pathExists, readJson, resolveFromWebRoot, writeJson } from './utils'

interface UnusedReport {
  unusedKeys: Array<{
    namespace: Namespace
    key: string
  }>
}

function readUnusedReport(value: Record<string, unknown>): UnusedReport {
  if (!Array.isArray(value.unusedKeys)) {
    throw new TypeError('Unused-key report is missing unusedKeys')
  }
  return {
    unusedKeys: value.unusedKeys.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Invalid unusedKeys entry at index ${index}`)
      }
      const namespace = Reflect.get(entry, 'namespace')
      const key = Reflect.get(entry, 'key')
      if (typeof namespace !== 'string' || !isNamespace(namespace) || typeof key !== 'string') {
        throw new Error(`Invalid unusedKeys entry at index ${index}`)
      }
      return { namespace, key }
    }),
  }
}

const dryRun = !process.argv.includes('--no-dry-run')
const reportPath = resolveFromWebRoot('i18n-unused-keys-report.json')

if (!(await pathExists(reportPath))) {
  console.error('Run i18n:analyze-unused before cleaning unused keys.')
  process.exit(1)
}

const report = readUnusedReport(await readJson(reportPath))

for (const locale of nonDefaultLocales()) {
  if (!isSupportedLocale(locale)) {
    continue
  }

  for (const { namespace, key } of report.unusedKeys) {
    const filePath = resolveFromWebRoot(localeNamespacePath(locale as SupportedLocale, namespace))
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
