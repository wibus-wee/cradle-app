import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getManagedDataDir } from '../server-lifecycle'
import type { CradleWorld } from '../world'

export const EXTERNAL_SESSION_ID = 'claude-e2e-import-7f3a'
export const EXTERNAL_SESSION_TITLE = 'Audit the imported release transcript'
export const EXTERNAL_SESSION_REPLY = 'Imported transcript marker CRADLE_EXTERNAL_IMPORT_7F3A'

export function externalSessionIdForWorld(world: CradleWorld): string {
  return world.recall<string>('external-import.external-session-id')
}

function claudeMessage(input: {
  uuid: string
  externalSessionId: string
  role: 'user' | 'assistant'
  content: string
  workspacePath: string
  timestamp: string
}) {
  return {
    type: input.role,
    uuid: input.uuid,
    sessionId: input.externalSessionId,
    cwd: input.workspacePath,
    gitBranch: 'main',
    timestamp: input.timestamp,
    message: {
      role: input.role,
      content: input.content,
    },
  }
}

export function createExternalClaudeSessionFixture(world: CradleWorld): void {
  const dataDir = getManagedDataDir()
  if (!dataDir) {
    throw new Error('External session import fixture requires the managed E2E Server')
  }

  const externalSessionId = `${EXTERNAL_SESSION_ID}-${randomUUID()}`
  const workspacePath = world.createTempWorkspaceDir('cradle-e2e-import-workspace-')
  const projectDir = join(dataDir, 'runtimes', 'claude-agent', 'projects', `e2e-import-project-${externalSessionId}`)
  const sourcePath = join(projectDir, `${externalSessionId}.jsonl`)
  mkdirSync(projectDir, { recursive: true })

  const source = `${[
    claudeMessage({
      uuid: 'external-import-user-1',
      externalSessionId,
      role: 'user',
      content: EXTERNAL_SESSION_TITLE,
      workspacePath,
      timestamp: '2026-09-04T01:00:00.000Z',
    }),
    claudeMessage({
      uuid: 'external-import-assistant-1',
      externalSessionId,
      role: 'assistant',
      content: EXTERNAL_SESSION_REPLY,
      workspacePath,
      timestamp: '2026-09-04T01:00:01.000Z',
    }),
  ].map(row => JSON.stringify(row)).join('\n')}\n`

  writeFileSync(sourcePath, source, 'utf8')
  world.registerCleanupPath(projectDir)
  world.remember('external-import.external-session-id', externalSessionId)
  world.remember('external-import.source-path', sourcePath)
  world.remember('external-import.source-bytes', readFileSync(sourcePath))
}
