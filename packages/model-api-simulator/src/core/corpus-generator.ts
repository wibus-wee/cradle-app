import type { JsonValue } from '../contract'
import { isJsonArray, isJsonObject } from '../contract'

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

interface Candidate {
  readonly value: JsonValue
  readonly covers: readonly string[]
}

export class UnsupportedSchemaConstructError extends Error {
  override readonly name = 'UnsupportedSchemaConstructError'

  constructor(readonly schemaPath: string, construct: string) {
    super(`Unsupported reachable schema construct "${construct}" at ${schemaPath}`)
  }
}

export function generateSchemaWitnesses(schema: Schema): readonly CorpusWitness[] {
  return deduplicateCandidates(buildCandidates(schema, schema, '#', new Set()))
    .map((candidate, index) => ({
      id: `witness-${index}`,
      value: candidate.value,
      covers: [...new Set(candidate.covers)].sort(),
    }))
}

export function enumerateSchemaObligations(schema: Schema): readonly string[] {
  const obligations = new Set<string>()
  collectObligations(schema, schema, '#', new Set(), obligations)
  return [...obligations].sort()
}

export function generateInvalidMutations(
  schema: Schema,
  witness: JsonValue,
): readonly CorpusMutation[] {
  const mutations: CorpusMutation[] = []
  collectMutations(schema, schema, witness, '', '#', mutations, new Set())
  return deduplicateMutations(mutations)
}

function buildCandidates(
  schema: Schema,
  root: Schema,
  path: string,
  seenReferences: ReadonlySet<string>,
): Candidate[] {
  if (schema.$simulatorBooleanSchema === false) { return [] }
  if (schema.$simulatorBooleanSchema === true) {
    return [{ value: null, covers: [`${path}:boolean-schema:true`] }]
  }
  rejectUnsupportedKeywords(schema, path)
  if (typeof schema.$ref === 'string') {
    const reference = schema.$ref
    const target = resolveReference(root, reference)
    if (seenReferences.has(reference)) {
      return [{
        value: minimalRecursiveBase(target),
        covers: [`${path}:recursion:one`],
      }]
    }
    const next = new Set(seenReferences)
    next.add(reference)
    return buildCandidates(target, root, reference, next)
  }
  if ('const' in schema) {
    return [{ value: schema.const as JsonValue, covers: [`${path}:const`] }]
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value, index) => ({
      value: value as JsonValue,
      covers: [`${path}:enum:${index}`],
    }))
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.flatMap((branch, index) =>
      buildCandidates(asSchema(branch, `${path}/oneOf/${index}`), root, `${path}/oneOf/${index}`, seenReferences)
        .map(candidate => ({
          value: candidate.value,
          covers: [`${path}:oneOf:${index}`, ...candidate.covers],
        })))
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.flatMap((branch, index) =>
      buildCandidates(asSchema(branch, `${path}/anyOf/${index}`), root, `${path}/anyOf/${index}`, seenReferences)
        .map(candidate => ({
          value: candidate.value,
          covers: [`${path}:anyOf:${index}`, ...candidate.covers],
        })))
  }
  if (Array.isArray(schema.allOf)) {
    return combineAllOf(schema.allOf, root, path, seenReferences)
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.includes('null')) {
    const nonNull = types.filter(type => type !== 'null')
    const candidates: Candidate[] = [{
      value: null,
      covers: [`${path}:nullable:null`],
    }]
    if (nonNull.length > 0) {
      candidates.push(
        ...buildCandidates({ ...schema, type: nonNull.length === 1 ? nonNull[0] : nonNull }, root, path, seenReferences)
          .map(candidate => ({
            value: candidate.value,
            covers: [`${path}:nullable:non-null`, ...candidate.covers],
          })),
      )
    }
    return candidates
  }

  switch (types[0]) {
    case 'object':
    case undefined:
      if (
        types[0] === undefined
        && !schema.properties
        && schema.additionalProperties === undefined
      ) {
        return [{ value: null, covers: [`${path}:unconstrained`] }]
      }
      return objectCandidates(schema, root, path, seenReferences)
    case 'array':
      return arrayCandidates(schema, root, path, seenReferences)
    case 'string':
      return stringCandidates(schema, path)
    case 'integer':
    case 'number':
      return numberCandidates(schema, path)
    case 'boolean':
      return [
        { value: false, covers: [`${path}:boolean:false`] },
        { value: true, covers: [`${path}:boolean:true`] },
      ]
    case 'null':
      return [{ value: null, covers: [`${path}:null`] }]
    default:
      throw new UnsupportedSchemaConstructError(path, `type:${String(types[0])}`)
  }
}

