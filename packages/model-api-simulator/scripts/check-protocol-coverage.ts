import type { JsonValue } from '../src/contract'
import type { ProtocolSchemaId } from '../src/core/json-schema-registry'
import {
  JsonSchemaRegistry,
} from '../src/core/json-schema-registry'
import corpus from '../src/generated/corpus-manifest.json'
import coverage from '../src/generated/protocol-coverage.json'

const uncovered = [...coverage.schemaBranches.uncovered, ...coverage.transitions.uncovered]
if (uncovered.length > 0) {
  throw new Error(`Uncovered core protocol IDs:\n${uncovered.join('\n')}`)
}

const registry = new JsonSchemaRegistry()
for (const witness of corpus.witnesses) {
  if (!registry.accepts(witness.schemaId as ProtocolSchemaId, witness.value as JsonValue)) { throw new Error(`Checked-in positive witness failed schema validation: ${witness.id}`) }
}
for (const witness of corpus.invalidWitnesses) {
  if (registry.accepts(witness.schemaId as ProtocolSchemaId, witness.value as JsonValue)) { throw new Error(`Checked-in negative witness unexpectedly passed schema validation: ${witness.id}`) }
}

console.log(
  `Core protocol coverage: ${coverage.schemaBranches.covered.length} schema branches, ${coverage.transitions.covered.length} transitions, ${corpus.witnesses.length} valid witnesses, ${corpus.invalidWitnesses.length} rejected mutations`,
)
