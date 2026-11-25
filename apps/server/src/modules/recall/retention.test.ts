import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recallFileTouches, recallToolEvents, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { workspaceFixture } from '../../../tests/helpers/workspace-fixture'
import { createServerApp } from '../../app'
import { db, shutdownInfra } from '../../infra'
import { pruneRecallToolEvents } from './service'

const dataDirs: string[] = []
const workspaceRoots: string[] = []

afterEach(() => {
  shutdownInfra()
  for (const directory of [...dataDirs, ...workspaceRoots]) {
    rmSync(directory, { recursive: true, force: true })
  }
  dataDirs.length = 0
  workspaceRoots.length = 0
  delete process.env.CRADLE_DATA_DIR
  delete process.env.CRADLE_RECALL_TOOL_EVENT_RETENTION_DAYS
})

function tempDirectory(prefix: string, target: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  target.push(directory)
  return directory
}

const DAY_MS = 24 * 60 * 60 * 1000

async function seedWorkspaceAndSession(): Promise<{ workspaceId: string, sessionId: string }> {
  process.env.CRADLE_DATA_DIR = tempDirectory('cradle-recall-retention-', dataDirs)
  await createServerApp()
  const workspaceId = randomUUID()
  const sessionId = randomUUID()
  db().insert(workspaces).values(workspaceFixture({
    id: workspaceId,
    name: 'Recall Retention',
    path: tempDirectory('cradle-recall-retention-workspace-', workspaceRoots),
  })).run()
  db().insert(sessions).values({ id: sessionId, workspaceId, title: 'Retention' }).run()
  return { workspaceId, sessionId }
}

function insertToolEvent(input: {
  sessionId: string
  workspaceId: string
  occurredAt: number
  withFileTouch?: boolean
}): string {
  const id = randomUUID()
  db().insert(recallToolEvents).values({
    id,
    runId: null,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    sourceEventId: randomUUID(),
    toolCallId: 'tool-call',
    toolName: 'bash',
    phase: 'tool_call_input_available',
    isFailure: 0,
    summary: 'bash ls',
    occurredAt: input.occurredAt,
  }).run()
  if (input.withFileTouch) {
    db().insert(recallFileTouches).values({
      id: `${id}:src/a.ts`,
      toolEventId: id,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      path: 'src/a.ts',
      occurredAt: input.occurredAt,
    }).run()
  }
  return id
}

describe('pruneRecallToolEvents', () => {
  it('deletes events older than the retention window and cascades file touches', async () => {
    const { workspaceId, sessionId } = await seedWorkspaceAndSession()
    const now = Date.now()
    const oldId = insertToolEvent({
      sessionId,
      workspaceId,
      occurredAt: now - 31 * DAY_MS,
      withFileTouch: true,
    })
    insertToolEvent({ sessionId, workspaceId, occurredAt: now - 29 * DAY_MS })

    const result = pruneRecallToolEvents(now)

    expect(result.prunedToolEvents).toBe(1)
    expect(db().select().from(recallToolEvents).where(eq(recallToolEvents.id, oldId)).all())
      .toHaveLength(0)
    // recall_file_touches.toolEventId cascades on delete; a dangling touch would
    // mean the FK enforcement the projection relies on is broken.
    expect(db().select().from(recallFileTouches).all()).toHaveLength(0)
    expect(db().select().from(recallToolEvents).all()).toHaveLength(1)
  })

  it('keeps events younger than the retention window', async () => {
    const { workspaceId, sessionId } = await seedWorkspaceAndSession()
    const now = Date.now()
    insertToolEvent({ sessionId, workspaceId, occurredAt: now - DAY_MS })

    const result = pruneRecallToolEvents(now)

    expect(result.prunedToolEvents).toBe(0)
    expect(db().select().from(recallToolEvents).all()).toHaveLength(1)
  })

  it('does nothing when retention is disabled', async () => {
    process.env.CRADLE_RECALL_TOOL_EVENT_RETENTION_DAYS = '0'
    const { workspaceId, sessionId } = await seedWorkspaceAndSession()
    const now = Date.now()
    insertToolEvent({ sessionId, workspaceId, occurredAt: now - 365 * DAY_MS })

    const result = pruneRecallToolEvents(now)

    expect(result.prunedToolEvents).toBe(0)
    expect(db().select().from(recallToolEvents).all()).toHaveLength(1)
  })
})
