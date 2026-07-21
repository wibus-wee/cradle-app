import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendSessionBindings, providerTargets, sessions, usageLogs } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { createClaudeUsageEventId } from './usage-event-projector'
import { reconcileCompletedCradleClaudeUsage } from './usage-reconciliation'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir = ''
let runtimeHome = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-claude-usage-reconciliation-'))
  runtimeHome = join(dataDir, 'claude-runtime')
  mkdirSync(join(runtimeHome, 'projects', 'project-one'), { recursive: true })
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

describe('completed Claude usage reconciliation', () => {
  it('replays completed bindings and replaces partial duplicate message usage', async () => {
    db().insert(providerTargets).values({
      id: 'anthropic-target',
      kind: 'manual',
      providerKind: 'anthropic',
      displayName: 'Anthropic',
      enabled: true,
      connectionConfigJson: JSON.stringify({ authMode: 'apiKey' }),
      enabledModelsJson: '[]',
      customModelsJson: '[]',
    }).run()
    db().insert(sessions).values([
      { id: 'session-completed', title: 'Completed', runtimeKind: 'claude-agent' },
      { id: 'session-pending', title: 'Pending', runtimeKind: 'claude-agent' },
    ]).run()
    db().insert(backendSessionBindings).values([
      {
        id: 'binding-completed',
        chatSessionId: 'session-completed',
        providerTargetId: 'anthropic-target',
        runtimeKind: 'claude-agent',
        backendSessionId: 'claude-session-completed',
        usageReconciliationStatus: 'completed',
      },
      {
        id: 'binding-pending',
        chatSessionId: 'session-pending',
        providerTargetId: 'anthropic-target',
        runtimeKind: 'claude-agent',
        backendSessionId: 'claude-session-pending',
        usageReconciliationStatus: 'pending',
      },
    ]).run()
    db().insert(usageLogs).values({
      id: createClaudeUsageEventId('claude-session-completed', 'claude-session-completed', 'msg-1'),
      sessionId: 'session-completed',
      providerTargetId: 'anthropic-target',
      providerSessionId: 'claude-session-completed',
      providerThreadId: 'claude-session-completed',
      providerTurnId: 'msg-1',
      modelId: 'claude-opus-4-8',
      promptTokens: 811,
      completionTokens: 0,
      totalTokens: 811,
      providerTotalPromptTokens: 811,
      providerTotalCompletionTokens: 0,
      providerTotalTokens: 811,
      createdAt: 1_789_000_000,
    }).run()
    writeFileSync(join(runtimeHome, 'projects', 'project-one', 'claude-session-completed.jsonl'), [
      JSON.stringify(assistantRecord({ inputTokens: 811, outputTokens: 0 })),
      JSON.stringify(assistantRecord({ inputTokens: 811, outputTokens: 200 })),
    ].join('\n'))

    await expect(reconcileCompletedCradleClaudeUsage({ runtimeHome, maxBindings: 1_000 })).resolves.toMatchObject({
      bindings: 1,
      transcripts: 1,
      inserted: 0,
      duplicates: 2,
      incidents: 0,
    })

    expect(db().select().from(usageLogs).where(eq(usageLogs.providerTurnId, 'msg-1')).get()).toEqual(
      expect.objectContaining({ promptTokens: 811, completionTokens: 200, totalTokens: 1_011 }),
    )
    expect(db().select().from(backendSessionBindings).where(eq(backendSessionBindings.id, 'binding-pending')).get()).toEqual(
      expect.objectContaining({ usageReconciliationStatus: 'pending' }),
    )
  })
})

function assistantRecord(input: { inputTokens: number, outputTokens: number }) {
  return {
    type: 'assistant',
    sessionId: 'claude-session-completed',
    timestamp: '2026-07-21T08:00:00.000Z',
    message: {
      id: 'msg-1',
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
      },
    },
  }
}
