import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import anthropicGrammar from '../protocol/anthropic/stream-grammar.json'
import anthropicTransitions from '../protocol/anthropic/transition-corpus.json'
import scope from '../protocol/core-scope.json'
import openAiGrammar from '../protocol/openai/stream-grammar.json'
import openAiTransitions from '../protocol/openai/transition-corpus.json'
import { validateAnthropicStream } from '../src/anthropic/state-machine'
import type { StreamStep } from '../src/contract'
import {
  enumerateSchemaObligations,
  generateInvalidMutations,
  generateSchemaWitnesses,
} from '../src/core/corpus-generator'
import type { ProtocolSchemaId } from '../src/core/json-schema-registry'
import {
  JsonSchemaRegistry,
} from '../src/core/json-schema-registry'
import { validateOpenAiStream } from '../src/openai/state-machine'
import { refreshProtocolArtifactCache } from './protocol-artifact-cache'
import type { Json } from './protocol-utils'
import { asRecord, readJson, writeJson } from './protocol-utils'

const ROOT = resolve(import.meta.dirname, '..')

export async function generateProtocolArtifacts(outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  const anthropic = asRecord(await readJson(resolve(ROOT, 'protocol/anthropic/schema.json')))
  const openai = asRecord(await readJson(resolve(ROOT, 'protocol/openai/openapi.json')))
  const anthropicCatalogues = asRecord(anthropic.catalogues)

  await writeFile(
    resolve(outputDirectory, 'anthropic-schemas.ts'),
    `import schema from '../../protocol/anthropic/schema.json'\n\nexport const anthropicSchemaCatalogue = schema\nexport type AnthropicSchemaId = keyof typeof schema.catalogues\n`,
  )
  await writeFile(
    resolve(outputDirectory, 'openai-schemas.ts'),
    `import openapi from '../../protocol/openai/openapi.json'\n\nexport const openaiSchemaCatalogue = openapi.components.schemas\nexport type OpenAiSchemaId = keyof typeof openapi.components.schemas\n`,
  )

  const schemaBranches = [
    ...scope.anthropic.schemaRoots.map(name => `anthropic:schema:${name}`),
    ...scope.openai.schemaRoots.map(name => `openai:schema:${name}`),
  ].sort()
  const transitionObligations = [
    ...anthropicGrammar.transitions.map(item => `anthropic:transition:${item.id}`),
    ...anthropicGrammar.correlations.map(item => `anthropic:correlation:${item.id}`),
    ...openAiGrammar.transitions.map(item => `openai:transition:${item.id}`),
    ...openAiGrammar.correlations.map(item => `openai:correlation:${item.id}`),
  ].sort()
  const coveredTransitions = new Set<string>()
  for (const scenario of anthropicTransitions.scenarios) {
    const trace = validateAnthropicStream(scenario.steps as readonly StreamStep[])
    trace.transitions.forEach(id => coveredTransitions.add(id))
    trace.correlations.forEach(id =>
      coveredTransitions.add(`anthropic:correlation:${id}`))
  }
  for (const scenario of openAiTransitions.scenarios) {
    const trace = validateOpenAiStream(scenario.steps as readonly StreamStep[])
    trace.transitions.forEach(id => coveredTransitions.add(id))
    trace.correlations.forEach(id =>
      coveredTransitions.add(`openai:correlation:${id}`))
  }
  const registry = new JsonSchemaRegistry()
  const witnesses: Json[] = []
  const invalidWitnesses = new Map<string, Json>()
  const schemaObligations: string[] = []
  const coveredSchemaObligations = new Set<string>()
  for (const branchId of schemaBranches) {
    const schemaId = toProtocolSchemaId(branchId)
    const schema = schemaForId(schemaId, anthropicCatalogues, openai)
    const obligations = enumerateSchemaObligations(schema as Record<string, unknown>)
      .map(obligation => `${branchId}:${obligation}`)
    schemaObligations.push(...obligations)
    const generated = generateSchemaWitnesses(schema as Record<string, unknown>)
    const valid = generated.filter(candidate => registry.accepts(schemaId, candidate.value))
    for (const [index, witness] of valid.entries()) {
      const covers = witness.covers.map(obligation => `${branchId}:${obligation}`)
      covers.forEach(obligation => coveredSchemaObligations.add(obligation))
      witnesses.push({
        id: `witness:${branchId}:${index}`,
        schemaId,
        value: witness.value as Json,
        covers,
        validation: { dialect: schemaId.split(':')[1]!, valid: true },
      })
      for (const mutation of generateInvalidMutations(
        schema as Record<string, unknown>,
        witness.value,
      )) {
        if (registry.accepts(schemaId, mutation.value)) { continue }
        const key = `${schemaId}:${mutation.targetedRule}`
        if (invalidWitnesses.has(key)) { continue }
        invalidWitnesses.set(key, {
          id: `invalid:${branchId}:${index}:${mutation.id}`,
          schemaId,
          value: mutation.value as Json,
          targetedRule: mutation.targetedRule,
          validation: { dialect: schemaId.split(':')[1]!, valid: false },
        })
      }
    }
  }
  await writeJson(resolve(outputDirectory, 'corpus-manifest.json'), {
    witnesses,
    invalidWitnesses: [...invalidWitnesses.values()],
  } satisfies Json)
  await writeJson(resolve(outputDirectory, 'protocol-coverage.json'), {
    schemaBranches: {
      covered: [...coveredSchemaObligations].sort(),
      uncovered: schemaObligations
        .filter(obligation => !coveredSchemaObligations.has(obligation))
        .sort(),
    },
    transitions: {
      covered: [...coveredTransitions].sort(),
      uncovered: transitionObligations
        .filter(obligation => !coveredTransitions.has(obligation))
        .sort(),
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

async function main(): Promise<void> {
  const outputIndex = process.argv.indexOf('--output')
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    await generateProtocolArtifacts(resolve(process.argv[outputIndex + 1]))
    return
  }
  const result = await refreshProtocolArtifactCache(generateProtocolArtifacts)
  console.log(`Generated protocol artifacts in ${result.directory}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { await main() }
