import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'

import { allNamespaces } from '../../src/locales/default'
import { protectedKeyPatterns } from './protected-patterns'
import { defaultNamespaceEntries, resolveFromWebRoot, writeJson } from './utils'

interface UnusedReport {
  generatedAt: string
  unusedKeys: Array<{
    namespace: string
    key: string
  }>
}

const sourceFiles = await fg(['src/**/*.{ts,tsx}'], {
  cwd: process.cwd(),
  ignore: ['src/locales/**', 'src/api-gen/**'],
})

const sourceText = (await Promise.all(sourceFiles.map(file => fs.readFile(path.resolve(process.cwd(), file), 'utf8')))).join('\n')
const unusedKeys: UnusedReport['unusedKeys'] = []

for (const namespace of allNamespaces) {
  for (const key of Object.keys(defaultNamespaceEntries(namespace))) {
    const protectedByPattern = protectedKeyPatterns.some(pattern => pattern.test(`${namespace}:${key}`) || pattern.test(key))
    if (protectedByPattern) {
      continue
    }

    if (!sourceText.includes(key) && !sourceText.includes(`${namespace}:${key}`)) {
      unusedKeys.push({ namespace, key })
    }
  }
}

await writeJson(resolveFromWebRoot('i18n-unused-keys-report.json'), {
  generatedAt: new Date().toISOString(),
  unusedKeys,
} satisfies UnusedReport)
