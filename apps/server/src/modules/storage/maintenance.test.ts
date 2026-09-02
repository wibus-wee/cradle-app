import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendSessionBindings, providerTargets, sessions } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import * as BackgroundActivity from '../background-activity/service'
import { resolveKimiProviderHome } from '../chat-runtime-providers/kimi/runtime-home'
import * as Maintenance from '../maintenance/service'
import {
  collectKimiOrphanSessionStorage,
  registerStorageMaintenance,
} from './maintenance'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir: string

describe('storage maintenance', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-storage-maintenance-'))
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()
  })

  afterEach(() => {
    Maintenance.reset()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
  })

  it('removes only unbound Kimi artifacts and derived cache', () => {
    seedBinding('target-a', 'chat-bound', 'session_bound')
    const home = resolveKimiProviderHome('target-a')
    seedNativeSession(home, 'session_bound', 'valid')
    seedNativeSession(home, 'session_orphan', '{broken')

    const result = collectKimiOrphanSessionStorage({ runningProviderTargetIds: new Set() })

    expect(result).toMatchObject({
      providerHomesScanned: 1,
      providerHomesSkipped: 0,
      sessionsDeleted: 1,
      indexEntriesRemoved: 1,
      cachesCleared: 1,
    })
    expect(existsSync(join(home, 'sessions', 'workspace', 'session_bound', 'state.json'))).toBe(true)
    expect(existsSync(join(home, 'sessions', 'workspace', 'session_orphan'))).toBe(false)
    expect(existsSync(join(home, 'cache', 'query-store'))).toBe(false)
  })

  it('skips running provider targets', () => {
    const home = resolveKimiProviderHome('target-running')
    seedNativeSession(home, 'session_orphan', '{broken')

    const result = collectKimiOrphanSessionStorage({
      runningProviderTargetIds: new Set(['target-running']),
    })

    expect(result.providerHomesSkipped).toBe(1)
    expect(result.sessionsDeleted).toBe(0)
    expect(existsSync(join(home, 'sessions', 'workspace', 'session_orphan'))).toBe(true)
  })

  it('removes damaged index-only state when a provider home has no bindings', () => {
    const home = resolveKimiProviderHome('target-empty')
    mkdirSync(join(home, 'cache', 'query-store'), { recursive: true })
    mkdirSync(join(home, 'server', 'events'), { recursive: true })
    writeFileSync(join(home, 'session_index.jsonl'), '{broken\n')
    writeFileSync(join(home, 'cache', 'query-store', 'db.wal'), 'derived')
    writeFileSync(join(home, 'server', 'events', '__global__.jsonl'), 'workspace event')

    const result = collectKimiOrphanSessionStorage({ runningProviderTargetIds: new Set() })

    expect(result.bytesFreed).toBeGreaterThan(0)
    expect(result.cachesCleared).toBe(1)
    expect(existsSync(join(home, 'session_index.jsonl'))).toBe(false)
    expect(existsSync(join(home, 'cache', 'query-store'))).toBe(false)
    expect(existsSync(join(home, 'server', 'events', '__global__.jsonl'))).toBe(true)
  })

  it('registers an observable and manually runnable Background Activity', () => {
    registerStorageMaintenance()
    expect(BackgroundActivity.list()).toContainEqual(expect.objectContaining({
      ownerNamespace: 'storage',
      key: 'collect-kimi-orphan-sessions',
      manuallyRunnable: true,
    }))
  })
})

function seedBinding(providerTargetId: string, chatSessionId: string, providerSessionId: string): void {
  db().insert(providerTargets).values({
    id: providerTargetId,
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: 'Kimi',
  }).run()
  db().insert(sessions).values({
    id: chatSessionId,
    title: 'Kimi session',
    providerTargetId,
    runtimeKind: 'kimi',
  }).run()
  db().insert(backendSessionBindings).values({
    id: `binding-${chatSessionId}`,
    chatSessionId,
    providerTargetId,
    runtimeKind: 'kimi',
    backendSessionId: providerSessionId,
  }).run()
}

function seedNativeSession(home: string, sessionId: string, state: string): void {
  mkdirSync(join(home, 'sessions', 'workspace', sessionId), { recursive: true })
  mkdirSync(join(home, 'server', 'events'), { recursive: true })
  mkdirSync(join(home, 'cache', 'query-store'), { recursive: true })
  writeFileSync(join(home, 'sessions', 'workspace', sessionId, 'state.json'), state)
  writeFileSync(join(home, 'server', 'events', `${sessionId}.jsonl`), `event:${sessionId}`)
  const indexPath = join(home, 'session_index.jsonl')
  const previous = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  writeFileSync(indexPath, `${previous}${JSON.stringify({ sessionId })}\n`)
  writeFileSync(join(home, 'cache', 'query-store', 'db.wal'), 'derived')
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  }
  else {
    process.env[name] = value
  }
}