function objectCandidates(
  schema: Schema,
  root: Schema,
  path: string,
  seenReferences: ReadonlySet<string>,
): Candidate[] {
  const properties = schemaRecord(schema.properties, `${path}/properties`)
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.map((value) => {
          if (typeof value !== 'string') {
            throw new UnsupportedSchemaConstructError(`${path}/required`, 'non-string-required')
          }
          return value
        })
      : [],
  )
  const propertyCandidates = new Map<string, Candidate[]>()
  for (const [name, property] of Object.entries(properties)) {
    propertyCandidates.set(
      name,
      buildCandidates(
        asSchema(property, `${path}/properties/${escapePointer(name)}`),
        root,
        `${path}/properties/${escapePointer(name)}`,
        seenReferences,
      ),
    )
  }

  const baseline: Record<string, JsonValue> = {}
  const baselineCovers: string[] = []
  for (const name of [...required].sort()) {
    const candidate = propertyCandidates.get(name)?.[0]
    if (!candidate) {
      baselineCovers.push(`${path}:required:${escapePointer(name)}`)
      continue
    }
    baseline[name] = candidate.value
    baselineCovers.push(`${path}:required:${escapePointer(name)}`, ...candidate.covers)
  }
  for (const name of [...propertyCandidates.keys()].sort()) {
    if (!required.has(name)) {
      baselineCovers.push(`${path}:optional:${escapePointer(name)}:absent`)
      const property = properties[name]
      if (
        isSchemaRecord(property)
        && typeof property.$ref === 'string'
        && seenReferences.has(property.$ref)
      ) {
        baselineCovers.push(`${path}/properties/${escapePointer(name)}:recursion:zero`)
      }
    }
  }

  const results: Candidate[] = [{ value: baseline, covers: baselineCovers }]
  for (const name of [...required].sort()) {
    const candidates = propertyCandidates.get(name)
    if (!candidates) { continue }
    for (const candidate of candidates.slice(1)) {
      results.push({
        value: { ...baseline, [name]: candidate.value },
        covers: [`${path}:required:${escapePointer(name)}`, ...candidate.covers],
      })
    }
  }
  for (const name of [...propertyCandidates.keys()].sort()) {
    if (required.has(name)) { continue }
    for (const candidate of propertyCandidates.get(name)!) {
      results.push({
        value: { ...baseline, [name]: candidate.value },
        covers: [
          `${path}:optional:${escapePointer(name)}:present`,
          ...candidate.covers,
        ],
      })
    }
  }

  if (schema.additionalProperties === false) {
    results[0] = {
      value: results[0]!.value,
      covers: [...results[0]!.covers, `${path}:additionalProperties:false`],
    }
  }
  else if (schema.additionalProperties === true || isSchemaRecord(schema.additionalProperties)) {
    const additional = schema.additionalProperties === true
      ? [{ value: 'value', covers: [] }]
      : buildCandidates(
          asSchema(schema.additionalProperties, `${path}/additionalProperties`),
          root,
          `${path}/additionalProperties`,
          seenReferences,
        )
    for (const candidate of additional) {
      results.push({
        value: { ...baseline, additional_property: candidate.value },
        covers: [`${path}:additionalProperties:present`, ...candidate.covers],
      })
    }
  }
  return results
}

