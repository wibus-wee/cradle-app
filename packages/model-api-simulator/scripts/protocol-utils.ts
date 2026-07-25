import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type Json = boolean | number | string | null | Json[] | { [key: string]: Json }

export function canonicalize(value: Json): Json {
  if (Array.isArray(value)) { return value.map(canonicalize) }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function serialize(value: Json): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8')) as Json
}

export async function writeJson(path: string, value: Json): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serialize(value))
}

export function asRecord(value: Json): Record<string, Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Expected a JSON object') }
  return value
}

export function filterDiscriminatedBranches(
  value: Json,
  allowed: ReadonlySet<string>,
  excludedMarkers: readonly string[],
): Json | undefined {
  if (Array.isArray(value)) {
    const children = value
      .map(child => filterDiscriminatedBranches(child, allowed, excludedMarkers))
      .filter((child): child is Json => child !== undefined)
    return children
  }
  if (!value || typeof value !== 'object') { return value }

  const record = value as Record<string, Json>
  if (
    typeof record.$ref === 'string'
    && excludedMarkers.some(marker =>
      normalizeIdentity(record.$ref as string).includes(normalizeIdentity(marker)))
    && ![...allowed].some(discriminator => record.$ref.includes(discriminator))
  ) { return undefined }
  const properties
    = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? (record.properties as Record<string, Json>)
      : undefined
  const typeSchema
    = properties?.type && typeof properties.type === 'object' && !Array.isArray(properties.type)
      ? (properties.type as Record<string, Json>)
      : undefined
  const discriminator
    = typeof typeSchema?.const === 'string'
      ? typeSchema.const
      : Array.isArray(typeSchema?.enum) && typeSchema.enum.length === 1
        ? typeSchema.enum[0]
        : undefined

  if (
    typeof discriminator === 'string'
    && excludedMarkers.some(marker => discriminator.includes(marker))
    && !allowed.has(discriminator)
  ) { return undefined }

  const filtered = Object.fromEntries(
    Object.entries(record).flatMap(([key, child]) => {
      if (
        excludedMarkers.some(marker =>
          normalizeIdentity(key).includes(normalizeIdentity(marker)))
        && !allowed.has(key)
      ) { return [] }
      if (key === 'enum' && Array.isArray(child)) {
        const retainedValues = child.filter(
          candidate =>
            typeof candidate !== 'string'
            || allowed.has(candidate)
            || !excludedMarkers.some(marker =>
              normalizeIdentity(candidate).includes(normalizeIdentity(marker))),
        )
        return retainedValues.length > 0 ? [[key, retainedValues]] : []
      }
      const next = filterDiscriminatedBranches(child, allowed, excludedMarkers)
      return next === undefined ? [] : [[key, next]]
    }),
  )
  if (
    (Array.isArray(filtered.oneOf) && filtered.oneOf.length === 0)
    || (Array.isArray(filtered.anyOf) && filtered.anyOf.length === 0)
  ) { return undefined }
  if (
    filtered.properties
    && typeof filtered.properties === 'object'
    && !Array.isArray(filtered.properties)
    && Array.isArray(filtered.required)
  ) {
    const retainedProperties = new Set(Object.keys(filtered.properties))
    filtered.required = filtered.required.filter(
      name => typeof name !== 'string' || retainedProperties.has(name),
    )
  }
  return filtered
}

export function pruneLocalDefinitions(value: Json): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return value }
  const record = value as Record<string, Json>
  const definitions = record.definitions
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) { return value }

  const definitionRecord = definitions as Record<string, Json>
  const root = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'definitions'),
  ) as Record<string, Json>
  const reachable = new Set<string>()
  collectLocalDefinitionReferences(root, reachable)
  const queue = [...reachable]
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index]
    if (!name) { continue }
    const definition = definitionRecord[name]
    if (definition === undefined) { throw new Error(`Unresolved local definition "${name}"`) }
    const before = reachable.size
    collectLocalDefinitionReferences(definition, reachable)
    if (reachable.size > before) { for (const candidate of reachable) { if (!queue.includes(candidate)) { queue.push(candidate) } } }
  }

  return {
    ...root,
    definitions: Object.fromEntries(
      [...reachable]
        .sort((left, right) => left.localeCompare(right))
        .map(name => [name, definitionRecord[name]!]),
    ),
  }
}

function collectLocalDefinitionReferences(value: Json, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) { collectLocalDefinitionReferences(child, names) }
    return
  }
  if (!value || typeof value !== 'object') { return }
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string') {
      const match = /^#\/definitions\/(.+)$/.exec(child)
      if (match?.[1]) { names.add(match[1].replaceAll('~1', '/').replaceAll('~0', '~')) }
    }
 else { collectLocalDefinitionReferences(child, names) }
  }
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}
