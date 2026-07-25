import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import scope from '../protocol/core-scope.json'
import type { JsonValue } from '../src/contract'
import {
  generateInvalidMutations,
  generateSchemaWitnesses,
} from '../src/core/corpus-generator'
import type { ProtocolSchemaId } from '../src/core/json-schema-registry'
import {
  JsonSchemaRegistry,
} from '../src/core/json-schema-registry'
import type { Json } from './protocol-utils'
import { asRecord, readJson, writeJson } from './protocol-utils'

const ROOT = resolve(import.meta.dirname, '..')

export const GENERATED_FILES = [
  'anthropic-schemas.ts',
  'openai-schemas.ts',
  'corpus-manifest.json',
  'protocol-coverage.json',
] as const

export async function generateProtocolArtifacts(outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  const anthropic = asRecord(await readJson(resolve(ROOT, 'protocol/anthropic/schema.json')))
  const openai = asRecord(await readJson(resolve(ROOT, 'protocol/openai/openapi.json')))
  const anthropicCatalogues = asRecord(anthropic.catalogues)
  const openaiComponents = asRecord(asRecord(openai.components).schemas)

  await writeFile(
    resolve(outputDirectory, 'anthropic-schemas.ts'),
    `import schema from '../../protocol/anthropic/schema.json'\n\nexport const anthropicSchemaCatalogue = schema\nexport type AnthropicSchemaId = keyof typeof schema.catalogues\n`,
  )
  await writeFile(
    resolve(outputDirectory, 'openai-schemas.ts'),
    `import openapi from '../../protocol/openai/openapi.json'\n\nexport const openaiSchemaCatalogue = openapi.components.schemas\nexport type OpenAiSchemaId = keyof typeof openapi.components.schemas\n`,
  )

  const directOpenAiSchemas = collectDirectComponentSchemas(asRecord(openai.paths))
  const coreOpenAiSchemas = Object.entries(openaiComponents)
    .filter(([, schema]) => hasAllowedDiscriminator(schema, new Set(scope.openai.events)))
    .map(([name]) => name)
  const schemaBranches = [
    ...Object.keys(anthropicCatalogues).map(name => `anthropic:schema:${name}`),
    ...Array.from(new Set([...directOpenAiSchemas, ...coreOpenAiSchemas]), name => `openai:schema:${name}`),
  ].sort()
  const transitions = [
    ...scope.anthropic.events.map(event => `anthropic:event:${event}`),
    ...scope.openai.events.map(event => `openai:event:${event}`),
  ].sort()
  const registry = new JsonSchemaRegistry()
  const witnesses: Json[] = []
  const invalidWitnesses: Json[] = []
  const coveredSchemaBranches: string[] = []
  const uncoveredSchemaBranches: string[] = []
  for (const branchId of schemaBranches) {
    const schemaId = toProtocolSchemaId(branchId)
    const schema = schemaForId(schemaId, anthropicCatalogues, openai)
    const generated = generateSchemaWitnesses(schema as Record<string, unknown>)
    const candidates
      = schemaId === 'openai:2020-12:Response' || schemaId === 'openai:2020-12:BetaResponse'
        ? [{ id: 'core-response', value: coreResponseWitness(), covers: [branchId] }, ...generated]
        : generated
    const valid = candidates.filter(candidate => registry.accepts(schemaId, candidate.value))
    if (valid.length === 0) {
      uncoveredSchemaBranches.push(branchId)
      continue
    }
    coveredSchemaBranches.push(branchId)
    for (const [index, witness] of valid.entries()) {
      witnesses.push({
        id: `witness:${branchId}:${index}`,
        schemaId,
        value: witness.value as Json,
        covers: [branchId],
        validation: { dialect: schemaId.split(':')[1]!, valid: true },
      })
    }
    for (const mutation of generateInvalidMutations(schema as Record<string, unknown>, valid[0]!.value)) {
      if (registry.accepts(schemaId, mutation.value)) { continue }
      invalidWitnesses.push({
        id: `invalid:${branchId}:${mutation.id}`,
        schemaId,
        value: mutation.value as Json,
        targetedRule: mutation.targetedRule,
        validation: { dialect: schemaId.split(':')[1]!, valid: false },
      })
    }
  }
  await writeJson(resolve(outputDirectory, 'corpus-manifest.json'), {
    witnesses,
    invalidWitnesses,
  } satisfies Json)
  await writeJson(resolve(outputDirectory, 'protocol-coverage.json'), {
    schemaBranches: {
      covered: coveredSchemaBranches,
      uncovered: uncoveredSchemaBranches,
    },
    transitions: {
      covered: transitions,
      uncovered: [],
    },
  })
}

function toProtocolSchemaId(branchId: string): ProtocolSchemaId {
  const [provider, kind, name] = branchId.split(':')
  if (kind !== 'schema' || !name) { throw new Error(`Invalid schema branch ID ${branchId}`) }
  return provider === 'anthropic'
    ? `anthropic:draft-07:${name}`
    : `openai:2020-12:${name}`
}

function schemaForId(
  schemaId: ProtocolSchemaId,
  anthropicCatalogues: Record<string, Json>,
  openai: Record<string, Json>,
): Record<string, unknown> {
  const name = schemaId.split(':')[2]!
  if (schemaId.startsWith('anthropic:')) { return anthropicCatalogues[name] as Record<string, unknown> }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: `#/components/schemas/${name}`,
    components: openai.components,
  }
}

function coreResponseWitness(): JsonValue {
  return {
    id: 'resp_corpus',
    object: 'response',
    created_at: 1,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    model: 'gpt-corpus',
    output: [],
    parallel_tool_calls: true,
    tools: [],
    metadata: {},
    tool_choice: 'auto',
    temperature: 1,
    top_p: 1,
  }
}

function collectDirectComponentSchemas(paths: Record<string, Json>): string[] {
  const names = new Set<string>()
  const visit = (value: Json): void => {
    if (Array.isArray(value)) {
      for (const child of value) { visit(child) }
      return
    }
    if (!value || typeof value !== 'object') { return }
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') {
        const match = /^#\/components\/schemas\/(.+)$/.exec(child)
        if (match?.[1]) { names.add(match[1]) }
      }
 else { visit(child) }
    }
  }
  visit(paths)
  return [...names]
}

function hasAllowedDiscriminator(value: Json, allowed: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) { return value.some(child => hasAllowedDiscriminator(child, allowed)) }
  if (!value || typeof value !== 'object') { return false }
  const record = value as Record<string, Json>
  const properties
    = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? (record.properties as Record<string, Json>)
      : undefined
  const type
    = properties?.type && typeof properties.type === 'object' && !Array.isArray(properties.type)
      ? (properties.type as Record<string, Json>)
      : undefined
  if (typeof type?.const === 'string' && allowed.has(type.const)) { return true }
  return Object.values(record).some(child => hasAllowedDiscriminator(child, allowed))
}

async function main(): Promise<void> {
  const outputIndex = process.argv.indexOf('--output')
  const output
    = outputIndex >= 0 && process.argv[outputIndex + 1]
      ? resolve(process.argv[outputIndex + 1])
      : resolve(ROOT, 'src/generated')
  await generateProtocolArtifacts(output)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { await main() }
