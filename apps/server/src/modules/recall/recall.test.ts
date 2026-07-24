import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recallFileTouches, recallToolEvents, sessions, workspaces } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { insertMessageFixtures } from '../../../tests/helpers/message-fixture'
import { workspaceFixture } from '../../../tests/helpers/workspace-fixture'
import { createServerApp } from '../../app'
import { db, shutdownInfra } from '../../infra'
import {
  forget,
  listAttunements,
  remember,
  requestAttunement,
  resolveAttunementRequest,
} from './attune-service'
import { executeRecallQuery } from './evaluator'
import { fileHistory, search } from './query-service'
import { projectRecallMessage } from './service'

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
})

function tempDirectory(prefix: string, target: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  target.push(directory)
  return directory
}

describe('recall query', () => {
  it('projects evidence and executes workspace-scoped CodeAct helpers', async () => {
    process.env.CRADLE_DATA_DIR = tempDirectory('cradle-recall-data-', dataDirs)
    const app = await createServerApp()
    const d = db()
    const workspaceOneId = randomUUID()
    const workspaceTwoId = randomUUID()
    const sessionOneId = randomUUID()
    const sessionOneSiblingId = randomUUID()
    const sessionTwoId = randomUUID()
    const messageOneId = randomUUID()
    const messageOneSiblingId = randomUUID()
    const messageTwoId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    d.insert(workspaces)
      .values([
        workspaceFixture({
          id: workspaceOneId,
          name: 'Recall One',
          path: tempDirectory('cradle-recall-one-', workspaceRoots),
        }),
        workspaceFixture({
          id: workspaceTwoId,
          name: 'Recall Two',
          path: tempDirectory('cradle-recall-two-', workspaceRoots),
        }),
      ])
      .run()
    d.insert(sessions)
      .values([
        { id: sessionOneId, workspaceId: workspaceOneId, title: 'First Recall Session' },
        { id: sessionOneSiblingId, workspaceId: workspaceOneId, title: 'Sibling Recall Session' },
        { id: sessionTwoId, workspaceId: workspaceTwoId, title: 'Second Recall Session' },
      ])
      .run()
    insertMessageFixtures(d, [
      {
        id: messageOneId,
        sessionId: sessionOneId,
        role: 'assistant',
        status: 'complete',
        content: 'The recall index found this workspace-only deployment after an unexpected provider failure.',
        messageJson: JSON.stringify({
          id: messageOneId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'The recall index found this workspace-only deployment after an unexpected provider failure.',
            },
          ],
        }),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: messageOneSiblingId,
        sessionId: sessionOneSiblingId,
        role: 'assistant',
        status: 'complete',
        content: 'The recall index found this sibling workspace deployment failure.',
        messageJson: JSON.stringify({
          id: messageOneSiblingId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'The recall index found this sibling workspace deployment failure.',
            },
          ],
        }),
        createdAt: now + 1,
        updatedAt: now + 1,
      },
      {
        id: messageTwoId,
        sessionId: sessionTwoId,
        role: 'assistant',
        status: 'complete',
        content: 'The recall index found this other-workspace deployment failure.',
        messageJson: JSON.stringify({
          id: messageTwoId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'The recall index found this other-workspace deployment failure.',
            },
          ],
        }),
        createdAt: now + 2,
        updatedAt: now + 2,
      },
    ])
    projectRecallMessage(d, { messageId: messageOneId })
    projectRecallMessage(d, { messageId: messageOneSiblingId })
    projectRecallMessage(d, { messageId: messageTwoId })

    const toolEventId = randomUUID()
    d.insert(recallToolEvents)
      .values({
        id: toolEventId,
        runId: null,
        sessionId: sessionOneId,
        workspaceId: workspaceOneId,
        sourceEventId: randomUUID(),
        toolCallId: 'tool-file-change',
        toolName: 'file_change',
        phase: 'tool_call_input_available',
        isFailure: 0,
        summary: 'file_change src/recall.ts',
        occurredAt: now,
      })
      .run()
    d.insert(recallFileTouches)
      .values({
        id: `${toolEventId}:src/recall.ts`,
        toolEventId,
        sessionId: sessionOneId,
        workspaceId: workspaceOneId,
        path: 'src/recall.ts',
        occurredAt: now,
      })
      .run()

    expect(search({ workspaceId: workspaceOneId }, 'deployment')).toEqual([
      expect.objectContaining({ id: messageOneSiblingId, sessionId: sessionOneSiblingId }),
      expect.objectContaining({ id: messageOneId, sessionId: sessionOneId }),
    ])
    expect(search({ workspaceId: workspaceOneId }, 'deployment failure')).toEqual([
      expect.objectContaining({ id: messageOneSiblingId, sessionId: sessionOneSiblingId }),
      expect.objectContaining({ id: messageOneId, sessionId: sessionOneId }),
    ])
    expect(
      search({ workspaceId: workspaceOneId }, 'deployment', { sessionId: sessionOneSiblingId }),
    ).toEqual([expect.objectContaining({ id: messageOneSiblingId, sessionId: sessionOneSiblingId })])
    expect(fileHistory({ workspaceId: workspaceOneId }, 'src/recall.ts')).toEqual([
      expect.objectContaining({ id: toolEventId, sessionId: sessionOneId }),
    ])
    expect(fileHistory({ workspaceId: workspaceOneId }, 'src')).toEqual([])

    const outcome = await executeRecallQuery({
      context: { chatSessionId: sessionOneId, workspaceId: workspaceOneId, workId: null },
      code: `async () => ({
        map: overview(),
        evidence: search('deployment failure'),
        sibling: search('deployment', { sessionId: ${JSON.stringify(sessionOneSiblingId)} }),
      })`,
    })

    expect(outcome).toEqual({
      kind: 'completed',
      result: {
        map: expect.objectContaining({ workspace: { id: workspaceOneId } }),
        evidence: [
          expect.objectContaining({ id: messageOneSiblingId, sessionId: sessionOneSiblingId }),
          expect.objectContaining({ id: messageOneId, sessionId: sessionOneId }),
        ],
        sibling: [expect.objectContaining({ id: messageOneSiblingId, sessionId: sessionOneSiblingId })],
      },
    })

    const response = await app.handle(
      new Request('http://localhost/recall/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chatSessionId: sessionOneId,
          code: 'async () => search("deployment")',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      kind: 'completed',
      result: [
        expect.objectContaining({ id: messageOneSiblingId }),
        expect.objectContaining({ id: messageOneId }),
      ],
    })
  })

  it('requires evidence anchors and archives attunements without deleting them', async () => {
    process.env.CRADLE_DATA_DIR = tempDirectory('cradle-recall-data-', dataDirs)
    await createServerApp()
    const d = db()
    const workspaceId = randomUUID()
    const sessionId = randomUUID()
    d.insert(workspaces)
      .values(
        workspaceFixture({
          id: workspaceId,
          name: 'Attune Workspace',
          path: tempDirectory('cradle-attune-', workspaceRoots),
        }),
      )
      .run()
    d.insert(sessions).values({ id: sessionId, workspaceId, title: 'Attune Session' }).run()
    const context = { chatSessionId: sessionId, workspaceId, workId: null }
    const evidenceId = randomUUID()
    d.insert(recallToolEvents).values({
      id: evidenceId,
      runId: null,
      sessionId,
      workspaceId,
      sourceEventId: randomUUID(),
      toolCallId: 'attune-evidence-tool',
      toolName: 'read_file',
      phase: 'tool_call_input_available',
      isFailure: 0,
      summary: 'read_file src/recall.ts',
      occurredAt: Math.floor(Date.now() / 1000),
    }).run()

    expect(() => remember({ context, content: 'No anchor', evidenceIds: [] })).toThrow(
      'evidence ID',
    )
    const record = remember({
      context,
      content: 'Deployment uses bounded recall.',
      evidenceIds: [evidenceId],
    })
    expect(listAttunements(context)).toEqual([
      expect.objectContaining({ id: record.id, status: 'active' }),
    ])
    expect(forget({ context, id: record.id })).toEqual(
      expect.objectContaining({ id: record.id, status: 'archived' }),
    )
    expect(listAttunements(context)).toEqual([])

    const pending = requestAttunement({
      context,
      intent: { operation: 'remember', content: 'Approved through an explicit request.', evidenceIds: [evidenceId] },
    })
    expect(listAttunements(context)).toEqual([])
    expect(resolveAttunementRequest({ context, requestId: pending.id, approved: true })).toEqual(
      expect.objectContaining({ requestId: pending.id, status: 'executed' }),
    )
    expect(listAttunements(context)).toEqual([
      expect.objectContaining({ content: 'Approved through an explicit request.' }),
    ])
  })
})
