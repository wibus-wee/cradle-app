import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServerContractApp } from '../src/app'
import { normalizeConstSchemas } from './openapi-schema-normalizer'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const outputPath = resolve(scriptsDir, '..', 'openapi.json')

const app = await createServerContractApp()
const response = await app.handle(new Request('http://localhost/openapi.json'))

if (!response.ok) {
  throw new Error(`Failed to generate OpenAPI JSON (status ${response.status})`)
}

const document = await response.json()
normalizeConstSchemas(document)
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
