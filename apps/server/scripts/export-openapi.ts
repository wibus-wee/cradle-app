import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServerContractApp } from '../src/app'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const outputPath = resolve(scriptsDir, '..', 'openapi.json')

const app = await createServerContractApp()
const response = await app.handle(new Request('http://localhost/openapi.json'))

if (!response.ok) {
  throw new Error(`Failed to generate OpenAPI JSON (status ${response.status})`)
}

const document = await response.json()
normalizeConstUnionSchemas(document)
normalizeNullableSchemas(document)
await writeFile(outputPath, JSON.stringify(document, null, 2))

function normalizeNullableSchemas(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      normalizeNullableSchemas(item)
    }
    return
  }

  const record = value as Record<string, unknown>
  for (const child of Object.values(record)) {
    normalizeNullableSchemas(child)
  }

  const anyOf = record.anyOf
  if (!Array.isArray(anyOf) || anyOf.length !== 2) {
    return
  }

  const nullIndex = anyOf.findIndex(isNullSchema)
  if (nullIndex === -1) {
    return
  }
  const schema = anyOf[nullIndex === 0 ? 1 : 0]
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return
  }

  delete record.anyOf
  Object.assign(record, schema, { nullable: true })
  if (Array.isArray(record.enum) && !record.enum.includes(null)) {
    record.enum = [...record.enum, null]
  }
}

function isNullSchema(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).type === 'null'
}

function normalizeConstUnionSchemas(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      normalizeConstUnionSchemas(item)
    }
    return
  }

  const record = value as Record<string, unknown>
  for (const child of Object.values(record)) {
    normalizeConstUnionSchemas(child)
  }

  const anyOf = record.anyOf
  if (!Array.isArray(anyOf) || anyOf.length === 0) {
    return
  }
  const enumValues: string[] = []
  let nullable = record.nullable === true
  for (const schema of anyOf) {
    if (isNullSchema(schema)) {
      nullable = true
      continue
    }
    const enumValue = getStringConstSchemaValue(schema)
    if (enumValue === null) {
      return
    }
    enumValues.push(enumValue)
  }

  if (enumValues.length === 0) {
    return
  }

  delete record.anyOf
  record.type = 'string'
  record.enum = nullable ? [...new Set(enumValues), null] : [...new Set(enumValues)]
  if (nullable) {
    record.nullable = true
  }
}

function getStringConstSchemaValue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (record.type !== undefined && record.type !== 'string') {
    return null
  }

  return typeof record.const === 'string' ? record.const : null
}
