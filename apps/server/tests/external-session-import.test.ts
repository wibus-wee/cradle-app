import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  backendSessionBindings,
  externalSessionImports,
  externalWorkImportItems,
  messages,
  sessions,
  workspaces,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
import { captureExternalSessionBundle } from '../src/modules/external-session-import/bundle-store'
import { scanExternalSessions } from '../src/modules/external-session-import/catalog'
import {
  importExternalSessions,
  syncExternalSessionImport,
} from '../src/modules/external-session-import/service'
import {
  createCandidateId,
  createContentHash,
  createImportedMessageId,
  createSourceFilesRevision,
  emptyGitIdentity,
  importedMessage,
} from '../src/modules/external-session-import/source-utils'
import type {
  ExternalSessionBundle,
  ExternalSessionDescriptor,
  ExternalSessionImportMessage,
  ExternalSessionSourceAdapter,
} from '../src/modules/external-session-import/types'
import * as Workspace from '../src/modules/workspace/service'
import { localWorkspaceLocator } from '../src/modules/workspace/workspace-locator'
import { insertMessageFixtures } from './helpers/message-fixture'

const previous = {
  dataDir: process.env.CRADLE_DATA_DIR,
  secret: process.env.CRADLE_CREDENTIAL_SECRET,
}
const tempDirectories: string[] = []

afterEach(() => {
  shutdownInfra()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  restoreEnvironment('CRADLE_DATA_DIR', previous.dataDir)
  restoreEnvironment('CRADLE_CREDENTIAL_SECRET', previous.secret)
})

