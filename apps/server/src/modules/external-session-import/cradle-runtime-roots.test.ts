import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  codexImportRootSet,
  defaultClaudeImportRoots,
  defaultCodexImportRootSets,
} from './cradle-runtime-roots'
import { createClaudeSessionSource } from './sources/claude'
import { createCodexSessionSource } from './sources/codex'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  delete process.env.CRADLE_DATA_DIR
  delete process.env.CRADLE_DB_PATH
})

function writeJsonLines(path: string, rows: unknown[]): void {
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join('\n'))
}

describe('cradle runtime import roots', () => {
  it('defaultCodexImportRootSets includes user and Cradle codex-app-server homes', () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-import-roots-codex-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')

    const sets = defaultCodexImportRootSets({ homeDir: root })
    expect(sets).toHaveLength(2)
    expect(sets[0]?.roots.current).toContain(`${join(root, '.codex', 'sessions')}`)
    expect(sets[1]?.roots.current).toBe(join(root, 'data', 'runtimes', 'codex-app-server', 'sessions'))
  })

  it('discovers Codex sessions from Cradle-owned codex-app-server rollouts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-import-roots-codex-discover-'))
    tempDirectories.push(root)
    const cradleHome = join(root, 'data', 'runtimes', 'codex-app-server')
    mkdirSync(join(cradleHome, 'sessions', '2027', '01', '15'), { recursive: true })
    writeJsonLines(join(cradleHome, 'session_index.jsonl'), [
      { id: 'cradle-codex-thread', thread_name: 'Cradle runtime thread' },
    ])
    writeJsonLines(join(cradleHome, 'sessions', '2027', '01', '15', 'rollout.jsonl'), [
      {
        type: 'session_meta',
        payload: {
          id: 'cradle-codex-thread',
          cwd: '/workspace/project',
          source: 'cli',
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Ship import from Cradle runtime data',
        },
      },
    ])

    const source = createCodexSessionSource({ rootSets: [codexImportRootSet(cradleHome)] })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    expect(descriptors).toEqual([
      expect.objectContaining({
        externalSessionId: 'cradle-codex-thread',
        title: 'Cradle runtime thread',
      }),
    ])
  })

  it('defaultClaudeImportRoots includes user and Cradle claude-agent projects', () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-import-roots-claude-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')

    const roots = defaultClaudeImportRoots({ homeDir: root })
    expect(roots).toEqual([
      join(root, '.claude', 'projects'),
      join(root, 'data', 'runtimes', 'claude-agent', 'projects'),
    ])
  })

  it('discovers Claude sessions from Cradle-owned claude-agent projects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-import-roots-claude-discover-'))
    tempDirectories.push(root)
    const cradleRoot = join(root, 'data', 'runtimes', 'claude-agent', 'projects')
    mkdirSync(cradleRoot, { recursive: true })
    writeJsonLines(join(cradleRoot, 'cradle-claude-session.jsonl'), [
      {
        type: 'user',
        sessionId: 'cradle-claude-session',
        cwd: '/workspace/project',
        timestamp: '2027-01-15T07:00:01.000Z',
        message: {
          role: 'user',
          content: 'Import from Cradle Claude runtime',
        },
      },
      {
        type: 'assistant',
        sessionId: 'cradle-claude-session',
        timestamp: '2027-01-15T07:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
        },
      },
    ])

    const source = createClaudeSessionSource({ roots: [cradleRoot] })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    expect(descriptors).toEqual([
      expect.objectContaining({
        externalSessionId: 'cradle-claude-session',
        title: 'Import from Cradle Claude runtime',
      }),
    ])
  })
})
