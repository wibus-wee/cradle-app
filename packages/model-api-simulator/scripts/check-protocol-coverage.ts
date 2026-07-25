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
import { readJson } from './protocol-utils'

interface CorpusManifest {
  readonly witnesses: readonly {
    readonly id: string
    readonly schemaId: string
    readonly value: JsonValue
  }[]
  readonly invalidWitnesses: readonly {
    readonly id: string
    readonly schemaId: string
    readonly value: JsonValue
  }[]
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
const corpus = await readJson(
  resolve(cache.directory, 'corpus-manifest.json'),
) as unknown as CorpusManifest
const coverage = await readJson(
  resolve(cache.directory, 'protocol-coverage.json'),
) as unknown as CoverageManifest

const uncovered = [...coverage.schemaBranches.uncovered, ...coverage.transitions.uncovered]
if (uncovered.length > 0) {
  throw new Error(`Uncovered core protocol IDs:\n${uncovered.join('\n')}`)
}

const registry = new JsonSchemaRegistry()
for (const witness of corpus.witnesses) {
  if (!registry.accepts(witness.schemaId as ProtocolSchemaId, witness.value)) { throw new Error(`Generated positive witness failed schema validation: ${witness.id}`) }
}
for (const witness of corpus.invalidWitnesses) {
  if (registry.accepts(witness.schemaId as ProtocolSchemaId, witness.value)) { throw new Error(`Generated negative witness unexpectedly passed schema validation: ${witness.id}`) }
}

console.log(
  `Core protocol coverage: ${coverage.schemaBranches.covered.length} schema branches, ${coverage.transitions.covered.length} transitions, ${corpus.witnesses.length} valid witnesses, ${corpus.invalidWitnesses.length} rejected mutations`,
)
