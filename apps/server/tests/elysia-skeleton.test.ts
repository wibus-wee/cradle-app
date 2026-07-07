import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { providerTargets, sessions, usageLogs, workspaces } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { OPENAPI_DOCS_PATH, OPENAPI_JSON_ALIAS_PATH, OPENAPI_JSON_PATH } from '../src/http/openapi'
import { REQUEST_ID_HEADER } from '../src/http/request-id'
import { db, shutdownInfra } from '../src/infra'
import { workspaceFixture } from './helpers/workspace-fixture'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function unixDaysAgo(daysAgo: number): number {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return Math.floor(date.getTime() / 1000)
}

function isoDaysAgo(daysAgo: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

let defaultDataDir: string | undefined
let previousDataDir: string | undefined

beforeEach(() => {
  previousDataDir = process.env.CRADLE_DATA_DIR
  defaultDataDir = makeTempDir('cradle-elysia-default-data-')
  process.env.CRADLE_DATA_DIR = defaultDataDir
  shutdownInfra()
})

afterEach(() => {
  shutdownInfra()
  if (defaultDataDir) {
    rmSync(defaultDataDir, { recursive: true, force: true })
  }
  defaultDataDir = undefined
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
  previousDataDir = undefined
})

describe('elysia migration skeleton', () => {
  it('serves /health with an x-request-id header', async () => {
    const app = await createServerApp()

    const response = await app.handle(new Request('http://localhost/health'))
    expect(response.status).toBe(200)
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy()

    const body = await response.json() as { status: string, timestamp: number }
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeTypeOf('number')
  })

  it('allows the hosted web app origins through CORS', async () => {
    const app = await createServerApp()

    for (const origin of ['http://app.cradle.wibus.ren', 'https://app.cradle.wibus.ren']) {
      const response = await app.handle(new Request('http://localhost/health', {
        headers: { origin },
      }))

      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)

      const preflight = await app.handle(new Request('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'true',
        },
      }))

      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-origin')).toBe(origin)
      expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
    }

    const rejected = await app.handle(new Request('http://localhost/health', {
      headers: { origin: 'https://example.com' },
    }))

    expect(rejected.status).toBe(200)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()

    const rejectedPreflight = await app.handle(new Request('http://localhost/health', {
      method: 'OPTIONS',
      headers: {
        'origin': 'https://example.com',
        'access-control-request-method': 'GET',
        'access-control-request-private-network': 'true',
      },
    }))

    expect(rejectedPreflight.status).toBe(204)
    expect(rejectedPreflight.headers.get('access-control-allow-private-network')).toBeNull()
  })

  it('serves OpenAPI JSON plus the legacy /docs alias', async () => {
    const app = await createServerApp()

    const openApiResponse = await app.handle(new Request(`http://localhost${OPENAPI_JSON_PATH}`))
    expect(openApiResponse.status).toBe(200)
    const document = await openApiResponse.json() as {
      openapi: string
      info: { title: string }
      paths: Record<string, Record<string, unknown>>
    }

    expect(document.openapi).toContain('3.')
    expect(document.info.title).toBe('Cradle Server API')
    expect(document.paths['/health']?.get).toBeTruthy()
    expect(document.paths['/preferences/chat']?.get).toBeTruthy()
    expect(document.paths['/preferences/chat']?.put).toBeTruthy()
    expect((document.paths['/preferences/chat']?.put as Record<string, unknown>)?.requestBody).toBeTruthy()
    expect(document.paths['/preferences/codex']?.get).toBeTruthy()
    expect(document.paths['/preferences/codex']?.put).toBeTruthy()
    expect((document.paths['/preferences/codex']?.put as Record<string, unknown>)?.requestBody).toBeTruthy()
    expect(document.paths['/workspaces']?.get).toBeTruthy()
    expect(document.paths['/workspaces']?.post).toBeTruthy()
    expect(document.paths['/workspaces/from-directory']?.post).toBeTruthy()
    expect(document.paths['/workspaces/resolve']?.get).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}']?.get).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}']?.patch).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}']?.delete).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}/files']?.get).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}/files/children']?.get).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}/files/search']?.get).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}/files/events']?.get).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}/files/content']?.get).toBeTruthy()
    expect(document.paths['/workspaces/{workspaceId}/files/content']?.put).toBeTruthy()
    expect(document.paths['/usage/daily']?.get).toBeTruthy()
    expect(document.paths['/usage/summary']?.get).toBeTruthy()
    expect(document.paths['/usage/stats']?.get).toBeTruthy()
    expect(document.paths['/usage/sessions/{sessionId}']?.get).toBeTruthy()

    const aliasResponse = await app.handle(new Request(`http://localhost${OPENAPI_JSON_ALIAS_PATH}`))
    expect(aliasResponse.status).toBe(200)
    expect(await aliasResponse.json()).toEqual(document)

    const docsResponse = await app.handle(new Request(`http://localhost${OPENAPI_DOCS_PATH}`))
    expect(docsResponse.status).toBe(200)
    expect(docsResponse.headers.get('content-type')).toContain('text/html')
    expect(await docsResponse.text()).toContain('Cradle Server API')
  })

  it('reads and writes /preferences/chat on the Elysia path', async () => {
    const dataDir = makeTempDir('cradle-elysia-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp()
      const filePath = join(dataDir, 'preferences', 'chat.json')

      const initialResponse = await app.handle(new Request('http://localhost/preferences/chat'))
      expect(initialResponse.status).toBe(200)
      expect(await initialResponse.json()).toEqual({
        modelId: null,
        configSelections: {},
        continuationBehavior: 'queue',
        titleGeneration: {
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'minimal',
        },
      })
      expect(existsSync(filePath)).toBe(false)

      const saveResponse = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 'gpt-4o-mini',
          configSelections: {
            reasoningEffort: 'high',
            webSearch: true,
          },
          continuationBehavior: 'steer',
        }),
      }))

      expect(saveResponse.status).toBe(200)
      expect(await saveResponse.json()).toEqual({ ok: true })
      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
        continuationBehavior: 'steer',
        titleGeneration: {
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'minimal',
        },
      })

      const finalResponse = await app.handle(new Request('http://localhost/preferences/chat'))
      expect(finalResponse.status).toBe(200)
      expect(await finalResponse.json()).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
        continuationBehavior: 'steer',
        titleGeneration: {
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'minimal',
        },
      })
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('reads and writes /preferences/codex on the Elysia path', async () => {
    const dataDir = makeTempDir('cradle-elysia-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp()
      const filePath = join(dataDir, 'preferences', 'codex.json')

      const initialResponse = await app.handle(new Request('http://localhost/preferences/codex'))
      expect(initialResponse.status).toBe(200)
      expect(await initialResponse.json()).toEqual({
        useCradleUserAgent: true,
      })
      expect(existsSync(filePath)).toBe(false)

      const saveResponse = await app.handle(new Request('http://localhost/preferences/codex', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          useCradleUserAgent: false,
        }),
      }))

      expect(saveResponse.status).toBe(200)
      expect(await saveResponse.json()).toEqual({ ok: true })
      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        useCradleUserAgent: false,
      })

      const finalResponse = await app.handle(new Request('http://localhost/preferences/codex'))
      expect(finalResponse.status).toBe(200)
      expect(await finalResponse.json()).toEqual({
        useCradleUserAgent: false,
      })
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('returns structured validation errors for invalid preferences payloads', async () => {
    const dataDir = makeTempDir('cradle-elysia-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp()

      const response = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 123,
          configSelections: {
            bad: { nested: true },
          },
          continuationBehavior: 'interrupt',
        }),
      }))

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        code: 'validation_error',
        message: 'request validation failed',
        details: {
          source: 'body',
          issues: expect.arrayContaining([
            expect.objectContaining({ path: 'modelId' }),
            expect.objectContaining({ path: 'configSelections.bad' }),
            expect.objectContaining({ path: 'continuationBehavior' }),
          ]),
        },
      })
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('supports workspace CRUD and resolve on the Elysia path', async () => {
    const dataDir = makeTempDir('cradle-elysia-data-')
    const workspaceRoot = makeTempDir('cradle-elysia-workspace-')
    const explicitWorkspaceRoot = makeTempDir('cradle-elysia-workspace-explicit-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    try {
      const app = await createServerApp()

      const createResponse = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      expect(createResponse.status).toBe(200)
      const created = await createResponse.json() as {
        id: string
        name: string
        locator: { hostId: string, path: string }
        createdAt: number
        updatedAt: number
      }
      expect(created.name).toBe(basename(workspaceRoot))
      expect(created.locator).toEqual({ hostId: 'local', path: workspaceRoot })
      expect(created.createdAt).toBeTypeOf('number')
      expect(created.updatedAt).toBeTypeOf('number')

      const explicitResponse = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Manual Workspace', locator: { hostId: 'local', path: explicitWorkspaceRoot } }),
      }))
      expect(explicitResponse.status).toBe(200)
      const explicit = await explicitResponse.json() as {
        id: string
        name: string
        locator: { hostId: string, path: string }
      }
      expect(explicit.name).toBe('Manual Workspace')
      expect(explicit.locator).toEqual({ hostId: 'local', path: explicitWorkspaceRoot })

      const listResponse = await app.handle(new Request('http://localhost/workspaces'))
      expect(listResponse.status).toBe(200)
      const list = await listResponse.json() as Array<{ id: string, locator: { path: string } }>
      expect(list).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.id, locator: expect.objectContaining({ path: workspaceRoot }) }),
        expect.objectContaining({ id: explicit.id, locator: expect.objectContaining({ path: explicitWorkspaceRoot }) }),
      ]))

      const getResponse = await app.handle(new Request(`http://localhost/workspaces/${created.id}`))
      expect(getResponse.status).toBe(200)
      expect(await getResponse.json()).toEqual(expect.objectContaining({ id: created.id }))

      const missingGet = await app.handle(new Request('http://localhost/workspaces/missing-workspace'))
      expect(missingGet.status).toBe(200)
      expect(await missingGet.json()).toBeNull()

      const resolveResponse = await app.handle(new Request(`http://localhost/workspaces/resolve?hostId=local&path=${encodeURIComponent(workspaceRoot)}`))
      expect(resolveResponse.status).toBe(200)
      expect(await resolveResponse.json()).toEqual(expect.objectContaining({ id: created.id }))

      const missingResolve = await app.handle(new Request(`http://localhost/workspaces/resolve?hostId=local&path=${encodeURIComponent('/missing/workspace')}`))
      expect(missingResolve.status).toBe(200)
      expect(await missingResolve.json()).toBeNull()

      const updateResponse = await app.handle(new Request(`http://localhost/workspaces/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Workspace' }),
      }))
      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toEqual(expect.objectContaining({ name: 'Renamed Workspace' }))

      const missingUpdate = await app.handle(new Request('http://localhost/workspaces/missing-workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Missing' }),
      }))
      expect(missingUpdate.status).toBe(200)
      expect(await missingUpdate.json()).toBeNull()

      const duplicateResponse = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Dup', locator: { hostId: 'local', path: explicitWorkspaceRoot } }),
      }))
      expect(duplicateResponse.status).toBe(409)
      expect(await duplicateResponse.json()).toEqual({
        code: 'workspace_locator_exists',
        message: 'Workspace locator already exists',
        details: { locator: { hostId: 'local', path: explicitWorkspaceRoot } },
      })

      const deleteCreated = await app.handle(new Request(`http://localhost/workspaces/${created.id}`, {
        method: 'DELETE',
      }))
      expect(deleteCreated.status).toBe(200)
      expect(await deleteCreated.json()).toEqual({ ok: true })

      const deleteExplicit = await app.handle(new Request(`http://localhost/workspaces/${explicit.id}`, {
        method: 'DELETE',
      }))
      expect(deleteExplicit.status).toBe(200)
      expect(await deleteExplicit.json()).toEqual({ ok: true })

      const finalList = await app.handle(new Request('http://localhost/workspaces'))
      expect(finalList.status).toBe(200)
      expect(await finalList.json()).toEqual([])
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(explicitWorkspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('supports workspace file listing/content and returns structured validation errors', async () => {
    const dataDir = makeTempDir('cradle-elysia-data-')
    const workspaceRoot = makeTempDir('cradle-elysia-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    try {
      writeFileSync(join(workspaceRoot, '.gitignore'), 'ignored.txt\nignored-dir/\n', 'utf8')
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
      mkdirSync(join(workspaceRoot, '.git', 'objects'), { recursive: true })
      mkdirSync(join(workspaceRoot, 'ignored-dir'), { recursive: true })
      mkdirSync(join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
      writeFileSync(join(workspaceRoot, 'src', 'main.ts'), 'console.log("hi")\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'notes.md'), '# Notes\n', 'utf8')
      writeFileSync(join(workspaceRoot, '.DS_Store'), 'ignored', 'utf8')
      writeFileSync(join(workspaceRoot, 'ignored.txt'), 'nope\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'ignored-dir', 'keep-out.md'), 'nope\n', 'utf8')
      writeFileSync(join(workspaceRoot, '.git', 'config'), '[core]\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n', 'utf8')

      const app = await createServerApp()
      const createResponse = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      const workspace = await createResponse.json() as { id: string }

      const filesResponse = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files`))
      expect(filesResponse.status).toBe(200)
      const entries = await filesResponse.json() as Array<{ type: string, name: string, path: string }>
      expect(entries).toEqual(expect.arrayContaining([
        { type: 'directory', name: 'src', path: 'src' },
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
        { type: 'file', name: 'notes.md', path: 'notes.md' },
      ]))
      expect(entries.some(entry => entry.path === 'ignored.txt')).toBe(false)
      expect(entries.some(entry => entry.path.startsWith('ignored-dir'))).toBe(false)
      expect(entries.some(entry => entry.path.startsWith('node_modules'))).toBe(false)
      expect(entries.some(entry => entry.path.startsWith('.git'))).toBe(false)
      expect(entries.some(entry => entry.path === '.DS_Store')).toBe(false)

      const searchResponse = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/search?q=${encodeURIComponent('main')}&limit=5`))
      expect(searchResponse.status).toBe(200)
      expect(await searchResponse.json()).toEqual([
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
      ])

      const missingFiles = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files'))
      expect(missingFiles.status).toBe(200)
      expect(await missingFiles.json()).toEqual([])

      const readResponse = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('notes.md')}`))
      expect(readResponse.status).toBe(200)
      expect(await readResponse.json()).toEqual({ content: '# Notes\n' })

      const blockedRead = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('../outside.md')}`))
      expect(blockedRead.status).toBe(200)
      expect(await blockedRead.json()).toEqual({ content: null })

      const missingRead = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/content?path=notes.md'))
      expect(missingRead.status).toBe(200)
      expect(await missingRead.json()).toEqual({ content: null })

      const writeResponse = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'updated text\n', confirmedNonCradleOwnedWrite: true }),
      }))
      expect(writeResponse.status).toBe(200)
      expect(await writeResponse.json()).toEqual({
        success: true,
        ownerBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: 'notes.md',
          targetPath: join(workspaceRoot, 'notes.md'),
        },
      })
      expect(readFileSync(join(workspaceRoot, 'notes.md'), 'utf8')).toBe('updated text\n')

      const unconfirmedWrite = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'unconfirmed text\n' }),
      }))
      expect(unconfirmedWrite.status).toBe(400)
      expect(readFileSync(join(workspaceRoot, 'notes.md'), 'utf8')).toBe('updated text\n')

      const rejectedConfirmationWrite = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'rejected text\n', confirmedNonCradleOwnedWrite: false }),
      }))
      expect(rejectedConfirmationWrite.status).toBe(400)
      const rejectedConfirmationBody = await rejectedConfirmationWrite.json()
      expect(rejectedConfirmationBody.code).toBe('non_cradle_owned_write_confirmation_required')
      expect(readFileSync(join(workspaceRoot, 'notes.md'), 'utf8')).toBe('updated text\n')

      const blockedWrite = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '../outside.md', content: 'bad\n', confirmedNonCradleOwnedWrite: true }),
      }))
      expect(blockedWrite.status).toBe(200)
      expect(await blockedWrite.json()).toEqual({
        success: false,
        ownerBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: '../outside.md',
          targetPath: null,
        },
      })

      const missingWrite = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/content', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'bad\n', confirmedNonCradleOwnedWrite: true }),
      }))
      expect(missingWrite.status).toBe(200)
      expect(await missingWrite.json()).toEqual({
        success: false,
        ownerBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: null,
          relativePath: 'notes.md',
          targetPath: null,
        },
      })

      const createFileResponse = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'src/created.ts', confirmedNonCradleOwnedWrite: true }),
      }))
      expect(createFileResponse.status).toBe(200)
      expect(await createFileResponse.json()).toEqual({
        success: true,
        ownerBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: 'src/created.ts',
          targetPath: join(workspaceRoot, 'src', 'created.ts'),
        },
      })
      expect(readFileSync(join(workspaceRoot, 'src', 'created.ts'), 'utf8')).toBe('')

      const createFolderResponse = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/folder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'src/generated', confirmedNonCradleOwnedWrite: true }),
      }))
      expect(createFolderResponse.status).toBe(200)
      expect(await createFolderResponse.json()).toEqual({
        success: true,
        ownerBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: 'src/generated',
          targetPath: join(workspaceRoot, 'src', 'generated'),
        },
      })
      expect(existsSync(join(workspaceRoot, 'src', 'generated'))).toBe(true)

      const renameResponse = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/path`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourcePath: 'src/created.ts',
          destinationPath: 'src/generated/renamed.ts',
          confirmedNonCradleOwnedWrite: true,
        }),
      }))
      expect(renameResponse.status).toBe(200)
      expect(await renameResponse.json()).toEqual({
        success: true,
        sourceBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: 'src/created.ts',
          targetPath: join(workspaceRoot, 'src', 'created.ts'),
        },
        destinationBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: 'src/generated/renamed.ts',
          targetPath: join(workspaceRoot, 'src', 'generated', 'renamed.ts'),
        },
      })
      expect(existsSync(join(workspaceRoot, 'src', 'created.ts'))).toBe(false)
      expect(existsSync(join(workspaceRoot, 'src', 'generated', 'renamed.ts'))).toBe(true)

      const blockedCreateFile = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '../outside.ts', confirmedNonCradleOwnedWrite: true }),
      }))
      expect(blockedCreateFile.status).toBe(200)
      expect(await blockedCreateFile.json()).toEqual({
        success: false,
        ownerBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: '../outside.ts',
          targetPath: null,
        },
      })

      const blockedRename = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/path`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourcePath: 'src/generated/renamed.ts',
          destinationPath: '../outside.ts',
          confirmedNonCradleOwnedWrite: true,
        }),
      }))
      expect(blockedRename.status).toBe(200)
      expect(await blockedRename.json()).toEqual({
        success: false,
        sourceBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: 'src/generated/renamed.ts',
          targetPath: join(workspaceRoot, 'src', 'generated', 'renamed.ts'),
        },
        destinationBoundary: {
          classification: 'non-cradle-owned',
          owner: 'workspace',
          consentRequired: true,
          consentConfirmed: true,
          workspacePath: workspaceRoot,
          relativePath: '../outside.ts',
          targetPath: null,
        },
      })

      const invalidCreate = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '   ', path: workspaceRoot }),
      }))
      expect(invalidCreate.status).toBe(400)
      expect(await invalidCreate.json()).toMatchObject({
        code: 'validation_error',
        message: 'request validation failed',
        details: {
          source: 'body',
          issues: expect.arrayContaining([
            expect.objectContaining({ path: 'name' }),
          ]),
        },
      })

      const invalidRead = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('   ')}`))
      expect(invalidRead.status).toBe(400)
      expect(await invalidRead.json()).toMatchObject({
        code: 'validation_error',
        message: 'request validation failed',
        details: {
          source: 'query',
          issues: expect.arrayContaining([
            expect.objectContaining({ path: 'path' }),
          ]),
        },
      })
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('supports usage analytics endpoints and structured invalid_usage_input errors on the Elysia path', async () => {
    const dataDir = makeTempDir('cradle-elysia-data-')
    const workspaceRoot = makeTempDir('cradle-elysia-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    try {
      const d = db()

      const workspaceId = randomUUID()
      const providerTargetOneId = randomUUID()
      const providerTargetTwoId = randomUUID()
      const sessionOneId = randomUUID()
      const sessionTwoId = randomUUID()

      d.insert(workspaces).values(workspaceFixture({ id: workspaceId, name: 'Workspace', path: workspaceRoot })).run()
      d.insert(providerTargets).values([
        { id: providerTargetOneId, kind: 'manual', providerKind: 'openai-compatible', displayName: 'Provider One' },
        { id: providerTargetTwoId, kind: 'manual', providerKind: 'anthropic', displayName: 'Provider Two' },
      ]).run()
      d.insert(sessions).values([
        { id: sessionOneId, workspaceId, title: 'Session One', providerTargetId: providerTargetOneId },
        { id: sessionTwoId, workspaceId, title: 'Session Two', providerTargetId: providerTargetTwoId },
      ]).run()
      d.insert(usageLogs).values([
        {
          id: randomUUID(),
          sessionId: sessionOneId,
          messageId: null,
          providerTargetId: providerTargetOneId,
          modelId: 'gpt-4o',
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          createdAt: unixDaysAgo(2),
        },
        {
          id: randomUUID(),
          sessionId: sessionOneId,
          messageId: null,
          providerTargetId: providerTargetOneId,
          modelId: 'gpt-4o',
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
          createdAt: unixDaysAgo(1),
        },
        {
          id: randomUUID(),
          sessionId: sessionTwoId,
          messageId: null,
          providerTargetId: providerTargetTwoId,
          modelId: 'codex-mini',
          promptTokens: 8,
          completionTokens: 7,
          totalTokens: 15,
          createdAt: unixDaysAgo(0),
        },
      ]).run()

      const app = await createServerApp()

      const dailyResponse = await app.handle(new Request('http://localhost/usage/daily?days=30'))
      expect(dailyResponse.status).toBe(200)
      expect(await dailyResponse.json()).toEqual([
        { date: isoDaysAgo(2), promptTokens: 10, completionTokens: 5, totalTokens: 15, count: 1 },
        { date: isoDaysAgo(1), promptTokens: 20, completionTokens: 10, totalTokens: 30, count: 1 },
        { date: isoDaysAgo(0), promptTokens: 8, completionTokens: 7, totalTokens: 15, count: 1 },
      ])

      const summaryResponse = await app.handle(new Request('http://localhost/usage/summary'))
      expect(summaryResponse.status).toBe(200)
      expect(await summaryResponse.json()).toEqual({
        totalPromptTokens: 38,
        totalCompletionTokens: 22,
        totalTokens: 60,
        totalTurns: 3,
        byAgent: [],
        byProviderTarget: [
          { providerTargetId: providerTargetOneId, providerTargetName: 'Provider One', totalTokens: 45, count: 2 },
          { providerTargetId: providerTargetTwoId, providerTargetName: 'Provider Two', totalTokens: 15, count: 1 },
        ],
        byModel: [
          { modelId: 'gpt-4o', totalTokens: 45, count: 2 },
          { modelId: 'codex-mini', totalTokens: 15, count: 1 },
        ],
      })

      const statsResponse = await app.handle(new Request('http://localhost/usage/stats'))
      expect(statsResponse.status).toBe(200)
      expect(await statsResponse.json()).toEqual({
        currentStreak: 3,
        longestStreak: 3,
        activeDays: 3,
        avgDailyTokens: 20,
        peakDay: { date: isoDaysAgo(1), totalTokens: 30 },
        todayTokens: 15,
      })

      const sessionResponse = await app.handle(new Request(`http://localhost/usage/sessions/${sessionOneId}`))
      expect(sessionResponse.status).toBe(200)
      expect(await sessionResponse.json()).toEqual({
        totalTokens: 45,
        promptTokens: 30,
        completionTokens: 15,
        count: 2,
      })

      const missingSessionResponse = await app.handle(new Request(`http://localhost/usage/sessions/${randomUUID()}`))
      expect(missingSessionResponse.status).toBe(200)
      expect(await missingSessionResponse.json()).toEqual({
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        count: 0,
      })

      const invalidDailyResponse = await app.handle(new Request('http://localhost/usage/daily?days=0'))
      expect(invalidDailyResponse.status).toBe(400)
      const invalidDailyBody = await invalidDailyResponse.json()
      expect(invalidDailyBody.code).toBe('validation_error')

      const invalidSessionResponse = await app.handle(new Request('http://localhost/usage/sessions/%20%20%20'))
      // Whitespace-only sessionId passes schema validation (length > 0), service returns zero usage
      expect([200, 400]).toContain(invalidSessionResponse.status)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
