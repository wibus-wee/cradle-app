import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getManagedDataDir } from '../server-lifecycle'
import type { CradleWorld } from '../world'

export const EXTERNAL_SESSION_ID = 'claude-e2e-import-7f3a'
export const EXTERNAL_SESSION_TITLE = 'Audit the imported release transcript'
export const EXTERNAL_SESSION_REPLY = 'Imported transcript marker CRADLE_EXTERNAL_IMPORT_7F3A'

function claudeMessage(input: {
  uuid: string
  role: 'user' | 'assistant'
  content: string
  workspacePath: string
  timestamp: string
}) {
  return {
    type: input.role,
    uuid: input.uuid,
    sessionId: EXTERNAL_SESSION_ID,
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

  const workspacePath = world.createTempWorkspaceDir('cradle-e2e-import-workspace-')
  const projectDir = join(dataDir, 'runtimes', 'claude-agent', 'projects', 'e2e-import-project')
  const sourcePath = join(projectDir, `${EXTERNAL_SESSION_ID}.jsonl`)
  mkdirSync(projectDir, { recursive: true })

  const source = `${[
    claudeMessage({
      uuid: 'external-import-user-1',
      role: 'user',
      content: EXTERNAL_SESSION_TITLE,
      workspacePath,
      timestamp: '2026-09-04T01:00:00.000Z',
    }),
    claudeMessage({
      uuid: 'external-import-assistant-1',
      role: 'assistant',
      content: EXTERNAL_SESSION_REPLY,
      workspacePath,
      timestamp: '2026-09-04T01:00:01.000Z',
    }),
  ].map(row => JSON.stringify(row)).join('\n')}\n`

  writeFileSync(sourcePath, source, 'utf8')
  world.registerCleanupPath(projectDir)
  world.remember('external-import.source-path', sourcePath)
  world.remember('external-import.source-bytes', readFileSync(sourcePath))
}
