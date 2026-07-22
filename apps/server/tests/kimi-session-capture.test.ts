import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { captureKimiCliSession } from '../src/modules/pty/kimi-session-capture'

const WORKSPACE_PATH = '/tmp/cradle-kimi-workspace'
const MATCH_ID = 'session_8823d99b-b299-4e12-a7b7-9af282e37cd0'
const OTHER_ID = 'session_9a0b1c2d-3e4f-5678-9abc-def012345678'
const STARTED_AT = Date.parse('2026-05-19T10:00:00.000Z')

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-kimi-capture-'))
}

function writeKimiSession(input: {
  home: string
  id: string
  workDir: string
  createdAtMs: number
  suffix?: string
}): string {
  const sessionDir = join(input.home, 'sessions', `wd_fixture${input.suffix ?? ''}`, input.id)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
    createdAt: new Date(input.createdAtMs).toISOString(),
    updatedAt: new Date(input.createdAtMs + 1_000).toISOString(),
    workDir: input.workDir,
    title: 'Fixture session',
  }))
  return sessionDir
}

function writeIndex(home: string, entries: Array<{ id: string, sessionDir: string, workDir: string }>): void {
  writeFileSync(join(home, 'session_index.jsonl'), `${entries.map(entry => JSON.stringify({
    sessionId: entry.id,
    sessionDir: entry.sessionDir,
    workDir: entry.workDir,
  })).join('\n')}\n`)
}

describe('kimi cli session capture', () => {
  it('captures the unique session matching workDir and launch time', async () => {
    const home = tempHome()
    try {
      const sessionDir = writeKimiSession({
        home,
        id: MATCH_ID,
        workDir: WORKSPACE_PATH,
        createdAtMs: STARTED_AT + 1_000,
      })
      const otherDir = writeKimiSession({
        home,
        id: OTHER_ID,
        workDir: '/tmp/other-workspace',
        createdAtMs: STARTED_AT + 1_000,
        suffix: '-other',
      })
      writeIndex(home, [
        { id: MATCH_ID, sessionDir, workDir: WORKSPACE_PATH },
        { id: OTHER_ID, sessionDir: otherDir, workDir: '/tmp/other-workspace' },
      ])

      await expect(captureKimiCliSession({
        kimiCodeHome: home,
        workspacePath: WORKSPACE_PATH,
        startedAt: STARTED_AT,
        now: () => STARTED_AT + 2_000,
      })).resolves.toEqual({
        sessionId: MATCH_ID,
        capturedAt: Math.floor((STARTED_AT + 2_000) / 1000),
        startedAt: Math.floor(STARTED_AT / 1000),
        workspacePath: WORKSPACE_PATH,
        sourcePath: join(sessionDir, 'state.json'),
      })
    }
    finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses ambiguous matches and ignores old or wrong-workspace sessions', async () => {
    const home = tempHome()
    try {
      const firstDir = writeKimiSession({
        home,
        id: MATCH_ID,
        workDir: WORKSPACE_PATH,
        createdAtMs: STARTED_AT + 1_000,
      })
      const secondDir = writeKimiSession({
        home,
        id: OTHER_ID,
        workDir: WORKSPACE_PATH,
        createdAtMs: STARTED_AT + 1_500,
        suffix: '-second',
      })
      const oldDir = writeKimiSession({
        home,
        id: 'session_old',
        workDir: WORKSPACE_PATH,
        createdAtMs: STARTED_AT - 130_000,
        suffix: '-old',
      })
      writeIndex(home, [
        { id: MATCH_ID, sessionDir: firstDir, workDir: WORKSPACE_PATH },
        { id: OTHER_ID, sessionDir: secondDir, workDir: WORKSPACE_PATH },
        { id: 'session_old', sessionDir: oldDir, workDir: WORKSPACE_PATH },
      ])

      await expect(captureKimiCliSession({
        kimiCodeHome: home,
        workspacePath: WORKSPACE_PATH,
        startedAt: STARTED_AT,
      })).resolves.toBeNull()
    }
    finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses the launch environment home and honors index deletions', async () => {
    const home = tempHome()
    try {
      const sessionDir = writeKimiSession({
        home,
        id: MATCH_ID,
        workDir: WORKSPACE_PATH,
        createdAtMs: STARTED_AT + 1_000,
      })
      writeFileSync(join(home, 'session_index.jsonl'), `${[
        JSON.stringify({ sessionId: MATCH_ID, sessionDir, workDir: WORKSPACE_PATH }),
        JSON.stringify({ sessionId: MATCH_ID, deleted: true }),
      ].join('\n')}\n`)

      await expect(captureKimiCliSession({
        env: { KIMI_CODE_HOME: home },
        workspacePath: WORKSPACE_PATH,
        startedAt: STARTED_AT,
      })).resolves.toBeNull()
    }
    finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