describe('external session import', () => {
  it('plans exact, longest-ancestor, Git identity, available, and offline Workspaces', () => {
    activateTestDatabase()
    const root = makeTempDirectory('cradle-import-workspaces-')
    const nestedWorkspacePath = join(root, 'repo', 'packages')
    const deepestWorkspacePath = join(nestedWorkspacePath, 'web')
    mkdirSync(deepestWorkspacePath, { recursive: true })
    const rootWorkspace = Workspace.create({
      name: 'repo',
      locator: localWorkspaceLocator(join(root, 'repo')),
    })
    const packagesWorkspace = Workspace.create({
      name: 'packages',
      locator: localWorkspaceLocator(nestedWorkspacePath),
    })

    expect(Workspace.planHistoricalWorkspace({
      sourceHostId: 'local',
      workspacePath: nestedWorkspacePath,
    })).toMatchObject({ kind: 'existing', reason: 'exact-path', workspace: { id: packagesWorkspace.id } })
    expect(Workspace.planHistoricalWorkspace({
      sourceHostId: 'local',
      workspacePath: deepestWorkspacePath,
    })).toMatchObject({ kind: 'existing', reason: 'containing-path', workspace: { id: packagesWorkspace.id } })

    const movedCheckout = join(root, 'moved-checkout')
    mkdirSync(movedCheckout)
    const gitWorkspace = Workspace.create({
      name: 'old-checkout',
      locator: localWorkspaceLocator(join(root, 'old-checkout')),
      gitIdentity: { ...emptyGitIdentity(), originUrl: 'git@github.com:cradle/demo.git' },
    })
    expect(Workspace.planHistoricalWorkspace({
      sourceHostId: 'local',
      workspacePath: movedCheckout,
      gitIdentity: { ...emptyGitIdentity(), originUrl: 'git@github.com:cradle/demo.git' },
    })).toMatchObject({ kind: 'existing', reason: 'git-identity', workspace: { id: gitWorkspace.id } })

    const available = join(root, 'unregistered')
    mkdirSync(available)
    expect(Workspace.planHistoricalWorkspace({
      sourceHostId: 'local',
      workspacePath: available,
    })).toMatchObject({ kind: 'create', reason: 'available-project-root', availability: 'available' })
    expect(Workspace.planHistoricalWorkspace({
      sourceHostId: 'local',
      workspacePath: join(root, 'gone'),
    })).toMatchObject({ kind: 'create', reason: 'offline-historical-root', availability: 'missing' })
    expect(rootWorkspace.id).not.toBe(packagesWorkspace.id)
  })

  it('imports into one recovered Workspace, deduplicates, and relinks an offline Workspace', async () => {
    activateTestDatabase()
    const missingPath = join(makeTempDirectory('cradle-import-offline-parent-'), 'deleted-project')
    const fixture = createMutableSource({ workspacePath: missingPath })
    const scan = await scanExternalSessions({}, { adapters: [fixture.adapter] })
    expect(scan.candidates[0]).toMatchObject({
      importState: 'available',
      workspacePlan: { reason: 'offline-historical-root', availability: 'missing' },
    })

    const imported = await importExternalSessions({
      scanId: scan.id,
      candidateIds: [scan.candidates[0]!.candidateId],
    }, { adapters: [fixture.adapter] })
    expect(imported).toMatchObject({ imported: 1, duplicates: 0, errors: 0 })
    expect(imported.items[0]?.workspaceId).toBeTruthy()
    expect(db().select().from(workspaces).all()).toHaveLength(1)
    expect(db().select().from(sessions).all()[0]).toMatchObject({
      workspaceId: imported.items[0]!.workspaceId,
      origin: 'external-import',
    })
    expect(db().select().from(messages).all()).toHaveLength(2)
    expect(db().select().from(externalSessionImports).all()).toEqual([
      expect.objectContaining({
        bundlePath: 'external-session-import/codex/codex-session-1',
        parserVersion: 1,
      }),
    ])
    expect(db().select().from(backendSessionBindings).all()).toHaveLength(0)
    expect(Workspace.get(imported.items[0]!.workspaceId!)?.availability).toBe('missing')
    expect(Workspace.getLocalWorkspacePath(imported.items[0]!.workspaceId!)).toBeNull()

    const duplicate = await importExternalSessions({
      scanId: scan.id,
      candidateIds: [scan.candidates[0]!.candidateId],
    }, { adapters: [fixture.adapter] })
    expect(duplicate).toMatchObject({ imported: 0, duplicates: 1, errors: 0 })
    expect(db().select().from(sessions).all()).toHaveLength(1)

    const relinkedPath = makeTempDirectory('cradle-import-relinked-')
    expect(Workspace.relinkWorkspace(imported.items[0]!.workspaceId!, relinkedPath)).toMatchObject({
      availability: 'available',
      locator: { path: realpathSync(relinkedPath) },
    })
    expect(Workspace.getLocalWorkspacePath(imported.items[0]!.workspaceId!)).toBe(realpathSync(relinkedPath))
    const relinkedScan = await scanExternalSessions({}, { adapters: [fixture.adapter] })
    expect(relinkedScan.candidates[0]).toMatchObject({
      importState: 'imported',
      workspacePlan: {
        reason: 'import-record',
        path: realpathSync(relinkedPath),
        availability: 'available',
      },
    })
  })

  it('rolls back Workspace, Session, messages, and import record when projection fails', async () => {
    activateTestDatabase()
    const missingPath = join(makeTempDirectory('cradle-import-rollback-parent-'), 'deleted-project')
    const fixture = createMutableSource({ workspacePath: missingPath })
    fixture.messages = [
      sourceMessage(fixture.descriptor, 'same-id', 'user', 'First'),
      sourceMessage(fixture.descriptor, 'same-id', 'assistant', 'Second'),
    ]
    const scan = await scanExternalSessions({}, { adapters: [fixture.adapter] })
    const imported = await importExternalSessions({
      scanId: scan.id,
      candidateIds: [scan.candidates[0]!.candidateId],
    }, { adapters: [fixture.adapter] })

    expect(imported).toMatchObject({ imported: 0, errors: 1 })
    expect(db().select().from(workspaces).all()).toHaveLength(0)
    expect(db().select().from(sessions).all()).toHaveLength(0)
    expect(db().select().from(messages).all()).toHaveLength(0)
    expect(db().select().from(externalSessionImports).all()).toHaveLength(0)
  })

  it('removes a newly captured bundle when parsing fails', async () => {
    activateTestDatabase()
    const workspacePath = makeTempDirectory('cradle-import-bundle-failure-workspace-')
    const sourceDirectory = makeTempDirectory('cradle-import-bundle-failure-source-')
    const sourcePath = join(sourceDirectory, 'failed.jsonl')
    writeFileSync(sourcePath, '{"type":"broken-fixture"}\n', 'utf8')
    const fileStat = statSync(sourcePath)
    const sourceFiles = [{
      path: sourcePath,
      kind: 'main' as const,
      sourceId: 'failed-session',
      size: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
    }]
    const failedDescriptor: ExternalSessionDescriptor = {
      ...descriptor({ workspacePath, externalSessionId: 'failed-session' }),
      sourcePath,
      sourceFiles,
      sourceRevision: createSourceFilesRevision({
        externalSessionId: 'failed-session',
        files: sourceFiles,
      }),
    }
    let capturedPath = ''
    const adapter: ExternalSessionSourceAdapter = {
      sourceApp: 'codex',
      discover: async () => [failedDescriptor],
      capture: async () => {
        const bundle = await captureExternalSessionBundle(failedDescriptor)
        capturedPath = bundle.absolutePath
        return bundle
      },
      read: async () => {
        throw new Error('Injected parser failure')
      },
    }
    const scan = await scanExternalSessions({}, { adapters: [adapter] })
    const result = await importExternalSessions({
      scanId: scan.id,
      candidateIds: [scan.candidates[0]!.candidateId],
    }, { adapters: [adapter] })

    expect(result).toMatchObject({ imported: 0, errors: 1 })
    expect(capturedPath).not.toBe('')
    expect(existsSync(capturedPath)).toBe(false)
    expect(db().select().from(externalSessionImports).all()).toHaveLength(0)
  })

  it('synchronizes an appended stable prefix and rejects divergent provider history', async () => {
    activateTestDatabase()
    const workspacePath = makeTempDirectory('cradle-import-sync-')
    const fixture = createMutableSource({ workspacePath })
    const firstScan = await scanExternalSessions({}, { adapters: [fixture.adapter] })
    const imported = await importExternalSessions({
      scanId: firstScan.id,
      candidateIds: [firstScan.candidates[0]!.candidateId],
    }, { adapters: [fixture.adapter] })
    const importId = imported.items[0]!.recordId!

    fixture.descriptor = { ...fixture.descriptor, sourceRevision: 'revision-2', updatedAt: 1_800_000_020 }
    fixture.messages = [
      ...fixture.messages,
      sourceMessage(fixture.descriptor, 'assistant-2', 'assistant', 'Appended answer'),
    ]
    const updateScan = await scanExternalSessions({}, { adapters: [fixture.adapter] })
    expect(updateScan.candidates[0]).toMatchObject({
      importState: 'update-available',
      importRecordId: importId,
    })
    const synced = await syncExternalSessionImport({
      importId,
      scanId: updateScan.id,
      candidateId: updateScan.candidates[0]!.candidateId,
    }, { adapters: [fixture.adapter] })
    expect(synced).toMatchObject({ status: 'synced', appendedMessages: 1 })
    expect(db().select().from(messages).all()).toHaveLength(3)

    fixture.descriptor = { ...fixture.descriptor, sourceRevision: 'revision-3' }
    fixture.messages = [
      sourceMessage(fixture.descriptor, 'user-1', 'user', 'Rewritten first prompt'),
      ...fixture.messages.slice(1),
    ]
    const divergentScan = await scanExternalSessions({}, { adapters: [fixture.adapter] })
    const divergent = await syncExternalSessionImport({
      importId,
      scanId: divergentScan.id,
      candidateId: divergentScan.candidates[0]!.candidateId,
    }, { adapters: [fixture.adapter] })
    expect(divergent).toMatchObject({ status: 'diverged', appendedMessages: 0 })
    expect(db().select().from(messages).all()).toHaveLength(3)
    expect(db().select().from(externalSessionImports).where(eq(externalSessionImports.id, importId)).get())
      .toMatchObject({ status: 'error' })
  })

  it('adopts a legacy history record and repairs its null Workspace without duplicating its prompt', async () => {
    activateTestDatabase()
    const workspacePath = makeTempDirectory('cradle-import-legacy-')
    const fixture = createMutableSource({ workspacePath, externalSessionId: 'legacy-codex-session' })
    const now = 1_800_000_000
    db().insert(sessions).values({
      id: 'legacy-cradle-session',
      workspaceId: null,
      title: 'Legacy import',
      runtimeKind: 'codex',
      configJson: '{}',
      createdAt: now,
      updatedAt: now,
    }).run()
    insertMessageFixtures(db(), {
      id: 'legacy-message',
      sessionId: 'legacy-cradle-session',
      role: 'user',
      status: 'complete',
      depth: 0,
      content: 'Imported prompt',
      messageJson: '{}',
      createdAt: now,
      updatedAt: now,
    })
    db().insert(externalWorkImportItems).values({
      id: 'legacy-import',
      sourceApp: 'codex',
      sourceScope: 'server',
      sourceKind: 'session',
      sourcePath: null,
      externalId: 'history:legacy-codex-session',
      fingerprint: 'legacy-fingerprint',
      title: 'Legacy import',
      summary: null,
      workspaceId: null,
      sessionId: 'legacy-cradle-session',
      messageId: 'legacy-message',
      payloadJson: JSON.stringify({
        kind: 'session',
        messages: [{ role: 'user', content: 'Imported prompt', createdAt: now }],
      }),
      status: 'imported',
      statusReason: null,
      importedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()

    const scan = await scanExternalSessions({}, { adapters: [fixture.adapter] })
    expect(scan.candidates[0]).toMatchObject({ alreadyImported: true, importState: 'update-available' })
    const adopted = await importExternalSessions({
      scanId: scan.id,
      candidateIds: [scan.candidates[0]!.candidateId],
    }, { adapters: [fixture.adapter] })
    expect(adopted).toMatchObject({ imported: 1, duplicates: 0, errors: 0 })
    expect(adopted.items[0]?.sessionId).toBe('legacy-cradle-session')
    expect(db().select().from(sessions).where(eq(sessions.id, 'legacy-cradle-session')).get())
      .toMatchObject({ origin: 'external-import', workspaceId: adopted.items[0]!.workspaceId })
    expect(db().select().from(messages).where(eq(messages.sessionId, 'legacy-cradle-session')).all())
      .toHaveLength(2)
    expect(db().select().from(externalSessionImports).all()).toHaveLength(1)
  })
})

function activateTestDatabase(): void {
  const dataDirectory = makeTempDirectory('cradle-external-session-import-db-')
  process.env.CRADLE_DATA_DIR = dataDirectory
  process.env.CRADLE_CREDENTIAL_SECRET = 'external-session-import-test-secret'
  db()
}

function makeTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  }
  else {
    process.env[name] = value
  }
}

