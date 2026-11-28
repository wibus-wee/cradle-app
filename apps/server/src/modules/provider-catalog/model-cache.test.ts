import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerTargets } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  clearAllProviderTargetContextWindows,
  getProviderTargetContextWindow,
} from '../model-registry/provider-target-context-windows'
import {
  clearCachedModelRefreshFailure,
  deleteCachedModelsForTarget,
  getCachedModelRefreshFailure,
  setCachedModelRefreshFailure,
  setCachedModelsForTarget,
  warmupProviderTargetContextWindows,
} from './model-cache'

const target = { kind: 'manual' as const, id: 'negative-cache-test-target' }

afterEach(() => {
  clearCachedModelRefreshFailure(target)
})

describe('provider model refresh failure cache', () => {
  it('holds a short-lived failure marker until a later successful refresh clears it', () => {
    expect(getCachedModelRefreshFailure(target)).toBeNull()

    setCachedModelRefreshFailure(target)
    expect(getCachedModelRefreshFailure(target)).toMatchObject({
      retryAfter: expect.any(Number),
    })

    clearCachedModelRefreshFailure(target)
    expect(getCachedModelRefreshFailure(target)).toBeNull()
  })
})

describe('provider target context windows', () => {
  it('publishes declared windows on write and republishes them after a restart', async () => {
    await withTempDataDir(() => {
      insertProviderTarget('target-a')
      insertProviderTarget('target-b')
      const sol = (contextWindow: number) => ({
        id: 'codex/gpt-6.2-sol',
        label: 'GPT-6.2-Sol',
        providerKind: 'openai-compatible' as const,
        capabilities: { contextWindow },
      })

      setCachedModelsForTarget({ kind: 'manual', id: 'target-a' }, [sol(500_000)])
      setCachedModelsForTarget({ kind: 'manual', id: 'target-b' }, [sol(200_000)])

      // Same model id, different served windows per target.
      expect(getProviderTargetContextWindow('target-a', 'codex/gpt-6.2-sol')).toBe(500_000)
      expect(getProviderTargetContextWindow('target-b', 'codex/gpt-6.2-sol')).toBe(200_000)

      // A restart drops memory; the boot warmup restores it from the cache rows.
      clearAllProviderTargetContextWindows()
      expect(getProviderTargetContextWindow('target-a', 'codex/gpt-6.2-sol')).toBeNull()
      warmupProviderTargetContextWindows()
      expect(getProviderTargetContextWindow('target-a', 'codex/gpt-6.2-sol')).toBe(500_000)
      expect(getProviderTargetContextWindow('target-b', 'codex/gpt-6.2-sol')).toBe(200_000)

      // Deleting the inventory drops the target's windows again.
      deleteCachedModelsForTarget({ kind: 'manual', id: 'target-a' })
      expect(getProviderTargetContextWindow('target-a', 'codex/gpt-6.2-sol')).toBeNull()
      expect(getProviderTargetContextWindow('target-b', 'codex/gpt-6.2-sol')).toBe(200_000)
    })
  })
})

function insertProviderTarget(id: string): void {
  db().insert(providerTargets).values({
    id,
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: id,
    connectionConfigJson: '{}',
    enabledModelsJson: '[]',
    customModelsJson: '[]',
  }).run()
}

async function withTempDataDir<T>(callback: () => T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-model-cache-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH
  try {
    return callback()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
    if (previousDbPath !== undefined) {
      process.env.CRADLE_DB_PATH = previousDbPath
    }
  }
}
