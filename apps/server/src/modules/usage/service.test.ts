import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendSessionBindings, providerTargets, sessions, usageLogs } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import type { CodexThreadUsageDiagnostics } from '../chat-runtime-providers/codex/app-server/account-diagnostics'
import { getSessionUsageWithProviderBillingCheck } from './service'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-session-usage-'))
  process.env.CRADLE_DATA_DIR = dataDir
})

afterEach(() => {
  shutdownInfra()
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

describe('getSessionUsageWithProviderBillingCheck', () => {
  it('returns Codex thread usage as a non-ledger billing check', async () => {
    db().insert(providerTargets).values({
      id: 'codex-target',
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'Codex',
    }).run()
    db().insert(sessions).values({
      id: 'session-1',
      title: 'Session',
      runtimeKind: 'codex',
    }).run()
    db().insert(backendSessionBindings).values({
      id: 'binding-1',
      chatSessionId: 'session-1',
      providerTargetId: 'codex-target',
      runtimeKind: 'codex',
      backendSessionId: 'thread-1',
      usageReconciliationStatus: 'completed',
    }).run()
    db().insert(usageLogs).values({
      id: 'provider-event-1',
      sessionId: 'session-1',
      providerTargetId: 'codex-target',
      providerSessionId: 'thread-1',
      providerThreadId: 'thread-1',
      providerTurnId: 'turn-1',
      modelId: 'gpt-5.6-sol',
      promptTokens: 80,
      completionTokens: 20,
      totalTokens: 100,
      createdAt: 1_789_000_000,
    }).run()

    const readThreadUsage = vi.fn(async (): Promise<CodexThreadUsageDiagnostics> => ({
      source: 'codex.account.usage.thread',
      threadId: 'thread-1',
      estimatedUsageCreditsMicros: '12500',
      estimatedUsageUsdMicros: '7500',
      groups: [{
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        speed: 'fast',
        estimatedUsageCreditsMicros: '12500',
        netNewInputTokens: '80',
        cachedInputTokens: '20',
        inputTokens: '100',
        outputTokens: '25',
        totalTokens: '125',
      }],
    }))

    const result = await getSessionUsageWithProviderBillingCheck('session-1', readThreadUsage)

    expect(result).toMatchObject({
      totalTokens: 100,
      promptTokens: 80,
      completionTokens: 20,
      count: 1,
      providerBillingCheck: {
        source: 'codex.account.usage.thread',
        status: 'available',
        reason: null,
        threadId: 'thread-1',
        reconciliationStatus: 'completed',
        estimatedUsageCreditsMicros: '12500',
        estimatedUsageUsdMicros: '7500',
        providerTotalTokens: '125',
        ledgerTotalTokens: 100,
        tokenDelta: '25',
      },
    })
    expect(readThreadUsage).toHaveBeenCalledWith({
      providerTargetId: 'codex-target',
      threadId: 'thread-1',
    })
    expect(db().select().from(usageLogs).all()).toEqual([
      expect.objectContaining({ id: 'provider-event-1', totalTokens: 100 }),
    ])
  })
})
