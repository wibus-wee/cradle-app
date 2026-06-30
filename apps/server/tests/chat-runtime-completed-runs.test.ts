import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, backendSessionBindings, messages, workspaces } from '@cradle/db'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('chat runtime completed runs projection', () => {
  it('lists recently completed runs with session titles for notification polling', async () => {
    const dataDir = createTempDir('cradle-data-')
    const workspaceRoot = createTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const store = db()
      const workspaceId = randomUUID()
      const sessionId = randomUUID()
      const bindingId = randomUUID()

      store.insert(workspaces).values({
        id: workspaceId,
        name: 'Notification Workspace',
        path: workspaceRoot,
      }).run()
      store.run(sql`
        INSERT INTO sessions (id, workspace_id, title, runtime_kind)
        VALUES (${sessionId}, ${workspaceId}, ${'Notification Session'}, ${'codex'})
      `)
      store.insert(backendSessionBindings).values({
        id: bindingId,
        chatSessionId: sessionId,
        runtimeKind: 'codex',
      }).run()
      store.insert(messages).values({
        id: 'message-complete',
        sessionId,
        role: 'assistant',
        status: 'complete',
        content: 'Latest assistant response body\nwith a second line',
        messageJson: JSON.stringify({
          id: 'message-complete',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Latest assistant response body\nwith a second line' }],
        }),
        createdAt: 104,
        updatedAt: 105,
      }).run()
      store.insert(backendRuns).values([
        {
          id: 'run-old',
          bindingId,
          chatSessionId: sessionId,
          origin: 'user',
          status: 'complete',
          stopReason: 'response.completed',
          startedAt: 80,
          finishedAt: 90,
        },
        {
          id: 'run-complete',
          bindingId,
          chatSessionId: sessionId,
          origin: 'user',
          status: 'complete',
          stopReason: 'response.completed',
          messageId: 'message-complete',
          startedAt: 100,
          finishedAt: 105,
        },
        {
          id: 'run-failed',
          bindingId,
          chatSessionId: sessionId,
          origin: 'user',
          status: 'failed',
          stopReason: 'response.failed',
          startedAt: 110,
          finishedAt: 115,
        },
        {
          id: 'run-streaming',
          bindingId,
          chatSessionId: sessionId,
          origin: 'user',
          status: 'streaming',
          startedAt: 120,
        },
      ]).run()

      const response = await app.handle(new Request('http://localhost/chat/runs/completed?since=95'))
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        runs: [
          {
            runId: 'run-complete',
            sessionId,
            sessionTitle: 'Notification Session',
            messageId: 'message-complete',
            responseBody: 'Latest assistant response body\nwith a second line',
            messagePreview: 'Latest assistant response body\nwith a second line',
            startedAt: 100,
            finishedAt: 105,
          },
        ],
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
})
