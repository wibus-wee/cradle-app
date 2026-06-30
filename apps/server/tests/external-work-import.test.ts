// Focused coverage for external AI work import preview, persistence, and deduplication.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendSessionBindings, externalWorkImportItems, messages, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { localWorkspaceLocator, serializeWorkspaceLocator } from '../src/modules/workspace/workspace-locator'

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-external-work-import-'))
}

async function postJson(path: string, body: unknown): Promise<Response> {
  const app = await createServerApp({ startBackgroundTasks: false })
  return app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('external work import', () => {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    secret: process.env.CRADLE_CREDENTIAL_SECRET,
  }
  const tempDirs: string[] = []

  afterEach(() => {
    shutdownInfra()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    if (previous.dataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previous.dataDir
    }
    if (previous.secret === undefined) {
      delete process.env.CRADLE_CREDENTIAL_SECRET
    }
    else {
      process.env.CRADLE_CREDENTIAL_SECRET = previous.secret
    }
  })

  it('imports uploaded Claude session snapshots and deduplicates repeated imports', async () => {
    const dataDir = makeDataDir()
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    const content = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Plan the import flow.' },
        timestamp: '2026-05-01T10:00:00.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-1',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Use preview, import, and dedupe.' },
        timestamp: '2026-05-01T10:00:01.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-1',
      }),
    ].join('\n')

    const previewResponse = await postJson('/external-work-import/upload-preview', {
      files: [{ sourceApp: 'claude', path: '/Users/test/.claude/projects/demo/session.jsonl', content }],
    })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({
      sourceApp: 'claude',
      sourceKind: 'session',
      importable: true,
      duplicate: false,
    })

    const importResponse = await postJson('/external-work-import/import', {
      items: preview.items,
    })
    expect(importResponse.status).toBe(200)
    const imported = await importResponse.json() as {
      imported: number
      duplicates: number
      items: Array<{ sessionId: string | null }>
    }
    expect(imported.imported).toBe(1)
    expect(imported.duplicates).toBe(0)
    expect(imported.items[0]?.sessionId).toBeTruthy()

    const workspaceRows = db()
      .select()
      .from(workspaces)
      .where(eq(workspaces.locatorJson, serializeWorkspaceLocator(localWorkspaceLocator(dataDir))))
      .all()
    const sessionRows = db().select().from(sessions).all()
    const messageRows = db().select().from(messages).where(eq(messages.sessionId, imported.items[0]!.sessionId!)).all()
    const recordRows = db().select().from(externalWorkImportItems).all()
    expect(workspaceRows).toHaveLength(1)
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0]?.workspaceId).toBe(workspaceRows[0]?.id)
    expect(messageRows.map(row => row.content)).toEqual([
      'Plan the import flow.',
      'Use preview, import, and dedupe.',
    ])
    expect(recordRows).toHaveLength(1)

    const duplicateResponse = await postJson('/external-work-import/import', {
      items: preview.items,
    })
    expect(duplicateResponse.status).toBe(200)
    const duplicate = await duplicateResponse.json() as { imported: number, duplicates: number }
    expect(duplicate.imported).toBe(0)
    expect(duplicate.duplicates).toBe(1)
    expect(db().select().from(sessions).all()).toHaveLength(1)
  })

  it('deduplicates uploaded sessions by message content across source paths', async () => {
    const dataDir = makeDataDir()
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    const messagesJsonl = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Same old session.' },
        timestamp: '2026-05-01T10:00:00.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-original',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Same assistant reply.' },
        timestamp: '2026-05-01T10:00:01.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-original',
      }),
    ].join('\n')

    const previewResponse = await postJson('/external-work-import/upload-preview', {
      files: [
        {
          sourceApp: 'claude',
          path: '/Users/test/.claude/projects/demo/original.jsonl',
          content: messagesJsonl,
        },
        {
          sourceApp: 'claude',
          path: '/Users/test/.claude/projects/demo/legacy-copy.jsonl',
          content: messagesJsonl.replace('claude-session-original', 'claude-session-legacy-copy'),
        },
      ],
    })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({
      sourceKind: 'session',
      importable: true,
    })

    const importResponse = await postJson('/external-work-import/import', {
      items: preview.items,
    })
    expect(importResponse.status).toBe(200)
    const imported = await importResponse.json() as { imported: number, duplicates: number }
    expect(imported.imported).toBe(1)
    expect(imported.duplicates).toBe(0)
    expect(db().select().from(sessions).all()).toHaveLength(1)
    expect(db().select().from(externalWorkImportItems).all()).toHaveLength(1)
  })

  it('deduplicates Claude sessions already persisted by Cradle runtime bindings', async () => {
    const dataDir = makeDataDir()
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    const now = 1_777_777_777
    const existingSessionId = 'cradle-claude-session'
    db().insert(sessions).values({
      id: existingSessionId,
      workspaceId: null,
      title: 'Existing Claude session',
      runtimeKind: 'claude-agent',
      configJson: '{}',
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(backendSessionBindings).values({
      id: 'cradle-claude-binding',
      chatSessionId: existingSessionId,
      providerTargetId: null,
      runtimeKind: 'claude-agent',
      backendSessionId: 'claude-session-in-cradle',
      backendStateSnapshot: '{}',
      requestedModelId: null,
      createdAt: now,
      updatedAt: now,
    }).run()

    const content = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'This already came through Cradle.' },
        timestamp: '2026-05-01T10:00:00.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-in-cradle',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Do not import it again.' },
        timestamp: '2026-05-01T10:00:01.000Z',
        cwd: dataDir,
        sessionId: 'claude-session-in-cradle',
      }),
    ].join('\n')

    const previewResponse = await postJson('/external-work-import/upload-preview', {
      files: [{ sourceApp: 'claude', path: '/Users/test/.claude/projects/demo/session.jsonl', content }],
    })
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(preview.items).toHaveLength(0)

    const importResponse = await postJson('/external-work-import/import', {
      items: [{
        id: 'claude:session:stale-cradle-preview',
        sourceApp: 'claude',
        sourceScope: 'electron-upload',
        sourceKind: 'session',
        title: 'Existing Claude session',
        summary: '2 messages',
        sourcePath: '/Users/test/.claude/projects/demo/session.jsonl',
        externalId: 'claude-session-in-cradle',
        fingerprint: 'stale-cradle-fingerprint',
        workspacePath: dataDir,
        createdAt: 1_777_777_777,
        updatedAt: 1_777_777_778,
        duplicate: false,
        duplicateImportId: null,
        importable: true,
        reason: null,
        payloadJson: JSON.stringify({
          kind: 'session',
          messages: [
            {
              role: 'user',
              content: 'This already came through Cradle.',
              createdAt: 1_777_777_777,
            },
            {
              role: 'assistant',
              content: 'Do not import it again.',
              createdAt: 1_777_777_778,
            },
          ],
        }),
      }],
    })
    expect(importResponse.status).toBe(200)
    const imported = await importResponse.json() as {
      imported: number
      duplicates: number
      items: Array<{ record: unknown, sessionId: string | null }>
    }
    expect(imported.imported).toBe(0)
    expect(imported.duplicates).toBe(1)
    expect(imported.items[0]?.record).toBeNull()
    expect(imported.items[0]?.sessionId).toBe(existingSessionId)
    expect(db().select().from(sessions).all()).toHaveLength(1)
    expect(db().select().from(externalWorkImportItems).all()).toHaveLength(0)
  })

  it('only previews and imports session items', async () => {
    const dataDir = makeDataDir()
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cradle-external-workspace-'))
    tempDirs.push(dataDir, workspaceDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'external-work-import-test-secret'

    const serverPreviewResponse = await postJson('/external-work-import/preview', {
      includeHome: false,
      cwds: [workspaceDir],
      sourceApps: ['codex'],
    })
    expect(serverPreviewResponse.status).toBe(200)
    const serverPreview = await serverPreviewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(serverPreview.items).toHaveLength(0)

    const uploadPreviewResponse = await postJson('/external-work-import/upload-preview', {
      files: [
        {
          sourceApp: 'codex',
          path: '/Users/test/.codex/config.toml',
          content: 'model = "gpt-5.1"',
        },
        {
          sourceApp: 'codex',
          path: join(workspaceDir, 'AGENTS.md'),
          content: 'Use Cradle project conventions.',
          workspacePath: workspaceDir,
        },
      ],
    })
    expect(uploadPreviewResponse.status).toBe(200)
    const uploadPreview = await uploadPreviewResponse.json() as {
      items: Array<Record<string, unknown>>
    }
    expect(uploadPreview.items).toHaveLength(0)

    const importResponse = await postJson('/external-work-import/import', {
      items: [{
        id: 'codex:settings:test',
        sourceApp: 'codex',
        sourceScope: 'electron-upload',
        sourceKind: 'settings',
        title: 'Codex settings',
        summary: 'Settings',
        sourcePath: '/Users/test/.codex/config.toml',
        externalId: '/Users/test/.codex/config.toml',
        fingerprint: 'settings-fingerprint',
        workspacePath: null,
        createdAt: null,
        updatedAt: null,
        duplicate: false,
        duplicateImportId: null,
        importable: true,
        reason: null,
        payloadJson: '{}',
      }],
    })
    expect(importResponse.status).toBe(200)
    const imported = await importResponse.json() as { imported: number, skipped: number }
    expect(imported.imported).toBe(0)
    expect(imported.skipped).toBe(1)
    expect(db().select().from(externalWorkImportItems).all()).toHaveLength(0)
  })
})