function arrayCandidates(
  schema: Schema,
  root: Schema,
  path: string,
  seenReferences: ReadonlySet<string>,
): Candidate[] {
  const minimum = numberKeyword(schema, 'minItems', 0)
  const maximum = numberKeyword(schema, 'maxItems', Number.POSITIVE_INFINITY)
  const itemCandidates = schema.items === false
    ? []
    : buildCandidates(
        asSchema(schema.items ?? {}, `${path}/items`),
        root,
        `${path}/items`,
        seenReferences,
      )
  const lengths = [...new Set([0, 1, 2].map(length => Math.max(minimum, length)))]
    .filter(length => length <= maximum && (itemCandidates.length > 0 || length === 0))
  if (lengths.length === 0) {
    throw new UnsupportedSchemaConstructError(path, 'unsatisfiable-array-bounds')
  }
  const baselineItem = itemCandidates[0]?.value ?? null
  const results = lengths.map(length => ({
    value: Array.from<JsonValue>({ length }).fill(baselineItem),
    covers: [`${path}:array:length:${length}`],
  }))
  if (lengths.includes(1)) {
    for (const candidate of itemCandidates) {
      results.push({
        value: [candidate.value],
        covers: [`${path}:array:length:1`, ...candidate.covers],
      })
    }
  }
  return results
}

function stringCandidates(schema: Schema, path: string): Candidate[] {
  const minimum = numberKeyword(schema, 'minLength', 0)
  const maximum = numberKeyword(schema, 'maxLength', Number.POSITIVE_INFINITY)
  const format = typeof schema.format === 'string' ? schema.format : undefined
  const pattern = typeof schema.pattern === 'string' ? schema.pattern : undefined
  const sourceValues = [
    ...(typeof schema.default === 'string' ? [schema.default] : []),
    ...(typeof schema.example === 'string' ? [schema.example] : []),
    ...(Array.isArray(schema.examples)
      ? schema.examples.filter((value): value is string => typeof value === 'string')
      : []),
    ...(format ? formatWitnesses(format, path) : []),
    ...(minimum === 0 && !format && !pattern ? [''] : []),
    ...(!format ? ['a'.repeat(Math.max(1, minimum))] : []),
    ...(!format && !pattern ? ['λ'.repeat(Math.max(1, minimum))] : []),
  ]
  const expression = pattern ? new RegExp(pattern, typeof schema.patternFlags === 'string' ? schema.patternFlags : '') : undefined
  const values = [...new Set(sourceValues)].filter(value =>
    value.length >= minimum && value.length <= maximum && (!expression || expression.test(value)))
  if (values.length === 0) {
    throw new UnsupportedSchemaConstructError(path, `string-pattern-without-source-witness:${pattern ?? format ?? ''}`)
  }
  return values.map((value, index) => ({
    value,
    covers: [`${path}:string:${stringClass(value, index)}`],
  }))
}

function numberCandidates(schema: Schema, path: string): Candidate[] {
  const exclusiveMinimum = typeof schema.exclusiveMinimum === 'number'
    ? schema.exclusiveMinimum
    : undefined
  const exclusiveMaximum = typeof schema.exclusiveMaximum === 'number'
    ? schema.exclusiveMaximum
    : undefined
  const minimum = typeof schema.minimum === 'number'
    ? schema.minimum
    : exclusiveMinimum === undefined ? 0 : exclusiveMinimum + 1
  const maximum = typeof schema.maximum === 'number'
    ? schema.maximum
    : exclusiveMaximum === undefined ? minimum + 2 : exclusiveMaximum - 1
  const integer = schema.type === 'integer'
  const normalize = (value: number): number => integer ? Math.ceil(value) : value
  const values = [...new Set([
    normalize(minimum),
    normalize((minimum + maximum) / 2),
    integer ? Math.floor(maximum) : maximum,
  ])].filter(value =>
    value >= minimum
    && value <= maximum
    && (exclusiveMinimum === undefined || value > exclusiveMinimum)
    && (exclusiveMaximum === undefined || value < exclusiveMaximum))
  if (values.length === 0) {
    throw new UnsupportedSchemaConstructError(path, 'unsatisfiable-number-bounds')
  }
  return values.map((value, index) => ({
    value,
    covers: [`${path}:number:${index === 0 ? 'minimum' : index === values.length - 1 ? 'maximum' : 'interior'}`],
  }))
}

