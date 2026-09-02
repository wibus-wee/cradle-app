import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveKimiProviderHome } from './runtime-home'
import {
  deleteKimiSessionStorage,
  listKimiStoredSessionIds,
  measureKimiSessionStorage,
} from './session-storage'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir: string

describe('kimi session storage', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-kimi-session-storage-'))
    process.env.CRADLE_DATA_DIR = dataDir
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
  })

  it('measures and deletes one exact session without touching its neighbor', () => {
    const home = seedProviderHome('target/a', ['session_one', 'session_two'])
    const measurement = measureKimiSessionStorage({
      providerTargetId: 'target/a',
      providerSessionId: 'session_one',
    })

    const result = deleteKimiSessionStorage({
      providerTargetId: 'target/a',
      providerSessionIds: ['session_one'],
      clearDerivedCache: true,
    })

    expect(measurement.bytes).toBeGreaterThan(0)
    expect(result).toMatchObject({ sessionCount: 1, indexEntriesRemoved: 1, cacheCleared: true })
    expect(existsSync(join(home, 'sessions', 'workspace', 'session_one'))).toBe(false)
    expect(existsSync(join(home, 'server', 'events', 'session_one.jsonl'))).toBe(false)
    expect(existsSync(join(home, 'cache', 'query-store'))).toBe(false)
    expect(existsSync(join(home, 'sessions', 'workspace', 'session_two', 'state.json'))).toBe(true)
    expect(readFileSync(join(home, 'session_index.jsonl'), 'utf8')).toContain('session_two')
    expect(readFileSync(join(home, 'session_index.jsonl'), 'utf8')).toContain('{broken')
  })

  it('discovers corrupt and journal-only sessions while refusing path traversal', () => {
    const home = seedProviderHome('target-b', ['session_corrupt'])
    writeFileSync(join(home, 'sessions', 'workspace', 'session_corrupt', 'state.json'), '{broken')
    writeFileSync(join(home, 'server', 'events', 'session_journal.jsonl'), 'event')
    symlinkSync(tmpdir(), join(home, 'sessions', 'workspace', 'session_link'))

    expect(listKimiStoredSessionIds('target-b')).toEqual(new Set([
      'session_corrupt',
      'session_journal',
      'session_link',
    ]))
    expect(() => deleteKimiSessionStorage({
      providerTargetId: 'target-b',
      providerSessionIds: ['../outside'],
    })).toThrow('safe path segment')
  })
})

function seedProviderHome(providerTargetId: string, sessionIds: string[]): string {
  const home = resolveKimiProviderHome(providerTargetId)
  mkdirSync(join(home, 'sessions', 'workspace'), { recursive: true })
  mkdirSync(join(home, 'server', 'events'), { recursive: true })
  mkdirSync(join(home, 'cache', 'query-store'), { recursive: true })
  const indexLines = sessionIds.map(sessionId => JSON.stringify({
    sessionId,
    sessionDir: join(home, 'sessions', 'workspace', sessionId),
    workDir: '/tmp',
  }))
  for (const sessionId of sessionIds) {
    mkdirSync(join(home, 'sessions', 'workspace', sessionId), { recursive: true })
    writeFileSync(join(home, 'sessions', 'workspace', sessionId, 'state.json'), `state:${sessionId}`)
    writeFileSync(join(home, 'server', 'events', `${sessionId}.jsonl`), `event:${sessionId}`)
  }
  writeFileSync(join(home, 'session_index.jsonl'), `${indexLines.join('\n')}\n{broken\n`)
  writeFileSync(join(home, 'cache', 'query-store', 'db.wal'), 'derived')
  return home
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  }
  else {
    process.env[name] = value
  }
}
