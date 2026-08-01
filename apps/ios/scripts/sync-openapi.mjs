#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const iosRoot = resolve(scriptDirectory, '..')
const repositoryRoot = resolve(iosRoot, '../..')
const destination = resolve(iosRoot, 'Packages/CradleAPI/Sources/CradleAPI/openapi.json')
const source = process.argv[2] ?? 'http://localhost:21423/openapi.json'

const document = await readDocument(source)
const paths = [
  '/health',
  '/workspaces',
  '/sessions/',
  '/sessions/{id}',
  '/issues/',
  '/issues/statuses',
  '/chat/sessions/{sessionId}/messages',
  '/chat/sessions/{sessionId}/response',
  '/chat/sessions/{sessionId}/cancel',
  '/chat/sessions/{sessionId}/runtime-status',
]

document.paths = Object.fromEntries(paths.flatMap(path => (
  document.paths[path] ? [[path, document.paths[path]]] : []
)))
normalizeNullableSchemas(document)
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, `${JSON.stringify(document, null, 2)}\n`)
console.log(`Wrote ${Object.keys(document.paths).length} Cradle operations to ${destination}`)

async function readDocument(locator) {
  if (/^https?:\/\//.test(locator)) {
    const response = await fetch(locator)
    if (!response.ok) { throw new Error(`OpenAPI download failed: HTTP ${response.status}`) }
    return await response.json()
  }

  const path = resolve(repositoryRoot, locator)
  return JSON.parse(await readFile(path, 'utf8'))
}

function normalizeNullableSchemas(value) {
  if (!value || typeof value !== 'object') { return }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    normalizeNullableSchemas(child)
  }
  if (Array.isArray(value.anyOf)) {
    const nullIndex = value.anyOf.findIndex(item => item?.type === 'null')
    if (nullIndex >= 0) {
      const schemas = value.anyOf.filter((_, index) => index !== nullIndex)
      value.nullable = true
      if (schemas.length === 1) {
        delete value.anyOf
        Object.assign(value, schemas[0])
      }
      else {
        value.anyOf = schemas
      }
    }
  }
}