function combineAllOf(
  parts: readonly unknown[],
  root: Schema,
  path: string,
  seenReferences: ReadonlySet<string>,
): Candidate[] {
  const partSchemas = parts.map((part, index) =>
    resolveMaybeReference(asSchema(part, `${path}/allOf/${index}`), root))
  const groups = parts.map((part, index) =>
    buildCandidates(asSchema(part, `${path}/allOf/${index}`), root, `${path}/allOf/${index}`, seenReferences))
  const baselines = groups.map(group => group[0]!)
  const required = new Set(
    partSchemas.flatMap(schema =>
      Array.isArray(schema.required)
        ? schema.required.filter((value): value is string => typeof value === 'string')
        : []),
  )
  const propertySchemas = new Map<string, Schema>()
  partSchemas.forEach((schema, partIndex) => {
    const properties = schemaRecord(schema.properties, `${path}/allOf/${partIndex}/properties`)
    for (const [name, property] of Object.entries(properties)) {
      propertySchemas.set(
        name,
        asSchema(property, `${path}/allOf/${partIndex}/properties/${escapePointer(name)}`),
      )
    }
  })
  const complete = (candidate: Candidate): Candidate =>
    completeRequiredProperties(
      candidate,
      required,
      propertySchemas,
      root,
      path,
      seenReferences,
    )
  const baseline = complete(mergeCandidates(baselines, path))
  const results: Candidate[] = [{
    value: baseline.value,
    covers: [`${path}:allOf`, ...baseline.covers],
  }]
  for (let partIndex = 0; partIndex < groups.length; partIndex += 1) {
    for (const variation of groups[partIndex]!.slice(1)) {
      const merged = complete(mergeCandidates(
        baselines.map((candidate, index) => index === partIndex ? variation : candidate),
        path,
      ))
      results.push({
        value: merged.value,
        covers: [`${path}:allOf`, ...variation.covers],
      })
    }
  }
  return results.filter(candidate =>
    partSchemas.every(schema => schemaAccepts(candidate.value, schema, root)))
}

function completeRequiredProperties(
  candidate: Candidate,
  required: ReadonlySet<string>,
  propertySchemas: ReadonlyMap<string, Schema>,
  root: Schema,
  path: string,
  seenReferences: ReadonlySet<string>,
): Candidate {
  if (!isJsonObject(candidate.value)) { return candidate }
  const value: Record<string, JsonValue> = { ...candidate.value }
  const covers = candidate.covers.filter(obligation =>
    ![...required].some(name =>
      obligation.endsWith(`:optional:${escapePointer(name)}:absent`)))
  for (const name of required) {
    if (value[name] !== undefined) { continue }
    const property = propertySchemas.get(name)
    if (!property) { continue }
    const generated = buildCandidates(
      property,
      root,
      `${path}/allOf/required/${escapePointer(name)}`,
      seenReferences,
    )[0]
    if (!generated) { continue }
    value[name] = generated.value
    covers.push(`${path}:allOf:required:${escapePointer(name)}`, ...generated.covers)
  }
  return { value, covers }
}

function mergeCandidates(candidates: readonly Candidate[], path: string): Candidate {
  const values = candidates.map(candidate => candidate.value)
  if (values.every(isJsonObject)) {
    return {
      value: Object.assign({}, ...values),
      covers: candidates.flatMap(candidate => candidate.covers),
    }
  }
  const nonNull = values.filter(value => value !== null)
  if (nonNull.length === 1) {
    return {
      value: nonNull[0]!,
      covers: candidates.flatMap(candidate => candidate.covers),
    }
  }
  if (values.every(value => Object.is(value, values[0]))) {
    return {
      value: values[0]!,
      covers: candidates.flatMap(candidate => candidate.covers),
    }
  }
  throw new UnsupportedSchemaConstructError(path, 'allOf-non-object-merge')
}

function collectObligations(
  schema: Schema,
  root: Schema,
  path: string,
  seenReferences: ReadonlySet<string>,
  obligations: Set<string>,
): void {
  for (const candidate of buildCandidates(schema, root, path, seenReferences)) {
    for (const obligation of candidate.covers) { obligations.add(obligation) }
  }
}

