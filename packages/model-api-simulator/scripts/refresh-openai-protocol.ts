import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import scopeJson from '../protocol/core-scope.json'
import type { Json } from './protocol-utils'
import { asRecord, filterDiscriminatedBranches, serialize, sha256, writeJson } from './protocol-utils'

const ROOT = resolve(import.meta.dirname, '..')
const selectedPaths = new Set([
  '/responses',
  '/responses?beta=true',
  '/responses/{response_id}',
  '/responses/{response_id}/cancel',
  '/responses/{response_id}/input_items',
  '/responses/input_tokens',
  '/responses/compact',
  '/models',
  '/models/{model}',
])
const excludedMarkers = [
  'mcp',
  'web_search',
  'file_search',
  'annotation',
  'citation',
  'image',
  'audio',
  'computer',
  'bash',
  'shell',
  'text_editor',
  'memory',
  'tool_search',
  'web_fetch',
  'code_interpreter',
  'code_execution',
  'server_tool',
  'custom_tool',
]

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
  const retainedPaths = Object.fromEntries(
    Object.entries(paths).filter(([path]) => selectedPaths.has(path)),
  )
  const reachableComponents = collectReachableComponents(document, retainedPaths)
  const allowed = new Set([
    ...scopeJson.openai.events,
    ...scopeJson.openai.outputTypes,
  ])
  const filtered = filterDiscriminatedBranches(
    {
      openapi: document.openapi,
      info: document.info,
      paths: retainedPaths,
      components: reachableComponents,
    },
    allowed,
    excludedMarkers,
  )
  if (!filtered) { throw new Error('Core OpenAI snapshot was filtered to nothing') }
  const filteredRecord = asRecord(filtered)
  const normalized: Json = {
    ...filteredRecord,
    components: collectReachableComponents(
      filteredRecord,
      asRecord(filteredRecord.paths),
    ),
  }
  const normalizedText = serialize(normalized)
  const coreScopeText = await readFile(resolve(ROOT, 'protocol/core-scope.json'))
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
    generatedAt: new Date().toISOString(),
    refreshCommand: `pnpm protocol:refresh:openai --ref ${ref}`,
  })
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
