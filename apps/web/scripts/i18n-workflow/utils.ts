import fs from 'node:fs/promises'
import path from 'node:path'

import type { SupportedLocale } from '../../src/i18n/locales'
import { DEFAULT_LOCALE, locales } from '../../src/i18n/locales'
import type { Namespace } from '../../src/locales/default'
import defaultResources, { allNamespaces } from '../../src/locales/default'
import { i18nWorkflowConfig } from './config'

export type InvalidEntryReason = 'placeholder_mismatch' | 'tag_mismatch' | 'non_string_value' | 'plural_mismatch'

export interface InvalidEntry {
  key: string
  reason: InvalidEntryReason
  actualType?: string
  expectedPlaceholders?: string[]
  actualPlaceholders?: string[]
  expectedTags?: string[]
  actualTags?: string[]
  expectedPluralCategories?: string[]
  actualPluralCategories?: string[]
  baselineValue?: string
  currentValue?: unknown
}

export interface NamespaceReport {
  locale: SupportedLocale
  namespace: Namespace
  filePath: string
  missingKeys: string[]
  extraKeys: string[]
  invalidEntries: InvalidEntry[]
}

export interface I18nCheckReport {
  generatedAt: string
  summary: {
    locales: number
    namespaces: number
    missingKeys: number
    extraKeys: number
    invalidEntries: number
  }
  reports: NamespaceReport[]
}

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Z_$][\w$]*)\s*\}\}/gi
const TAG_PATTERN = /<\/?([A-Z][\w.-]*)(?:\s[^>]*)?>/gi
const SELF_CLOSING_TAG_PATTERN = /<([A-Z][\w.-]*)(?:\s[^>]*)?\/>/gi
const PLURAL_SUFFIX_PATTERN = /_(zero|one|two|few|many|other)$/
const IGNORED_TRANS_TAGS = new Set(['br'])

export function resolveFromWebRoot(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath)
}

export function localeNamespacePath(locale: SupportedLocale, namespace: Namespace): string {
  return path.join(i18nWorkflowConfig.localesDir, locale, `${namespace}.json`)
}

export function nonDefaultLocales(): SupportedLocale[] {
  return locales.filter(locale => locale !== DEFAULT_LOCALE)
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  }
  catch {
    return false
  }
}

export async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function defaultNamespaceEntries(namespace: Namespace): Record<string, string> {
  return defaultResources[namespace]
}

export function sortedRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))
}

function getMatches(value: string, pattern: RegExp): string[] {
  const matches = new Set<string>()
  pattern.lastIndex = 0

  for (const match of value.matchAll(pattern)) {
    if (match[1]) {
      matches.add(match[1])
    }
  }

  return [...matches].sort()
}

export function getPlaceholders(value: string): string[] {
  return getMatches(value, PLACEHOLDER_PATTERN)
}