function collectMutations(
  schema: Schema,
  root: Schema,
  witness: JsonValue,
  valuePointer: string,
  schemaPath: string,
  mutations: CorpusMutation[],
  seenReferences: Set<string>,
): void {
  if (typeof schema.$ref === 'string') {
    if (seenReferences.has(schema.$ref)) { return }
    seenReferences.add(schema.$ref)
    collectMutations(
      resolveReference(root, schema.$ref),
      root,
      witness,
      valuePointer,
      schema.$ref,
      mutations,
      seenReferences,
    )
    return
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const branches = (schema.oneOf ?? schema.anyOf) as unknown[]
    const discriminator = findDiscriminatorProperty(branches, root)
    if (discriminator && isJsonObject(witness) && discriminator in witness) {
      mutations.push({
        id: `wrong-discriminator:${valuePointer || '/'}`,
        value: setAtPointer(witness, `${valuePointer}/${escapePointer(discriminator)}`, '__invalid_discriminator__'),
        targetedRule: `${schemaPath}:discriminator`,
      })
    }
    for (const [index, branch] of branches.entries()) {
      collectMutations(
        asSchema(branch, `${schemaPath}/union/${index}`),
        root,
        witness,
        valuePointer,
        `${schemaPath}/union/${index}`,
        mutations,
        new Set(seenReferences),
      )
    }
    return
  }
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((part, index) =>
      collectMutations(
        asSchema(part, `${schemaPath}/allOf/${index}`),
        root,
        witness,
        valuePointer,
        `${schemaPath}/allOf/${index}`,
        mutations,
        new Set(seenReferences),
      ))
    return
  }
  if (isJsonObject(witness)) {
    const properties = schemaRecord(schema.properties, `${schemaPath}/properties`)
    const required = Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === 'string')
      : []
    for (const name of required) {
      if (name in witness) {
        mutations.push({
          id: `omit:${valuePointer}/${escapePointer(name)}`,
          value: deleteAtPointer(witness, `${valuePointer}/${escapePointer(name)}`),
          targetedRule: `${schemaPath}:required:${name}`,
        })
      }
    }
    for (const [name, property] of Object.entries(properties)) {
      const child = witness[name]
      if (child === undefined) { continue }
      const childPath = `${valuePointer}/${escapePointer(name)}`
      mutations.push({
        id: `wrong-type:${childPath}`,
        value: setAtPointer(witness, childPath, wrongPrimitive(child)),
        targetedRule: `${schemaPath}/properties/${escapePointer(name)}:type`,
      })
      collectMutations(
        asSchema(property, `${schemaPath}/properties/${escapePointer(name)}`),
        root,
        child,
        childPath,
        `${schemaPath}/properties/${escapePointer(name)}`,
        mutations,
        new Set(seenReferences),
      )
    }
  }
  if (
    typeof witness === 'number'
    && (typeof schema.maximum === 'number' || typeof schema.exclusiveMaximum === 'number')
  ) {
    const maximum = typeof schema.maximum === 'number' ? schema.maximum : schema.exclusiveMaximum as number
    mutations.push({
      id: `bound:${valuePointer || '/'}`,
      value: setAtPointer(witness, valuePointer, maximum + 1),
      targetedRule: `${schemaPath}:maximum`,
    })
  }
  if (typeof witness === 'string' && typeof schema.maxLength === 'number') {
    mutations.push({
      id: `bound:${valuePointer || '/'}`,
      value: setAtPointer(witness, valuePointer, 'x'.repeat(schema.maxLength + 1)),
      targetedRule: `${schemaPath}:maxLength`,
    })
  }
}

function findDiscriminatorProperty(branches: readonly unknown[], root: Schema): string | undefined {
  for (const branch of branches) {
    const schema = resolveMaybeReference(asSchema(branch, '#/union'), root)
    const properties = schemaRecord(schema.properties, '#/union/properties')
    for (const [name, property] of Object.entries(properties)) {
      const record = asSchema(property, '#/union/property')
      if ('const' in record || Array.isArray(record.enum)) { return name }
    }
  }
  return undefined
}

