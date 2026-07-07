import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import type { SkillInventoryEntry } from '../src/modules/skills/skills.store'
import { workspaceFixture } from './helpers/workspace-fixture'

interface DiscoveredSkill {
  name: string
  description: string
  skillDir: string
  relativePath: string
}

interface FetchSourceResponse {
  sessionId: string
  source: { type: string, url: string, label: string, ref?: string, subpath?: string }
  skills: DiscoveredSkill[]
}

interface ImportFromFetchResponse {
  imported: Array<{ name: string }>
  errors: Array<{ dir: string, error: string }>
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeSkillPackage(rootDir: string, dirName: string, name: string, description: string, body: string): string {
  const skillDir = join(rootDir, dirName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, 'utf8')
  return skillDir
}

describe('skills capability', () => {
  it('supports precedence-aware inventory, CRUD, export, and fetch import flows', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const homeDir = makeTempDir('cradle-home-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const fetchSourceRoot = makeTempDir('cradle-skills-source-')
    const exportRoot = makeTempDir('cradle-skills-export-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = homeDir

    writeSkillPackage(join(homeDir, '.agents', 'skills'), 'legacy-skill', 'legacy-skill', 'Legacy skill', 'legacy body')
    writeSkillPackage(join(workspaceRoot, '.agents', 'skills'), 'repository-skill', 'repository-skill', 'Repository skill', 'repository body')
    writeSkillPackage(join(workspaceRoot, '.agents', 'skills'), 'shared-skill', 'shared-skill', 'Repository shared skill', 'repository shared body')
    writeSkillPackage(fetchSourceRoot, 'alpha-fetch', 'alpha-fetch', 'Alpha fetched skill', 'alpha body')
    writeSkillPackage(join(fetchSourceRoot, 'nested'), 'bravo-fetch', 'bravo-fetch', 'Bravo fetched skill', 'bravo body')

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values(workspaceFixture({
        id: 'workspace-1',
        name: 'Workspace One',
        path: workspaceRoot,
      })).run()

      const createGlobal = await app.handle(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          name: 'shared-skill',
          description: 'Global skill',
          body: 'global body',
        }),
      }))
      expect(createGlobal.status).toBe(200)

      const createWorkspace = await app.handle(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'workspace',
          workspaceId: 'workspace-1',
          name: 'shared-skill',
          description: 'Workspace override',
          body: 'workspace body',
        }),
      }))
      expect(createWorkspace.status).toBe(200)

      const createAgent = await app.handle(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'agent',
          agentId: 'agent-007',
          name: 'agent-secret',
          description: 'Agent secret skill',
          body: 'agent body',
        }),
      }))
      expect(createAgent.status).toBe(200)

      const inventoryRes = await app.handle(new Request('http://localhost/skills?workspaceId=workspace-1&agentId=agent-007'))
      expect(inventoryRes.status).toBe(200)
      const inventory = await inventoryRes.json() as SkillInventoryEntry[]

      const globalEntry = inventory.find(entry => entry.scope === 'global' && entry.name === 'shared-skill')
      const workspaceEntry = inventory.find(entry => entry.scope === 'workspace' && entry.name === 'shared-skill')
      const repositoryEntry = inventory.find(entry => entry.scope === 'repository' && entry.name === 'shared-skill')
      const repositoryOnlyEntry = inventory.find(entry => entry.scope === 'repository' && entry.name === 'repository-skill')
      const agentEntry = inventory.find(entry => entry.scope === 'agent' && entry.name === 'agent-secret')
      const legacyEntry = inventory.find(entry => entry.scope === 'legacy' && entry.name === 'legacy-skill')

      expect(globalEntry).toEqual(expect.objectContaining({ active: false, shadowedBy: 'workspace' }))
      expect(repositoryEntry).toEqual(expect.objectContaining({ active: false, shadowedBy: 'workspace' }))
      expect(repositoryOnlyEntry).toEqual(expect.objectContaining({ active: true, shadowedBy: null }))
      expect(workspaceEntry).toEqual(expect.objectContaining({ active: true, shadowedBy: null }))
      expect(agentEntry).toEqual(expect.objectContaining({ active: true, shadowedBy: null }))
      expect(legacyEntry).toEqual(expect.objectContaining({ active: true }))
      expect(repositoryEntry?.rootDir).toBe(join(workspaceRoot, '.agents', 'skills'))
      expect(repositoryEntry?.skillDir).toBe(join(workspaceRoot, '.agents', 'skills', 'shared-skill'))
      expect(workspaceEntry?.rootDir).toBe(join(workspaceRoot, '.cradle', 'skills'))
      expect(workspaceEntry?.skillDir).toBe(join(workspaceRoot, '.cradle', 'skills', 'shared-skill'))
      expect(existsSync(join(workspaceRoot, '.agents', 'skills', 'repository-skill', 'SKILL.md'))).toBe(true)

      const getWorkspaceDoc = await app.handle(new Request('http://localhost/skills/document?scope=workspace&name=shared-skill&workspaceId=workspace-1'))
      expect(getWorkspaceDoc.status).toBe(200)
      expect(await getWorkspaceDoc.json()).toEqual(expect.objectContaining({
        name: 'shared-skill',
        description: 'Workspace override',
        body: 'workspace body',
        scope: 'workspace',
      }))

      const getRepositoryDoc = await app.handle(new Request('http://localhost/skills/document?scope=repository&name=repository-skill&workspaceId=workspace-1'))
      expect(getRepositoryDoc.status).toBe(200)
      expect(await getRepositoryDoc.json()).toEqual(expect.objectContaining({
        name: 'repository-skill',
        description: 'Repository skill',
        body: expect.stringContaining('repository body'),
        scope: 'repository',
      }))

      const updateWorkspace = await app.handle(new Request('http://localhost/skills/document', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'workspace',
          name: 'shared-skill',
          workspaceId: 'workspace-1',
          document: {
            name: 'workspace-tools',
            description: 'Workspace renamed',
            body: 'workspace body updated',
          },
        }),
      }))
      expect(updateWorkspace.status).toBe(200)
      const updatedWorkspace = await updateWorkspace.json() as SkillInventoryEntry
      expect(updatedWorkspace).toEqual(expect.objectContaining({
        name: 'workspace-tools',
        description: 'Workspace renamed',
        rootDir: join(workspaceRoot, '.cradle', 'skills'),
        skillDir: join(workspaceRoot, '.cradle', 'skills', 'workspace-tools'),
      }))
      expect(existsSync(join(workspaceRoot, '.agents', 'skills', 'shared-skill', 'SKILL.md'))).toBe(true)

      const rejectedExport = await app.handle(new Request('http://localhost/skills/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'agent',
          name: 'agent-secret',
          agentId: 'agent-007',
          destinationDir: exportRoot,
          confirmedNonCradleOwnedWrite: false,
        }),
      }))
      expect(rejectedExport.status).toBe(400)
      const rejectedExportBody = await rejectedExport.json() as { code: string, details?: { ownerBoundary?: { owner?: string } } }
      expect(rejectedExportBody.code).toBe('non_cradle_owned_write_confirmation_required')
      expect(rejectedExportBody.details?.ownerBoundary).toEqual(expect.objectContaining({
        owner: 'user-selected-export-directory',
      }))
      expect(existsSync(join(exportRoot, 'agent-secret'))).toBe(false)

      const exportAgent = await app.handle(new Request('http://localhost/skills/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'agent',
          name: 'agent-secret',
          agentId: 'agent-007',
          destinationDir: exportRoot,
          confirmedNonCradleOwnedWrite: true,
        }),
      }))
      expect(exportAgent.status).toBe(200)
      const exported = await exportAgent.json() as {
        destinationDir: string
        ownerBoundary: {
          classification: string
          owner: string
          consentRequired: boolean
          consentConfirmed: boolean
          destinationDir: string
          targetPath: string
        }
      }
      expect(exported.ownerBoundary).toEqual(expect.objectContaining({
        classification: 'non-cradle-owned',
        owner: 'user-selected-export-directory',
        consentRequired: true,
        consentConfirmed: true,
        destinationDir: exportRoot,
        targetPath: exported.destinationDir,
      }))
      expect(readFileSync(join(exported.destinationDir, 'SKILL.md'), 'utf8')).toContain('Agent secret skill')

      const fetchSource = await app.handle(new Request('http://localhost/skills/fetch-source', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: fetchSourceRoot }),
      }))
      expect(fetchSource.status).toBe(200)
      const fetched = await fetchSource.json() as FetchSourceResponse
      expect(fetched.source).toEqual(expect.objectContaining({
        type: 'local',
        url: fetchSourceRoot,
        label: fetchSourceRoot,
      }))
      expect(fetched.skills.map(skill => skill.name).sort()).toEqual(['alpha-fetch', 'bravo-fetch'])

      const importFetched = await app.handle(new Request('http://localhost/skills/import-from-fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: fetched.sessionId,
          scope: 'global',
          selectedDirs: fetched.skills.map(skill => skill.skillDir),
        }),
      }))
      expect(importFetched.status).toBe(200)
      const imported = await importFetched.json() as ImportFromFetchResponse
      expect(imported.imported.map(skill => skill.name).sort()).toEqual(['alpha-fetch', 'bravo-fetch'])
      expect(imported.errors).toEqual([])

      const inventoryAfterImport = await app.handle(new Request('http://localhost/skills?workspaceId=workspace-1&agentId=agent-007'))
      expect(inventoryAfterImport.status).toBe(200)
      const importedInventory = await inventoryAfterImport.json() as SkillInventoryEntry[]
      expect(importedInventory.some(entry => entry.scope === 'global' && entry.name === 'alpha-fetch' && entry.active)).toBe(true)
      expect(importedInventory.some(entry => entry.scope === 'global' && entry.name === 'bravo-fetch' && entry.active)).toBe(true)

      const deleteAgent = await app.handle(new Request('http://localhost/skills/document?scope=agent&name=agent-secret&agentId=agent-007', {
        method: 'DELETE',
      }))
      expect(deleteAgent.status).toBe(200)
      expect(await deleteAgent.json()).toEqual({ ok: true })

      const missingAgent = await app.handle(new Request('http://localhost/skills/document?scope=agent&name=agent-secret&agentId=agent-007'))
      expect(missingAgent.status).toBe(404)
      expect((await missingAgent.json()).code).toBe('skill_not_found')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(fetchSourceRoot, { recursive: true, force: true })
      rmSync(exportRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
    }
  })
  it('returns structured errors for readonly scopes, missing workspace, invalid source, and missing fetch session', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const homeDir = makeTempDir('cradle-home-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = homeDir

    writeSkillPackage(join(homeDir, '.agents', 'skills'), 'legacy-skill', 'legacy-skill', 'Legacy skill', 'legacy body')

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const readonlyCreate = await app.handle(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'legacy',
          name: 'nope',
          description: 'Nope',
          body: 'Should fail',
        }),
      }))
      expect(readonlyCreate.status).toBe(400)
      expect((await readonlyCreate.json()).code).toBe('skills_scope_read_only')

      const readonlyRepositoryCreate = await app.handle(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'repository',
          name: 'nope',
          description: 'Nope',
          body: 'Should fail',
        }),
      }))
      expect(readonlyRepositoryCreate.status).toBe(400)
      expect((await readonlyRepositoryCreate.json()).code).toBe('skills_scope_read_only')

      const missingWorkspace = await app.handle(new Request('http://localhost/skills?workspaceId=missing-workspace'))
      expect(missingWorkspace.status).toBe(404)
      expect((await missingWorkspace.json()).code).toBe('skills_workspace_not_found')

      const missingSkill = await app.handle(new Request('http://localhost/skills/document?scope=global&name=missing-skill'))
      expect(missingSkill.status).toBe(404)
      expect((await missingSkill.json()).code).toBe('skill_not_found')

      const missingWorkspaceBody = await app.handle(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'workspace',
          name: 'workspace-only',
          description: 'Needs workspace id',
          body: 'Missing workspace id',
        }),
      }))
      expect(missingWorkspaceBody.status).toBe(400)
      expect((await missingWorkspaceBody.json()).code).toBe('invalid_skills_input')

      const invalidSource = await app.handle(new Request('http://localhost/skills/fetch-source', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: '/definitely/not/a/real/path' }),
      }))
      expect(invalidSource.status).toBe(400)
      expect((await invalidSource.json()).code).toBe('invalid_skills_source')

      const missingSession = await app.handle(new Request('http://localhost/skills/import-from-fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'missing-session',
          scope: 'global',
          selectedDirs: ['/tmp/not-from-session'],
        }),
      }))
      expect(missingSession.status).toBe(404)
      expect((await missingSession.json()).code).toBe('skills_fetch_session_not_found')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
    }
  })
})
