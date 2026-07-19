import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('workspace capability', () => {
  it('supports CRUD and resolve by locator', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const explicitWorkspaceRoot = makeTempDir('cradle-workspace-explicit-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const createRes = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created.name).toBe(basename(workspaceRoot))
      expect(created.pinned).toBe(0)
      expect(created.createdAt).toBeTypeOf('number')
      expect(created.updatedAt).toBeTypeOf('number')

      // from-directory is idempotent so CLI `cradle open` can ensure-then-open.
      const reimportRes = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      expect(reimportRes.status).toBe(200)
      const reimported = await reimportRes.json()
      expect(reimported).toEqual(expect.objectContaining({ id: created.id, name: created.name }))

      const explicitRes = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Manual Workspace',
          locator: { hostId: 'local', path: explicitWorkspaceRoot },
        }),
      }))
      expect(explicitRes.status).toBe(200)
      const explicit = await explicitRes.json()
      expect(explicit.name).toBe('Manual Workspace')
      expect(explicit.pinned).toBe(0)
      expect(explicit.createdAt).toBeTypeOf('number')
      expect(explicit.updatedAt).toBeTypeOf('number')

      const pinRes = await app.handle(new Request(`http://localhost/workspaces/${explicit.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      }))
      expect(pinRes.status).toBe(200)
      const pinned = await pinRes.json()
      expect(pinned).toEqual(expect.objectContaining({ id: explicit.id, pinned: 1 }))

      const listRes = await app.handle(new Request('http://localhost/workspaces'))
      const list = await listRes.json()
      expect(list[0]).toEqual(expect.objectContaining({ id: explicit.id, pinned: 1 }))
      expect(list).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.id, locator: { hostId: 'local', path: workspaceRoot } }),
        expect.objectContaining({ id: explicit.id, locator: { hostId: 'local', path: explicitWorkspaceRoot } }),
      ]))

      const getRes = await app.handle(new Request(`http://localhost/workspaces/${created.id}`))
      const fetched = await getRes.json()
      expect(fetched).toEqual(expect.objectContaining({ id: created.id }))

      const missingGet = await app.handle(new Request('http://localhost/workspaces/missing-workspace'))
      expect(missingGet.status).toBe(200)
      expect(await missingGet.json()).toBeNull()

      const resolveRes = await app.handle(new Request(`http://localhost/workspaces/resolve?hostId=local&path=${encodeURIComponent(workspaceRoot)}`))
      const resolved = await resolveRes.json()
      expect(resolved).toEqual(expect.objectContaining({ id: created.id }))

      const updateRes = await app.handle(new Request(`http://localhost/workspaces/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Workspace' }),
      }))
      const updated = await updateRes.json()
      expect(updated).toEqual(expect.objectContaining({ name: 'Renamed Workspace' }))

      const unpinRes = await app.handle(new Request(`http://localhost/workspaces/${explicit.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: false }),
      }))
      expect(unpinRes.status).toBe(200)
      const unpinned = await unpinRes.json()
      expect(unpinned).toEqual(expect.objectContaining({ id: explicit.id, pinned: 0 }))

      const missingUpdate = await app.handle(new Request('http://localhost/workspaces/missing-workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Missing' }),
      }))
      expect(missingUpdate.status).toBe(200)
      expect(await missingUpdate.json()).toBeNull()

      const invalidPatchRes = await app.handle(new Request(`http://localhost/workspaces/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(invalidPatchRes.status).toBe(400)
      const invalidPatchBody = await invalidPatchRes.json()
      expect(invalidPatchBody.code).toBe('invalid_workspace_input')

      const duplicateRes = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Dup',
          locator: { hostId: 'local', path: explicitWorkspaceRoot },
        }),
      }))
      expect(duplicateRes.status).toBe(409)
      const duplicateBody = await duplicateRes.json()
      expect(duplicateBody.code).toBe('workspace_locator_exists')

      const invalidRes = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }))
      expect(invalidRes.status).toBe(400)
      const invalidBody = await invalidRes.json()
      expect(invalidBody.code).toBe('validation_error')

      const invalidFromDirectory = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '' }),
      }))
      expect(invalidFromDirectory.status).toBe(400)

      const missingResolve = await app.handle(new Request('http://localhost/workspaces/resolve'))
      expect(missingResolve.status).toBe(400)

      const deleteRes = await app.handle(new Request(`http://localhost/workspaces/${created.id}`, { method: 'DELETE' }))
      expect(deleteRes.status).toBe(200)
      const deleteBody = await deleteRes.json()
      expect(deleteBody).toEqual({ ok: true })

      const deleteExplicit = await app.handle(new Request(`http://localhost/workspaces/${explicit.id}`, { method: 'DELETE' }))
      expect(deleteExplicit.status).toBe(200)
      const deleteExplicitBody = await deleteExplicit.json()
      expect(deleteExplicitBody).toEqual({ ok: true })

      const afterList = await (await app.handle(new Request('http://localhost/workspaces'))).json()
      expect(afterList).toEqual([])
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
  it('lists files and enforces safe text IO', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const linkedRoot = makeTempDir('cradle-linked-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      writeFileSync(join(workspaceRoot, '.gitignore'), 'ignored.txt\nignored-dir/\n', 'utf8')
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
      mkdirSync(join(workspaceRoot, 'empty-dir'), { recursive: true })
      mkdirSync(join(workspaceRoot, '.git', 'objects'), { recursive: true })
      mkdirSync(join(workspaceRoot, 'ignored-dir'), { recursive: true })
      mkdirSync(join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
      mkdirSync(join(linkedRoot, 'lib'), { recursive: true })
      writeFileSync(join(workspaceRoot, 'src', 'main.ts'), 'console.log("hi")\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'notes.md'), '# Notes\n', 'utf8')
      writeFileSync(join(workspaceRoot, '.DS_Store'), 'ignored', 'utf8')
      writeFileSync(join(workspaceRoot, 'ignored.txt'), 'nope\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'ignored-dir', 'keep-out.md'), 'nope\n', 'utf8')
      writeFileSync(join(workspaceRoot, '.git', 'config'), '[core]\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n', 'utf8')
      writeFileSync(join(linkedRoot, 'lib', 'linked-main.ts'), 'export const linked = true\n', 'utf8')
      writeFileSync(join(linkedRoot, 'README.md'), '# Linked\n', 'utf8')
      symlinkSync(linkedRoot, join(workspaceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')

      app = await createServerApp()
      const createRes = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      const workspace = await createRes.json()

      const filesRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files`))
      const entries = await filesRes.json()
      expect(entries).toEqual(expect.arrayContaining([
        { type: 'directory', name: 'empty-dir', path: 'empty-dir' },
        { type: 'directory', name: 'linked', path: 'linked' },
        { type: 'directory', name: 'lib', path: 'linked/lib' },
        { type: 'file', name: 'linked-main.ts', path: 'linked/lib/linked-main.ts' },
        { type: 'directory', name: 'src', path: 'src' },
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
        { type: 'file', name: 'notes.md', path: 'notes.md' },
      ]))
      expect(entries.some((entry: { path: string }) => entry.path === 'ignored.txt')).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path.startsWith('ignored-dir'))).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path.startsWith('node_modules'))).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path.startsWith('.git'))).toBe(false)
      expect(entries.some((entry: { path: string }) => entry.path === '.DS_Store')).toBe(false)

      const rootChildrenRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/children`))
      expect(rootChildrenRes.status).toBe(200)
      const rootChildren = await rootChildrenRes.json()
      expect(rootChildren).toEqual([
        { type: 'directory', name: 'empty-dir', path: 'empty-dir' },
        { type: 'directory', name: 'linked', path: 'linked' },
        { type: 'directory', name: 'src', path: 'src' },
        { type: 'file', name: 'notes.md', path: 'notes.md' },
      ])

      const srcChildrenRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/children?path=${encodeURIComponent('src')}`))
      expect(srcChildrenRes.status).toBe(200)
      expect(await srcChildrenRes.json()).toEqual([
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
      ])

      const linkedChildrenRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/children?path=${encodeURIComponent('linked')}`))
      expect(linkedChildrenRes.status).toBe(200)
      expect(await linkedChildrenRes.json()).toEqual([
        { type: 'directory', name: 'lib', path: 'linked/lib' },
        { type: 'file', name: 'README.md', path: 'linked/README.md' },
      ])

      const missingChildrenRes = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/children'))
      expect(missingChildrenRes.status).toBe(200)
      expect(await missingChildrenRes.json()).toEqual([])

      const searchRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/search?q=${encodeURIComponent('main')}&limit=5`))
      expect(searchRes.status).toBe(200)
      expect(await searchRes.json()).toEqual([
        { type: 'file', name: 'linked-main.ts', path: 'linked/lib/linked-main.ts' },
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
      ])

      const linkedSearchRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/search?q=${encodeURIComponent('linked-main')}&limit=5`))
      expect(linkedSearchRes.status).toBe(200)
      expect(await linkedSearchRes.json()).toEqual([
        { type: 'file', name: 'linked-main.ts', path: 'linked/lib/linked-main.ts' },
      ])

      const ignoredSearchRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/search?q=${encodeURIComponent('ignored')}&limit=5`))
      expect(ignoredSearchRes.status).toBe(200)
      expect(await ignoredSearchRes.json()).toEqual([])

      const completionRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/search?q=${encodeURIComponent('src/')}&limit=5`))
      expect(completionRes.status).toBe(200)
      expect(await completionRes.json()).toEqual([
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
      ])

      const missingSearchRes = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/search?q=main'))
      expect(missingSearchRes.status).toBe(200)
      expect(await missingSearchRes.json()).toEqual([])

      const eventsRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/events`))
      expect(eventsRes.status).toBe(200)
      expect(eventsRes.headers.get('content-type')).toContain('text/event-stream')
      await eventsRes.body?.cancel()

      const missingFiles = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files'))
      expect(await missingFiles.json()).toEqual([])

      const readRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('notes.md')}`))
      const readBody = await readRes.json()
      expect(readBody.content).toBe('# Notes\n')

      const linkedReadRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('linked/lib/linked-main.ts')}`))
      const linkedReadBody = await linkedReadRes.json()
      expect(linkedReadBody.content).toBe('export const linked = true\n')

      const blockedRead = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content?path=${encodeURIComponent('../outside.md')}`))
      const blockedReadBody = await blockedRead.json()
      expect(blockedReadBody.content).toBeNull()

      const missingRead = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/content?path=notes.md'))
      const missingReadBody = await missingRead.json()
      expect(missingReadBody.content).toBeNull()

      const writeRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'updated text\n', confirmedNonCradleOwnedWrite: true }),
      }))
      const writeBody = await writeRes.json()
      expect(writeBody.success).toBe(true)
      expect(writeBody.ownerBoundary).toEqual(expect.objectContaining({
        classification: 'non-cradle-owned',
        owner: 'workspace',
        consentRequired: true,
        consentConfirmed: true,
        workspacePath: workspaceRoot,
        relativePath: 'notes.md',
        targetPath: join(workspaceRoot, 'notes.md'),
      }))
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
      const blockedWriteBody = await blockedWrite.json()
      expect(blockedWriteBody.success).toBe(false)
      expect(blockedWriteBody.ownerBoundary).toEqual(expect.objectContaining({
        classification: 'non-cradle-owned',
        owner: 'workspace',
        consentRequired: true,
        consentConfirmed: true,
        relativePath: '../outside.md',
        targetPath: null,
      }))

      const missingWrite = await app.handle(new Request('http://localhost/workspaces/missing-workspace/files/content', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'notes.md', content: 'bad\n', confirmedNonCradleOwnedWrite: true }),
      }))
      const missingWriteBody = await missingWrite.json()
      expect(missingWriteBody.success).toBe(false)
      expect(missingWriteBody.ownerBoundary).toEqual(expect.objectContaining({
        classification: 'non-cradle-owned',
        owner: 'workspace',
        consentRequired: true,
        consentConfirmed: true,
        workspacePath: null,
        relativePath: 'notes.md',
        targetPath: null,
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(linkedRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('creates multi-folder symlink workspaces behind the app feature flag', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const multiRoot = makeTempDir('cradle-multi-root-')
    const frontendRoot = makeTempDir('cradle-frontend-')
    const backendRoot = makeTempDir('cradle-backend-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousMultiRoot = process.env.CRADLE_MULTI_WORKSPACE_ROOT
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_MULTI_WORKSPACE_ROOT = multiRoot
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const disabledRes = await app.handle(new Request('http://localhost/workspaces/multi-folder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'my-monorepo',
          folders: [
            { name: 'frontend', path: frontendRoot },
          ],
        }),
      }))
      expect(disabledRes.status).toBe(403)
      expect((await disabledRes.json()).code).toBe('multi_workspace_poc_disabled')

      const prefsRes = await app.handle(new Request('http://localhost/preferences/app', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureFlags: {
            multiWorkspacePoc: true,
          },
        }),
      }))
      expect(prefsRes.status).toBe(200)

      const createRes = await app.handle(new Request('http://localhost/workspaces/multi-folder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'my-monorepo',
          folders: [
            { name: 'frontend', path: frontendRoot },
            { name: 'backend', path: backendRoot },
          ],
        }),
      }))
      expect(createRes.status).toBe(200)
      const workspace = await createRes.json()
      const workspacePath = join(multiRoot, 'my-monorepo')
      expect(workspace).toEqual(expect.objectContaining({
        name: 'my-monorepo',
        locator: { hostId: 'local', path: workspacePath },
      }))
      expect(JSON.parse(readFileSync(join(workspacePath, 'cradle-workspace.json'), 'utf8'))).toEqual({
        name: 'my-monorepo',
        folders: [
          { name: 'frontend', path: frontendRoot },
          { name: 'backend', path: backendRoot },
        ],
      })
      expect(readlinkSync(join(workspacePath, 'frontend'))).toBe(frontendRoot)
      expect(readlinkSync(join(workspacePath, 'backend'))).toBe(backendRoot)

      const listRes = await app.handle(new Request('http://localhost/workspaces'))
      expect(await listRes.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: workspace.id, locator: { hostId: 'local', path: workspacePath } }),
      ]))

      const collisionRes = await app.handle(new Request('http://localhost/workspaces/multi-folder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'colliding-folders',
          folders: [
            { name: 'app', path: frontendRoot },
            { name: 'app', path: backendRoot },
          ],
        }),
      }))
      expect(collisionRes.status).toBe(409)
      expect((await collisionRes.json()).code).toBe('multi_workspace_folder_name_collision')

      const importConfigPath = join(dataDir, 'imported-cradle-workspace.json')
      writeFileSync(importConfigPath, JSON.stringify({
        name: 'imported-monorepo',
        folders: [
          { name: 'frontend', path: frontendRoot },
        ],
      }), 'utf8')
      const importRes = await app.handle(new Request('http://localhost/workspaces/multi-folder/from-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: importConfigPath }),
      }))
      expect(importRes.status).toBe(200)
      const importedWorkspace = await importRes.json()
      expect(importedWorkspace).toEqual(expect.objectContaining({
        name: 'imported-monorepo',
        locator: { hostId: 'local', path: join(multiRoot, 'imported-monorepo') },
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(multiRoot, { recursive: true, force: true })
      rmSync(frontendRoot, { recursive: true, force: true })
      rmSync(backendRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousMultiRoot === undefined) {
        delete process.env.CRADLE_MULTI_WORKSPACE_ROOT
      }
      else {
        process.env.CRADLE_MULTI_WORKSPACE_ROOT = previousMultiRoot
      }
    }
  })

  it('recognizes cradle-workspace.json via inspect-directory without creating anything', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const multiRoot = makeTempDir('cradle-multi-root-')
    const frontendRoot = makeTempDir('cradle-frontend-')
    const backendRoot = makeTempDir('cradle-backend-')
    const plainRoot = makeTempDir('cradle-plain-')
    const configRoot = makeTempDir('cradle-config-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousMultiRoot = process.env.CRADLE_MULTI_WORKSPACE_ROOT
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_MULTI_WORKSPACE_ROOT = multiRoot
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      writeFileSync(join(configRoot, 'cradle-workspace.json'), JSON.stringify({
        name: 'recognized-monorepo',
        folders: [
          { name: 'frontend', path: frontendRoot },
          { name: 'backend', path: backendRoot },
        ],
      }), 'utf8')

      app = await createServerApp()

      // Plain directory: nothing detected, single-folder recommended.
      const plainRes = await app.handle(new Request('http://localhost/workspaces/inspect-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: plainRoot }),
      }))
      expect(plainRes.status).toBe(200)
      const plain = await plainRes.json()
      expect(plain).toEqual(expect.objectContaining({
        cradleWorkspaceDetected: false,
        config: null,
        configValid: false,
        configError: null,
        featureFlagEnabled: false,
        alreadyImported: false,
        recommendedAction: 'single-folder',
      }))

      // Config detected + valid, but flag off → recognized, yet single-folder recommended.
      const flagOffRes = await app.handle(new Request('http://localhost/workspaces/inspect-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: configRoot }),
      }))
      expect(flagOffRes.status).toBe(200)
      const flagOff = await flagOffRes.json()
      expect(flagOff).toEqual(expect.objectContaining({
        cradleWorkspaceDetected: true,
        configValid: true,
        configError: null,
        featureFlagEnabled: false,
        alreadyImported: false,
        recommendedAction: 'single-folder',
      }))
      expect(flagOff.config).toEqual(expect.objectContaining({ name: 'recognized-monorepo' }))
      // Nothing was created by the probe.
      const listAfterProbe = await (await app.handle(new Request('http://localhost/workspaces'))).json()
      expect(listAfterProbe).toEqual([])

      // Enable the flag → now multi-folder is recommended.
      await app.handle(new Request('http://localhost/preferences/app', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ featureFlags: { multiWorkspacePoc: true } }),
      }))
      const flagOnRes = await app.handle(new Request('http://localhost/workspaces/inspect-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: configRoot }),
      }))
      const flagOn = await flagOnRes.json()
      expect(flagOn).toEqual(expect.objectContaining({
        cradleWorkspaceDetected: true,
        configValid: true,
        featureFlagEnabled: true,
        recommendedAction: 'multi-folder',
      }))
      // Still nothing created — inspect is read-only.
      const listAfterFlagOnProbe = await (await app.handle(new Request('http://localhost/workspaces'))).json()
      expect(listAfterFlagOnProbe).toEqual([])

      // Invalid config is reported, not thrown.
      writeFileSync(join(configRoot, 'cradle-workspace.json'), '{ not valid json', 'utf8')
      const invalidRes = await app.handle(new Request('http://localhost/workspaces/inspect-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: configRoot }),
      }))
      expect(invalidRes.status).toBe(200)
      const invalid = await invalidRes.json()
      expect(invalid).toEqual(expect.objectContaining({
        cradleWorkspaceDetected: true,
        configValid: false,
        config: null,
        recommendedAction: 'single-folder',
      }))
      expect(invalid.configError).toBeTruthy()
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(multiRoot, { recursive: true, force: true })
      rmSync(frontendRoot, { recursive: true, force: true })
      rmSync(backendRoot, { recursive: true, force: true })
      rmSync(plainRoot, { recursive: true, force: true })
      rmSync(configRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousMultiRoot === undefined) {
        delete process.env.CRADLE_MULTI_WORKSPACE_ROOT
      }
      else {
        process.env.CRADLE_MULTI_WORKSPACE_ROOT = previousMultiRoot
      }
    }
  })

  it('bounds workspace file listing scans for large repositories', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-large-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      for (let index = 0; index < 5_100; index += 1) {
        writeFileSync(join(workspaceRoot, `file-${String(index).padStart(4, '0')}.txt`), 'content\n', 'utf8')
      }
      mkdirSync(join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
      writeFileSync(join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n', 'utf8')

      app = await createServerApp()
      const createRes = await app.handle(new Request('http://localhost/workspaces/from-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspaceRoot }),
      }))
      const workspace = await createRes.json()

      const filesRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files`))
      expect(filesRes.status).toBe(200)
      const entries = await filesRes.json() as Array<{ path: string }>

      expect(entries).toHaveLength(5_000)
      expect(entries.some(entry => entry.path.startsWith('node_modules'))).toBe(false)
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
  }, 15_000)
})
