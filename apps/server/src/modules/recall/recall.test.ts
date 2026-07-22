import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, workspaces } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { insertMessageFixtures } from '../../../tests/helpers/message-fixture'
import { workspaceFixture } from '../../../tests/helpers/workspace-fixture'
import { createServerApp } from '../../app'
import { db, shutdownInfra } from '../../infra'
import { executeRecallQuery } from './evaluator'
import { search } from './query-service'
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
    await createServerApp()
    const d = db()
    const workspaceOneId = randomUUID()
    const workspaceTwoId = randomUUID()
    const sessionOneId = randomUUID()
    const sessionTwoId = randomUUID()
    const messageOneId = randomUUID()
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
        { id: sessionTwoId, workspaceId: workspaceTwoId, title: 'Second Recall Session' },
      ])
      .run()
    insertMessageFixtures(d, [
      {
        id: messageOneId,
        sessionId: sessionOneId,
        role: 'assistant',
        status: 'complete',
        content: 'The recall index found this workspace-only deployment failure.',
        messageJson: JSON.stringify({
          id: messageOneId,
          role: 'assistant',
          parts: [
            { type: 'text', text: 'The recall index found this workspace-only deployment failure.' },
          ],
        }),
        createdAt: now,
        updatedAt: now,
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
        createdAt: now,
        updatedAt: now,
      },
    ])
    projectRecallMessage(d, { messageId: messageOneId })
    projectRecallMessage(d, { messageId: messageTwoId })

    expect(search({ workspaceId: workspaceOneId }, 'deployment')).toEqual([
      expect.objectContaining({ id: messageOneId, sessionId: sessionOneId }),
    ])

    const outcome = await executeRecallQuery({
      context: { chatSessionId: sessionOneId, workspaceId: workspaceOneId, workId: null },
      code: 'async () => ({ map: overview(), evidence: search("deployment") })',
    })

    expect(outcome).toEqual({
      kind: 'completed',
      result: {
        map: expect.objectContaining({ workspace: { id: workspaceOneId } }),
        evidence: [expect.objectContaining({ id: messageOneId, sessionId: sessionOneId })],
      },
    })
  })
})
