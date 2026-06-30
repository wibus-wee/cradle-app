import { DEFAULT_LOCALE } from '../../src/i18n/locales'
import { allNamespaces } from '../../src/locales/default'
import { defaultNamespaceEntries, localeNamespacePath, readJson, resolveFromWebRoot, sortedRecord, writeJson } from './utils'

const checkOnly = process.argv.includes('--check')
const mismatches = new Map<string, string>()

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
    null,
    2,
  )
}

for (const namespace of allNamespaces) {
  const filePath = resolveFromWebRoot(localeNamespacePath(DEFAULT_LOCALE, namespace))
  const expected = sortedRecord(defaultNamespaceEntries(namespace))

  if (checkOnly) {
    try {
      const actual = await readJson(filePath)
      if (stableJson(actual) !== stableJson(expected)) {
        mismatches.set(namespace, `content differs from ${filePath}`)
      }
    }
    catch (error) {
      mismatches.set(namespace, error instanceof Error ? error.message : String(error))
    }

    continue
  }

  await writeJson(filePath, expected)
}

if (mismatches.size > 0) {
  console.error('Default locale baseline is out of sync with src/locales/default:')
  for (const [namespace, reason] of mismatches) {
    console.error(`- ${namespace}: ${reason}`)
  }
  console.error('Run `pnpm --filter @cradle/web i18n:gen-default` to update src/locales/en-US.')
  process.exitCode = 1
}