function createMutableSource(input: {
  workspacePath: string
  externalSessionId?: string
}): {
  adapter: ExternalSessionSourceAdapter
  descriptor: ExternalSessionDescriptor
  messages: ExternalSessionImportMessage[]
} {
  const fixture = {
    descriptor: descriptor({
      workspacePath: input.workspacePath,
      externalSessionId: input.externalSessionId ?? 'codex-session-1',
    }),
    messages: [] as ExternalSessionImportMessage[],
    adapter: null as ExternalSessionSourceAdapter | null,
  }
  fixture.messages = [
    sourceMessage(fixture.descriptor, 'user-1', 'user', 'Imported prompt'),
    sourceMessage(fixture.descriptor, 'assistant-1', 'assistant', 'Imported answer'),
  ]
  fixture.adapter = {
    sourceApp: 'codex',
    discover: async () => [fixture.descriptor],
    capture: async () => testBundle(fixture.descriptor),
    read: async () => ({
      descriptor: fixture.descriptor,
      contentHash: createContentHash(fixture.messages),
      messages: fixture.messages,
      fidelity: {
        messages: fixture.messages.length,
        toolCalls: 0,
        reasoningParts: 0,
        omittedSystemEntries: 0,
        unavailableAttachments: 0,
        childSessions: 0,
        preservedUnknownEntries: 0,
      },
    }),
  }
  return fixture as {
    adapter: ExternalSessionSourceAdapter
    descriptor: ExternalSessionDescriptor
    messages: ExternalSessionImportMessage[]
  }
}