export function getTransTags(value: string): string[] {
  const tags = new Set<string>()

  TAG_PATTERN.lastIndex = 0
  for (const match of value.matchAll(TAG_PATTERN)) {
    const tag = match[1]
    if (tag && !IGNORED_TRANS_TAGS.has(tag)) {
      tags.add(tag)
    }
  }

  SELF_CLOSING_TAG_PATTERN.lastIndex = 0
  for (const match of value.matchAll(SELF_CLOSING_TAG_PATTERN)) {
    const tag = match[1]
    if (tag && !IGNORED_TRANS_TAGS.has(tag)) {
      tags.add(tag)
    }
  }

  return [...tags].sort()
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function pluralFamily(key: string): string | null {
  const match = key.match(PLURAL_SUFFIX_PATTERN)
  return match ? key.slice(0, -match[0].length) : null
}

function pluralCategory(key: string): string | null {
  return key.match(PLURAL_SUFFIX_PATTERN)?.[1] ?? null
}

function requiredPluralCategories(locale: SupportedLocale): string[] {
  return [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories, 'other'].sort()
}

export function validateNamespace(
  locale: SupportedLocale,
  namespace: Namespace,
  baseline: Record<string, string>,
  current: Record<string, unknown>,
): NamespaceReport {
  const baselineKeys = Object.keys(baseline).sort()
  const currentKeys = Object.keys(current).sort()
  const baselineKeySet = new Set(baselineKeys)
  const currentKeySet = new Set(currentKeys)
  const invalidEntries: InvalidEntry[] = []
  const missingKeys = baselineKeys.filter(key => !currentKeySet.has(key))
  const extraKeys = currentKeys.filter(key => !baselineKeySet.has(key))

  for (const key of baselineKeys) {
    if (!currentKeySet.has(key)) {
      continue
    }

    const baselineValue = baseline[key]
    const currentValue = current[key]

    if (typeof currentValue !== 'string') {
      invalidEntries.push({
        key,
        reason: 'non_string_value',
        actualType: Array.isArray(currentValue) ? 'array' : typeof currentValue,
        baselineValue,
        currentValue,
      })
      continue
    }

    const expectedPlaceholders = getPlaceholders(baselineValue)
    const actualPlaceholders = getPlaceholders(currentValue)
    if (!arraysEqual(expectedPlaceholders, actualPlaceholders)) {
      invalidEntries.push({
        key,
        reason: 'placeholder_mismatch',
        expectedPlaceholders,
        actualPlaceholders,
        baselineValue,
        currentValue,
      })
    }

    const expectedTags = getTransTags(baselineValue)
    const actualTags = getTransTags(currentValue)
    if (!arraysEqual(expectedTags, actualTags)) {
      invalidEntries.push({
        key,
        reason: 'tag_mismatch',
        expectedTags,
        actualTags,
        baselineValue,
        currentValue,
      })
    }
  }

  const baselinePluralFamilies = new Map<string, Set<string>>()
  const currentPluralFamilies = new Map<string, Set<string>>()

  for (const key of baselineKeys) {
    const family = pluralFamily(key)
    const category = pluralCategory(key)
    if (family && category) {
      const categories = baselinePluralFamilies.get(family) ?? new Set<string>()
      categories.add(category)
      baselinePluralFamilies.set(family, categories)
    }
  }

  for (const key of currentKeys) {
    const family = pluralFamily(key)
    const category = pluralCategory(key)
    if (family && category) {
      const categories = currentPluralFamilies.get(family) ?? new Set<string>()
      categories.add(category)
      currentPluralFamilies.set(family, categories)
    }
  }

  for (const [family, baselineCategories] of baselinePluralFamilies) {
    const expectedPluralCategories = [...new Set([...baselineCategories, ...requiredPluralCategories(locale)])].sort()
    const actualPluralCategories = [...(currentPluralFamilies.get(family) ?? new Set<string>())].sort()

    if (!arraysEqual(expectedPluralCategories, actualPluralCategories)) {
      invalidEntries.push({
        key: family,
        reason: 'plural_mismatch',
        expectedPluralCategories,
        actualPluralCategories,
      })
    }
  }

  return {
    locale,
    namespace,
    filePath: localeNamespacePath(locale, namespace),
    missingKeys,
    extraKeys,
    invalidEntries,
  }
}

export async function collectCheckReport(): Promise<I18nCheckReport> {
  const reports: NamespaceReport[] = []

  for (const locale of nonDefaultLocales()) {
    for (const namespace of allNamespaces) {
      const baseline = defaultNamespaceEntries(namespace)
      const filePath = resolveFromWebRoot(localeNamespacePath(locale, namespace))
      const current = (await pathExists(filePath)) ? await readJson(filePath) : {}
      reports.push(validateNamespace(locale, namespace, baseline, current))
    }
  }

  const summary = reports.reduce(
    (acc, report) => {
      acc.missingKeys += report.missingKeys.length
      acc.extraKeys += report.extraKeys.length
      acc.invalidEntries += report.invalidEntries.length
      return acc
    },
    {
      locales: nonDefaultLocales().length,
      namespaces: allNamespaces.length,
      missingKeys: 0,
      extraKeys: 0,
      invalidEntries: 0,
    },
  )

  return {
    generatedAt: new Date().toISOString(),
    summary,
    reports,
  }
}

export async function writeMissingReport(report: I18nCheckReport): Promise<void> {
  await writeJson(resolveFromWebRoot('i18n-missing-report.json'), report)
}