function resolveMaybeReference(schema: Schema, root: Schema): Schema {
  return typeof schema.$ref === 'string' ? resolveReference(root, schema.$ref) : schema
}

function wrongPrimitive(value: JsonValue): JsonValue {
  if (typeof value === 'string') { return 1 }
  if (typeof value === 'number') { return 'wrong-type' }
  if (typeof value === 'boolean') { return 'wrong-type' }
  if (value === null) { return 'wrong-type' }
  if (isJsonArray(value)) { return {} }
  return []
}

function setAtPointer(root: JsonValue, pointer: string, replacement: JsonValue): JsonValue {
  if (pointer === '') { return replacement }
  const parts = pointer.slice(1).split('/').map(unescapePointer)
  return modifyAtPath(root, parts, () => replacement)
}

function deleteAtPointer(root: JsonValue, pointer: string): JsonValue {
  const parts = pointer.slice(1).split('/').map(unescapePointer)
  return modifyAtPath(root, parts, () => undefined)
}

function modifyAtPath(
  value: JsonValue,
  parts: readonly string[],
  update: () => JsonValue | undefined,
): JsonValue {
  if (parts.length === 0) { return update() ?? null }
  const [head, ...tail] = parts
  if (isJsonArray(value)) {
    const copy = [...value]
    const index = Number(head)
    const next = modifyAtPath(copy[index]!, tail, update)
    copy[index] = next
    return copy
  }
  if (!isJsonObject(value)) { return value }
  const copy: Record<string, JsonValue> = { ...value }
  if (tail.length === 0) {
    const next = update()
    if (next === undefined) { delete copy[head!] }
    else { copy[head!] = next }
  }
  else { copy[head!] = modifyAtPath(copy[head!]!, tail, update) }
  return copy
}

function rejectUnsupportedKeywords(schema: Schema, path: string): void {
  for (const keyword of ['not', 'if', 'then', 'else', 'dependentSchemas', 'unevaluatedProperties']) {
    if (keyword in schema) { throw new UnsupportedSchemaConstructError(path, keyword) }
  }
  if (Array.isArray(schema.prefixItems)) {
    throw new UnsupportedSchemaConstructError(path, 'prefixItems')
  }
}

function formatWitnesses(format: string, path: string): readonly [string, string] {
  switch (format) {
    case 'date-time': return ['2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z']
    case 'date': return ['2020-01-01', '2020-01-02']
    case 'time': return ['00:00:00Z', '00:00:01Z']
    case 'email': return ['test@example.com', 'ordinary@example.com']
    case 'hostname': return ['example.test', 'ordinary.example.test']
    case 'ipv4': return ['127.0.0.1', '127.0.0.2']
    case 'ipv6': return ['::1', '2001:db8::1']
    case 'uri':
    case 'url':
      return ['https://example.test/resource', 'https://example.test/ordinary']
    case 'uuid':
      return [
        '00000000-0000-4000-8000-000000000000',
        '00000000-0000-4000-8000-000000000001',
      ]
    default:
      throw new UnsupportedSchemaConstructError(path, `format:${format}`)
  }
}

