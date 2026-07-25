import type { JsonValue } from '../contract'

export interface CorpusWitness {
  readonly id: string
  readonly value: JsonValue
  readonly covers: readonly string[]
}

export interface CorpusMutation {
  readonly id: string
  readonly value: JsonValue
  readonly targetedRule: string
}

type Schema = Record<string, unknown>

export function generateSchemaWitnesses(schema: Schema): readonly CorpusWitness[] {
  const values = witnessValues(schema, schema, new Set(), '#')
  return deduplicate(values).map((value, index) => ({
    id: `witness-${index}`,
    value,
    covers: [`branch-${index}`],
  }))
}

export function generateInvalidMutations(
  schema: Schema,
  witness: JsonValue,
): readonly CorpusMutation[] {
  if (!isRecord(witness)) { return [{ id: 'wrong-type', value: [], targetedRule: 'type' }] }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : []
  const mutations: CorpusMutation[] = required.flatMap((name) => {
    if (!(name in witness)) { return [] }
    const copy = { ...witness }
    delete copy[name]
    return [{ id: `omit-${name}`, value: copy, targetedRule: `required:${name}` }]
  })
  if (mutations.length === 0) { mutations.push({ id: 'wrong-type', value: [], targetedRule: 'type' }) }
  return mutations
}

function witnessValues(
  schema: Schema,
  root: Schema,
  visiting: Set<Schema>,
  path: string,
): JsonValue[] {
  if (typeof schema.$ref === 'string') {
    const target = resolveReference(root, schema.$ref)
    if (visiting.has(target)) { return [minimalRecursiveBase(target)] }
    const next = new Set(visiting)
    next.add(target)
    return witnessValues(target, root, next, schema.$ref)
  }
  if ('const' in schema) { return [schema.const as JsonValue] }
  if (Array.isArray(schema.enum)) { return schema.enum as JsonValue[] }
  if (Array.isArray(schema.oneOf)) {
 return schema.oneOf.flatMap((branch, index) =>
      witnessValues(asSchema(branch), root, visiting, `${path}/oneOf/${index}`))
}
  if (Array.isArray(schema.anyOf)) {
 return schema.anyOf.flatMap((branch, index) =>
      witnessValues(asSchema(branch), root, visiting, `${path}/anyOf/${index}`))
}
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map((branch, index) =>
      witnessValues(asSchema(branch), root, visiting, `${path}/allOf/${index}`)[0])
    if (parts.every(isRecord)) { return [Object.assign({}, ...parts)] }
    return [parts.find(value => value !== undefined) ?? null]
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.includes('null')) {
    const nonNull = types.find(type => type !== 'null')
    return nonNull ? [null, ...witnessValues({ ...schema, type: nonNull }, root, visiting, path)] : [null]
  }
  switch (types[0]) {
    case 'object':
    case undefined:
      return objectWitnesses(schema, root, visiting, path)
    case 'array': {
      const itemSchema = asSchema(schema.items ?? {})
      const item = witnessValues(itemSchema, root, visiting, `${path}/items`)[0] ?? null
      const minimum = typeof schema.minItems === 'number' ? schema.minItems : 0
      const maximum = typeof schema.maxItems === 'number' ? schema.maxItems : Number.POSITIVE_INFINITY
      const lengths = [...new Set([minimum, Math.max(minimum, 1), Math.max(minimum, 2)])].filter(
        length => length <= maximum,
      )
      return lengths.map(length => Array.from<JsonValue>({ length }).fill(item))
    }
    case 'string': {
      const minimum = typeof schema.minLength === 'number' ? schema.minLength : 0
      const maximum = typeof schema.maxLength === 'number' ? schema.maxLength : Number.POSITIVE_INFINITY
      return ['', 'a'.repeat(Math.max(1, minimum)), 'λ']
        .filter(value => value.length >= minimum && value.length <= maximum)
    }
    case 'integer':
    case 'number': {
      const minimum = typeof schema.minimum === 'number' ? schema.minimum : 0
      const maximum = typeof schema.maximum === 'number' ? schema.maximum : minimum + 2
      return [...new Set([minimum, Math.min(maximum, minimum + 1), maximum])]
    }
    case 'boolean':
      return [false, true]
    default:
      return [null]
  }
}

function objectWitnesses(
  schema: Schema,
  root: Schema,
  visiting: Set<Schema>,
  path: string,
): JsonValue[] {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === 'string')
      : [],
  )
  const baseline: Record<string, JsonValue> = {}
  for (const name of [...required].sort()) {
    const property = asSchema(properties[name] ?? {})
    baseline[name] = witnessValues(property, root, visiting, `${path}/properties/${name}`)[0] ?? null
  }
  const results: JsonValue[] = [baseline]
  for (const name of Object.keys(properties).sort()) {
    if (required.has(name)) { continue }
    const property = asSchema(properties[name])
    results.push({
      ...baseline,
      [name]: witnessValues(property, root, visiting, `${path}/properties/${name}`)[0] ?? null,
    })
  }
  return results
}

function minimalRecursiveBase(schema: Schema): JsonValue {
  if (schema.type === 'array') { return [] }
  if (schema.type === 'object' || schema.properties) { return {} }
  if (Array.isArray(schema.type) && schema.type.includes('null')) { return null }
  return null
}

function resolveReference(root: Schema, reference: string): Schema {
  if (!reference.startsWith('#/')) { throw new Error(`Unsupported external $ref: ${reference}`) }
  let current: unknown = root
  for (const rawPart of reference.slice(2).split('/')) {
    if (!isRecord(current)) { throw new Error(`Unresolved $ref: ${reference}`) }
    current = current[rawPart.replaceAll('~1', '/').replaceAll('~0', '~')]
  }
  return asSchema(current)
}

function asSchema(value: unknown): Schema {
  if (!isRecord(value)) { return {} }
  return value
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function deduplicate(values: readonly JsonValue[]): JsonValue[] {
  const entries = new Map(values.map(value => [JSON.stringify(value), value]))
  return [...entries.values()]
}
