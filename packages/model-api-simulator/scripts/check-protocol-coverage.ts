import { resolve } from 'node:path'

import type { JsonValue } from '../src/contract'
import type { ProtocolSchemaId } from '../src/core/json-schema-registry'
import {
  JsonSchemaRegistry,
} from '../src/core/json-schema-registry'
import { generateProtocolArtifacts } from './generate-protocol-artifacts'
import {
  ensureProtocolArtifactCache,
  readGeneratedArtifactManifest,
} from './protocol-artifact-cache'
import type { Json } from './protocol-utils'
import { asRecord, readJson } from './protocol-utils'

interface CorpusManifest {
  readonly witnesses: readonly {
    readonly id: string
    readonly schemaId: ProtocolSchemaId
    readonly value: JsonValue
  }[]
  readonly invalidWitnesses: readonly {
    readonly id: string
    readonly schemaId: ProtocolSchemaId
    readonly value: JsonValue
  }[]
}

function readString(value: Json | undefined, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${label} to be a string`)
  }
  return value
}

function readStringArray(value: Json | undefined, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Expected ${label} to be a string array`)
  }
  return value
}

function readProtocolSchemaId(value: Json | undefined, label: string): ProtocolSchemaId {
  const schemaId = readString(value, label)
  const anthropicPrefix = 'anthropic:draft-07:'
  if (schemaId.startsWith(anthropicPrefix) && schemaId.length > anthropicPrefix.length) {
    return `anthropic:draft-07:${schemaId.slice(anthropicPrefix.length)}`
  }
  const openAiPrefix = 'openai:2020-12:'
  if (schemaId.startsWith(openAiPrefix) && schemaId.length > openAiPrefix.length) {
    return `openai:2020-12:${schemaId.slice(openAiPrefix.length)}`
  }
  throw new Error(`Invalid protocol schema ID in ${label}: ${schemaId}`)
}

function readWitnesses(value: Json | undefined, label: string): CorpusManifest['witnesses'] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected ${label} to be an array`)
  }
  return value.map((entry, index) => {
    const record = asRecord(entry)
    if (record.value === undefined) {
      throw new Error(`Expected ${label}[${index}].value`)
    }
    return {
      id: readString(record.id, `${label}[${index}].id`),
      schemaId: readProtocolSchemaId(record.schemaId, `${label}[${index}].schemaId`),
      value: record.value,
    }
  })
}

function readCorpusManifest(value: Json): CorpusManifest {
  const record = asRecord(value)
  return {
    witnesses: readWitnesses(record.witnesses, 'witnesses'),
    invalidWitnesses: readWitnesses(record.invalidWitnesses, 'invalidWitnesses'),
  }
}

function readCoverageManifest(value: Json): CoverageManifest {
  const record = asRecord(value)
  const schemaBranches = asRecord(record.schemaBranches)
  const transitions = asRecord(record.transitions)
  return {
    schemaBranches: {
      covered: readStringArray(schemaBranches.covered, 'schemaBranches.covered'),
      uncovered: readStringArray(schemaBranches.uncovered, 'schemaBranches.uncovered'),
    },
    transitions: {
      covered: readStringArray(transitions.covered, 'transitions.covered'),
      uncovered: readStringArray(transitions.uncovered, 'transitions.uncovered'),
    },
  }
}

interface CoverageManifest {
  readonly schemaBranches: {
    readonly covered: readonly string[]
    readonly uncovered: readonly string[]
  }
  readonly transitions: {
    readonly covered: readonly string[]
    readonly uncovered: readonly string[]
  }
}

const manifest = await readGeneratedArtifactManifest()
const cache = await ensureProtocolArtifactCache(
  manifest.inputFingerprint,
  generateProtocolArtifacts,
)
const corpus = readCorpusManifest(await readJson(
  resolve(cache.directory, 'corpus-manifest.json'),
))
const coverage = readCoverageManifest(await readJson(
  resolve(cache.directory, 'protocol-coverage.json'),
))

const uncovered = [...coverage.schemaBranches.uncovered, ...coverage.transitions.uncovered]
if (uncovered.length > 0) {
  throw new Error(`Uncovered core protocol IDs:\n${uncovered.join('\n')}`)
}

const registry = new JsonSchemaRegistry()
for (const witness of corpus.witnesses) {
  if (!registry.accepts(witness.schemaId, witness.value)) { throw new Error(`Generated positive witness failed schema validation: ${witness.id}`) }
}
for (const witness of corpus.invalidWitnesses) {
  if (registry.accepts(witness.schemaId, witness.value)) { throw new Error(`Generated negative witness unexpectedly passed schema validation: ${witness.id}`) }
}

console.log(
  `Core protocol coverage: ${coverage.schemaBranches.covered.length} schema branches, ${coverage.transitions.covered.length} transitions, ${corpus.witnesses.length} valid witnesses, ${corpus.invalidWitnesses.length} rejected mutations`,
)