function schemaAccepts(value: JsonValue, schema: Schema, root: Schema): boolean {
  if (schema.$simulatorBooleanSchema === false) { return false }
  if (schema.$simulatorBooleanSchema === true) { return true }
  if (typeof schema.$ref === 'string') {
    return schemaAccepts(value, resolveReference(root, schema.$ref), root)
  }
  if ('const' in schema) { return Object.is(value, schema.const) }
  if (Array.isArray(schema.enum)) {
    return schema.enum.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.filter(branch =>
      schemaAccepts(value, asSchema(branch, '#/oneOf'), root)).length === 1
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some(branch =>
      schemaAccepts(value, asSchema(branch, '#/anyOf'), root))
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.every(branch =>
      schemaAccepts(value, asSchema(branch, '#/allOf'), root))
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length > 0 && !types.some(type => valueHasType(value, type))) { return false }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) { return false }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) { return false }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) { return false }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) { return false }
    if (typeof schema.maximum === 'number' && value > schema.maximum) { return false }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) { return false }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) { return false }
  }
  if (isJsonArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) { return false }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) { return false }
    if (schema.items === false && value.length > 0) { return false }
    if (schema.items && schema.items !== true && schema.items !== false) {
      const itemSchema = asSchema(schema.items, '#/items')
      if (!value.every(item => schemaAccepts(item, itemSchema, root))) { return false }
    }
  }
  if (isJsonObject(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
    if (required.some(name => !(name in value))) { return false }
    const properties = schemaRecord(schema.properties, '#/properties')
    for (const [name, property] of Object.entries(properties)) {
      if (value[name] !== undefined && !schemaAccepts(value[name]!, asSchema(property, '#/property'), root)) {
        return false
      }
    }
  }
  return true
}

function valueHasType(value: JsonValue, type: unknown): boolean {
  switch (type) {
    case 'null': return value === null
    case 'object': return isJsonObject(value)
    case 'array': return isJsonArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    default: return false
  }
}

function stringClass(value: string, index: number): string {
  if (value === '') { return 'empty' }
  if (/[^\x00-\x7F]/.test(value)) { return 'unicode' }
  return index === 0 ? 'minimum' : 'ascii'
}

function minimalRecursiveBase(schema: Schema): JsonValue {
  if (Array.isArray(schema.type) && schema.type.includes('null')) { return null }
  if (schema.type === 'array') { return [] }
  if (schema.type === 'object' || schema.properties) {
    const properties = schemaRecord(schema.properties, '#/recursive/properties')
    const required = Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === 'string')
      : []
    const object: Record<string, JsonValue> = {}
    for (const name of required) {
      const property = asSchema(properties[name] ?? {}, `#/recursive/properties/${name}`)
      if (typeof property.$ref === 'string') { continue }
      object[name] = buildCandidates(property, property, '#/recursive', new Set())[0]?.value ?? null
    }
    return object
  }
  return null
}

function resolveReference(root: Schema, reference: string): Schema {
  if (!reference.startsWith('#/')) {
    throw new UnsupportedSchemaConstructError('#/$ref', `external-ref:${reference}`)
  }
  let current: unknown = root
  for (const rawPart of reference.slice(2).split('/')) {
    if (!isSchemaRecord(current)) {
      throw new UnsupportedSchemaConstructError(reference, 'unresolved-ref')
    }
    current = current[unescapePointer(rawPart)]
  }
  return asSchema(current, reference)
}

function asSchema(value: unknown, path: string): Schema {
  if (typeof value === 'boolean') { return { $simulatorBooleanSchema: value } }
  if (!isSchemaRecord(value)) {
    throw new UnsupportedSchemaConstructError(path, 'non-object-schema')
  }
  return value
}

function schemaRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) { return {} }
  if (!isSchemaRecord(value)) {
    throw new UnsupportedSchemaConstructError(path, 'non-object-map')
  }
  return value
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function numberKeyword(schema: Schema, key: string, fallback: number): number {
  const value = schema[key]
  if (value === undefined) { return fallback }
  if (typeof value !== 'number') {
    throw new UnsupportedSchemaConstructError(`#/${key}`, `non-number-${key}`)
  }
  return value
}

function deduplicateCandidates(candidates: readonly Candidate[]): Candidate[] {
  const entries = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.value)
    const existing = entries.get(key)
    entries.set(key, existing
      ? {
          value: existing.value,
          covers: [...new Set([...existing.covers, ...candidate.covers])],
        }
      : candidate)
  }
  return [...entries.values()]
}

function deduplicateMutations(mutations: readonly CorpusMutation[]): CorpusMutation[] {
  const entries = new Map<string, CorpusMutation>()
  for (const mutation of mutations) {
    entries.set(`${mutation.targetedRule}:${JSON.stringify(mutation.value)}`, mutation)
  }
  return [...entries.values()]
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function unescapePointer(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~')
}