function descriptor(input: {
  workspacePath: string
  externalSessionId: string
}): ExternalSessionDescriptor {
  return {
    candidateId: createCandidateId({
      sourceHostId: 'local',
      sourceApp: 'codex',
      externalSessionId: input.externalSessionId,
    }),
    sourceHostId: 'local',
    sourceApp: 'codex',
    externalSessionId: input.externalSessionId,
    sourcePath: null,
    sourceRevision: 'revision-1',
    title: 'Imported session',
    summary: 'Imported prompt',
    workspacePath: input.workspacePath,
    gitIdentity: emptyGitIdentity(),
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_010,
    archived: false,
    estimatedBytes: 512,
    childSessionCount: 0,
    sourceFiles: [{
      path: `/provider/${input.externalSessionId}.jsonl`,
      kind: 'main',
      sourceId: input.externalSessionId,
      size: 512,
      modifiedAtMs: 1_800_000_010_000,
    }],
  }
}

function testBundle(descriptor: ExternalSessionDescriptor): ExternalSessionBundle {
  return {
    storagePath: `external-session-import/${descriptor.sourceApp}/${descriptor.externalSessionId}`,
    absolutePath: '',
    created: false,
    manifest: {
      version: 1,
      parserVersion: 1,
      sourceHostId: descriptor.sourceHostId,
      sourceApp: descriptor.sourceApp,
      externalSessionId: descriptor.externalSessionId,
      sourceRevision: descriptor.sourceRevision,
      capturedAt: 1_800_000_000,
      files: [],
    },
  }
}

function sourceMessage(
  session: ExternalSessionDescriptor,
  sourceEntryId: string,
  role: 'user' | 'assistant',
  text: string,
): ExternalSessionImportMessage {
  return importedMessage({
    id: createImportedMessageId({
      sourceApp: session.sourceApp,
      externalSessionId: session.externalSessionId,
      sourceEntryId,
    }),
    role,
    parts: [{ type: 'text', text }],
    sourceEntryIds: [sourceEntryId],
    createdAt: session.createdAt,
    descriptor: session,
  })
}
