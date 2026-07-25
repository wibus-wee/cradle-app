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

export function removeSourceMetadata(value: Json): Json {
  if (Array.isArray(value)) { return value.map(removeSourceMetadata) }
  if (!value || typeof value !== 'object') { return value }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'x-oaiMeta')
      .map(([key, child]) => [key, removeSourceMetadata(child)]),
  )
}

export function applyExactEnumSelections(
  root: Json,
  selections: Readonly<Record<string, readonly string[]>>,
): void {
  for (const [pointer, allowed] of Object.entries(selections)) {
    const target = resolveJsonPointer(root, pointer)
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error(`Enum selection target is not an object: ${pointer}`)
    }
    const record = target as Record<string, Json>
    if (!Array.isArray(record.enum)) {
      throw new TypeError(`Enum selection target has no enum: ${pointer}`)
    }
    const source = new Set(record.enum)
    for (const value of allowed) {
      if (!source.has(value)) { throw new Error(`Enum selection "${value}" missing at ${pointer}`) }
    }
    record.enum = [...allowed]
  }
}

export function applyExactBranchSelections(
  root: Json,
  selections: Readonly<Record<string, readonly string[]>>,
): void {
  for (const [pointer, allowedReferences] of Object.entries(selections)) {
    const target = resolveJsonPointer(root, pointer)
    if (!Array.isArray(target)) {
      throw new TypeError(`Branch selection target is not an array: ${pointer}`)
    }
    const allowed = new Set(allowedReferences)
    const retained = target.filter((branch) => {
      if (!branch || typeof branch !== 'object' || Array.isArray(branch)) { return false }
      const reference = (branch as Record<string, Json>).$ref
      return typeof reference === 'string' && allowed.has(reference)
    })
    const retainedRefs = new Set(retained.map(branch =>
      ((branch as Record<string, Json>).$ref as string)))
    const missing = [...allowed].filter(reference => !retainedRefs.has(reference))
    if (missing.length > 0) {
      throw new Error(`Branch selections missing at ${pointer}: ${missing.join(', ')}`)
    }
    target.splice(0, target.length, ...retained)
  }
}

export function retainAllowlistedDiscriminatedBranches(
  value: Json,
  root: Json,
  allowed: ReadonlySet<string>,
  path = '#',
): Json {
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      retainAllowlistedDiscriminatedBranches(child, root, allowed, `${path}/${index}`))
  }
  if (!value || typeof value !== 'object') { return value }

  const record = value as Record<string, Json>
  for (const unionKey of ['oneOf', 'anyOf'] as const) {
    const union = record[unionKey]
    if (!Array.isArray(union) || union.length === 0) { continue }
    const retained = union.filter((branch) => {
      const identities = discriminatedBranchIdentities(branch, root)
      return identities === undefined || identities.some(identity => allowed.has(identity))
    })
    if (retained.length === 0) { return false }
  }
  const filtered = Object.fromEntries(
    Object.entries(record).map(([key, child]) => {
      if ((key === 'oneOf' || key === 'anyOf') && Array.isArray(child)) {
        const retained = child.filter((branch) => {
          const identities = discriminatedBranchIdentities(branch, root)
          return identities === undefined || identities.some(identity => allowed.has(identity))
        })
        return [key, retained.map(branch =>
          retainAllowlistedDiscriminatedBranches(branch, root, allowed, `${path}/${key}`))]
      }
      return [key, retainAllowlistedDiscriminatedBranches(child, root, allowed, `${path}/${key}`)]
    }),
  )
  return filtered
}

export function assertOnlyAllowlistedDiscriminatedBranches(
  value: Json,
  root: Json,
  allowed: ReadonlySet<string>,
  path = '#',
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertOnlyAllowlistedDiscriminatedBranches(child, root, allowed, `${path}/${index}`))
    return
  }
  if (!value || typeof value !== 'object') { return }
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'oneOf' || key === 'anyOf') && Array.isArray(child)) {
      for (const [index, branch] of child.entries()) {
        const identities = discriminatedBranchIdentities(branch, root)
        const disallowed = identities?.filter(identity => !allowed.has(identity)) ?? []
        if (identities !== undefined && disallowed.length > 0) {
          throw new Error(
            `Non-allowlisted discriminator "${disallowed.join(', ')}" remains at ${path}/${key}/${index}`,
          )
        }
      }
    }
    assertOnlyAllowlistedDiscriminatedBranches(child, root, allowed, `${path}/${key}`)
  }
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

function discriminatedBranchIdentities(branch: Json, root: Json): readonly string[] | undefined {
  const resolved = resolveLocalReference(branch, root)
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) { return undefined }
  const record = resolved as Record<string, Json>
  const properties = record.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    if (Array.isArray(record.allOf)) {
      const identities = new Set(
        record.allOf.flatMap(part => discriminatedBranchIdentities(part, root) ?? []),
      )
      return identities.size > 0 ? [...identities] : undefined
    }
    return undefined
  }
  const type = (properties as Record<string, Json>).type
  if (!type || typeof type !== 'object' || Array.isArray(type)) { return undefined }
  const typeRecord = type as Record<string, Json>
  if (typeof typeRecord.const === 'string') { return [typeRecord.const] }
  if (
    Array.isArray(typeRecord.enum)
    && typeRecord.enum.length > 0
    && typeRecord.enum.every(value => typeof value === 'string')
  ) {
    return typeRecord.enum as string[]
  }
  return undefined
}

function resolveLocalReference(value: Json, root: Json): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return value }
  const reference = (value as Record<string, Json>).$ref
  if (typeof reference !== 'string' || !reference.startsWith('#/')) { return value }
  let current = root
  for (const rawPart of reference.slice(2).split('/')) {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`Unresolved local reference "${reference}"`)
    }
    current = (current as Record<string, Json>)[part] as Json
    if (current === undefined) { throw new Error(`Unresolved local reference "${reference}"`) }
  }
  return current
}

function resolveJsonPointer(root: Json, pointer: string): Json {
  if (!pointer.startsWith('#/')) { throw new Error(`Expected local JSON pointer: ${pointer}`) }
  let current = root
  for (const rawPart of pointer.slice(2).split('/')) {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`Unresolved JSON pointer: ${pointer}`)
    }
    current = (current as Record<string, Json>)[part] as Json
    if (current === undefined) { throw new Error(`Unresolved JSON pointer: ${pointer}`) }
  }
  return current
}
