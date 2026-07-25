import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import scopeJson from '../protocol/core-scope.json'
import type { Json } from './protocol-utils'
import {
  applyExactBranchSelections,
  applyExactEnumSelections,
  asRecord,
  assertOnlyAllowlistedDiscriminatedBranches,
  removeSourceMetadata,
  retainAllowlistedDiscriminatedBranches,
  serialize,
  sha256,
  writeJson,
} from './protocol-utils'

const ROOT = resolve(import.meta.dirname, '..')
function parseRef(): string {
  const index = process.argv.indexOf('--ref')
  const ref = index >= 0 ? process.argv[index + 1] : undefined
  if (!ref) { throw new Error('Usage: protocol:refresh:openai --ref <git-ref>') }
  return ref
}

async function main(): Promise<void> {
  const ref = parseRef()
  const sourceUrl = `https://raw.githubusercontent.com/openai/openai-openapi/${ref}/openapi.json`
  const response = await fetch(sourceUrl)
  if (!response.ok) { throw new Error(`OpenAI OpenAPI download failed: ${response.status}`) }
  const source = await response.text()
  const document = asRecord(JSON.parse(source) as Json)
  if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.1.')) { throw new Error(`Expected OpenAPI 3.1, received ${String(document.openapi)}`) }

  const paths = asRecord(document.paths)
  const retainedPaths = selectOperations(paths, new Set(scopeJson.openai.operations))
  const reachableComponents = collectReachableComponents(document, retainedPaths)
  const allowed = new Set([
    ...scopeJson.openai.events,
    ...scopeJson.openai.outputTypes,
    ...scopeJson.openai.requestTypes,
    ...scopeJson.openai.supportTypes,
  ])
  const preliminary: Json = {
    openapi: document.openapi,
    info: document.info,
    paths: retainedPaths,
    components: reachableComponents,
  }
  const filtered = retainAllowlistedDiscriminatedBranches(preliminary, preliminary, allowed)
  applyExactBranchSelections(filtered, scopeJson.openai.branchSelections)
  applyExactEnumSelections(filtered, scopeJson.openai.enumSelections)
  const filteredRecord = asRecord(filtered)
  const normalized: Json = removeSourceMetadata({
    ...filteredRecord,
    components: collectReachableComponents(
      filteredRecord,
      asRecord(filteredRecord.paths),
    ),
  })
  assertOnlyAllowlistedDiscriminatedBranches(normalized, normalized, allowed)
  const normalizedText = serialize(normalized)
  const coreScopeText = await readFile(resolve(ROOT, 'protocol/core-scope.json'))
  const grammarText = await readFile(resolve(ROOT, 'protocol/openai/stream-grammar.json'))
  const transitionCorpusText = await readFile(
    resolve(ROOT, 'protocol/openai/transition-corpus.json'),
  )
  await writeJson(resolve(ROOT, 'protocol/openai/openapi.json'), normalized)
  await writeJson(resolve(ROOT, 'protocol/openai/MANIFEST.json'), {
    owner: '@cradle/model-api-simulator',
    provider: 'openai',
    upstreamRef: ref,
    sourceUrl,
    openapiVersion: document.openapi,
    sourceSha256: sha256(source),
    normalizedSha256: sha256(normalizedText),
    coreScopeSha256: sha256(coreScopeText),
    grammarSha256: sha256(grammarText),
    transitionCorpusSha256: sha256(transitionCorpusText),
    generatedAt: new Date().toISOString(),
    refreshCommand: `pnpm protocol:refresh:openai --ref ${ref}`,
  })
}

function selectOperations(
  paths: Record<string, Json>,
  allowedOperationIds: ReadonlySet<string>,
): Record<string, Json> {
  const selected = new Map<string, { path: string, method: string, operation: Json }>()
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = asRecord(rawPathItem)
    for (const method of ['get', 'post', 'delete']) {
      const rawOperation = pathItem[method]
      if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) {
        continue
      }
      const operationId = asRecord(rawOperation).operationId
      if (typeof operationId === 'string' && allowedOperationIds.has(operationId)) {
        if (selected.has(operationId)) {
          throw new Error(`Duplicate OpenAPI operationId "${operationId}"`)
        }
        selected.set(operationId, { path, method, operation: rawOperation })
      }
    }
  }
  const missing = [...allowedOperationIds].filter(id => !selected.has(id))
  if (missing.length > 0) {
    throw new Error(`Core operation IDs missing from OpenAPI: ${missing.join(', ')}`)
  }
  const retained: Record<string, Json> = {}
  for (const [, selection] of [...selected].sort(([left], [right]) => left.localeCompare(right))) {
    const pathItem = asRecord(paths[selection.path]!)
    const target = (retained[selection.path] ??= {}) as Record<string, Json>
    if (pathItem.parameters) { target.parameters = pathItem.parameters }
    target[selection.method] = selection.operation
  }
  return retained
}

function collectReachableComponents(
  document: Record<string, Json>,
  retainedPaths: Record<string, Json>,
): Record<string, Json> {
  const references = new Set<string>()
  collectReferences(retainedPaths, references)
  const queue = [...references]
  for (let index = 0; index < queue.length; index += 1) {
    const reference = queue[index]
    if (!reference) { continue }
    const target = resolvePointer(document, reference)
    const before = references.size
    collectReferences(target, references)
    if (references.size > before) { for (const candidate of references) { if (!queue.includes(candidate)) { queue.push(candidate) } } }
  }

  const components = asRecord(document.components)
  const retained: Record<string, Json> = {}
  for (const reference of references) {
    const match = /^#\/components\/([^/]+)\/(.+)$/.exec(reference)
    if (!match?.[1] || !match[2]) { continue }
    const category = match[1]
    const name = match[2].replaceAll('~1', '/').replaceAll('~0', '~')
    const categoryRecord = asRecord(components[category])
    const value = categoryRecord[name]
    if (value === undefined) { throw new Error(`Unresolved OpenAPI component ${reference}`) }
    const target = (retained[category] ??= {}) as Record<string, Json>
    target[name] = value
  }
  return retained
}

function collectReferences(value: Json, references: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) { collectReferences(child, references) }
    return
  }
  if (!value || typeof value !== 'object') { return }
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string' && child.startsWith('#/components/')) { references.add(child) }
    else { collectReferences(child, references) }
  }
}

function resolvePointer(document: Record<string, Json>, pointer: string): Json {
  let current: Json = document
  for (const rawPart of pointer.slice(2).split('/')) {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~')
    current = asRecord(current)[part] as Json
    if (current === undefined) { throw new Error(`Unresolved OpenAPI pointer ${pointer}`) }
  }
  return current
}

await main()
