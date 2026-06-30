import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { captureCodexCliSession } from '../src/modules/pty/codex-session-capture'

const WORKSPACE_PATH = '/tmp/cradle-workspace'
const MATCH_ID = '019e3c07-d7df-73d2-a3dc-dfaf5f883050'
const OTHER_ID = '019e3c08-8859-7af2-90ca-63f6b84a6c12'
const STARTED_AT = Date.parse('2026-05-19T10:00:00.000Z')

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-codex-capture-'))
}

function writeCodexSessionFile(input: {
  root: string
  id: string
  timestampMs: number
  cwd: string
  originator?: string
  mtimeMs?: number
  suffix?: string
  body?: string
}): string {
  const timestamp = new Date(input.timestampMs).toISOString()
  const directory = join(input.root, '2026', '05', '19')
  const path = join(directory, `rollout-2026-05-19T10-00-00-${input.id}${input.suffix ?? ''}.jsonl`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, [
    JSON.stringify({
      timestamp,
      type: 'session_meta',
      payload: {
        id: input.id,
        timestamp,
        cwd: input.cwd,
        originator: input.originator ?? 'codex-tui',
      },
    }),
    input.body ?? '{this is intentionally invalid json',
  ].join('\n'))
  const mtime = new Date(input.mtimeMs ?? input.timestampMs)
  utimesSync(path, mtime, mtime)
  return path
}

describe('codex cli session capture', () => {
  it('captures the unique Codex TUI session matching cwd and launch time', async () => {
    const root = tempRoot()
    try {
      const path = writeCodexSessionFile({
        root,
        id: MATCH_ID,
        timestampMs: STARTED_AT + 1_000,
        cwd: WORKSPACE_PATH,
      })
      writeCodexSessionFile({
        root,
        id: OTHER_ID,
        timestampMs: STARTED_AT + 1_000,
        cwd: '/tmp/other-workspace',
        suffix: '-other-cwd',
      })

      const binding = await captureCodexCliSession({
        codexSessionsRoot: root,
        workspacePath: WORKSPACE_PATH,
        startedAt: STARTED_AT,
        now: () => STARTED_AT + 2_000,
      })

      expect(binding).toEqual({
        sessionId: MATCH_ID,
        capturedAt: Math.floor((STARTED_AT + 2_000) / 1000),
        startedAt: Math.floor(STARTED_AT / 1000),
        workspacePath: WORKSPACE_PATH,
        sourcePath: path,
      })
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not bind when more than one Codex session matches the same window', async () => {
    const root = tempRoot()
    try {
      writeCodexSessionFile({
        root,
        id: MATCH_ID,
        timestampMs: STARTED_AT + 1_000,
        cwd: WORKSPACE_PATH,
      })
      writeCodexSessionFile({
        root,
        id: OTHER_ID,
        timestampMs: STARTED_AT + 1_500,
        cwd: WORKSPACE_PATH,
        suffix: '-second',
      })

      await expect(captureCodexCliSession({
        codexSessionsRoot: root,
        workspacePath: WORKSPACE_PATH,
        startedAt: STARTED_AT,
      })).resolves.toBeNull()
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores sessions outside the launch time window or from non-TUI origins', async () => {
    const root = tempRoot()
    try {
      writeCodexSessionFile({
        root,
        id: MATCH_ID,
        timestampMs: STARTED_AT + 130_000,
        cwd: WORKSPACE_PATH,
      })
      writeCodexSessionFile({
        root,
        id: OTHER_ID,
        timestampMs: STARTED_AT + 1_000,
        cwd: WORKSPACE_PATH,
        originator: 'codex-exec',
        suffix: '-exec',
      })

      await expect(captureCodexCliSession({
        codexSessionsRoot: root,
        workspacePath: WORKSPACE_PATH,
        startedAt: STARTED_AT,
      })).resolves.toBeNull()
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('filters by file metadata before reading session metadata', async () => {
    const root = tempRoot()
    try {
      writeCodexSessionFile({
        root,
        id: MATCH_ID,
        timestampMs: STARTED_AT + 1_000,
        mtimeMs: STARTED_AT - 10_000,
        cwd: WORKSPACE_PATH,
      })

      await expect(captureCodexCliSession({
        codexSessionsRoot: root,
        workspacePath: WORKSPACE_PATH,
        startedAt: STARTED_AT,
      })).resolves.toBeNull()
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
