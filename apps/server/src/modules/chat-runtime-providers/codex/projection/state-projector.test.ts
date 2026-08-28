import { describe, expect, it } from 'vitest'

import type { RuntimeSession } from '../../../chat-runtime/runtime-provider-types'
import { decodeCodexDurableCheckpoint } from '../state/durable-checkpoint'
import { projectCodexProviderStateSnapshot, readCodexProviderSnapshot } from './state-projector'

function legacySnapshot(turns: unknown[]): string {
  return JSON.stringify({
    workspacePath: '/tmp/workspace',
    models: { currentModelId: 'gpt-5-codex' },
    codex: {
      compact: {
        threadId: 'thread-1',
        tokenUsage: {
          total: { totalTokens: 10_000 },
          last: { totalTokens: 2_500 },
          modelContextWindow: 200_000,
        },
      },
      nativeHistory: { threadId: 'thread-1', turns },
      previousNativeHistory: { threadId: 'old-thread', turns },
    },
  })
}

describe('decodeCodexDurableCheckpoint', () => {
  it('keeps only native aggregate usage regardless of rollout size', () => {
    const small = decodeCodexDurableCheckpoint(legacySnapshot([{ id: 'turn-1' }]))
    const large = decodeCodexDurableCheckpoint(legacySnapshot(Array.from(
      { length: 1_000 },
      (_, index) => ({ id: `turn-${index}`, output: 'x'.repeat(10_000) }),
    )))

    expect(small.didNormalize).toBe(true)
    expect(large.didNormalize).toBe(true)
    expect(large.serialized).toBe(small.serialized)
    expect(large.checkpoint.codex).not.toHaveProperty('nativeHistory')
    expect(large.checkpoint.codex).not.toHaveProperty('previousNativeHistory')
    expect(large.checkpoint.codex.contextUsage).toMatchObject({
      last: { totalTokens: 2_500 },
      modelContextWindow: 200_000,
    })
  })

  it('is idempotent for a normalized checkpoint', () => {
    const first = decodeCodexDurableCheckpoint(legacySnapshot([]))
    const second = decodeCodexDurableCheckpoint(first.serialized)

    expect(second.didNormalize).toBe(false)
    expect(second.serialized).toBe(first.serialized)
  })
})

describe('codex automatic approval review projection', () => {
  it('preserves the reviewer label, risk, and rationale for the UI slot', () => {
    const runtimeSession: RuntimeSession = {
      id: 'runtime-session-1',
      chatSessionId: 'chat-session-1',
      runtimeKind: 'codex',
      providerTargetId: 'target-1',
      providerSessionId: 'thread-1',
      providerStateSnapshot: null,
    }

    projectCodexProviderStateSnapshot(runtimeSession, {
      method: 'item/autoApprovalReview/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        reviewId: 'review-1',
        targetItemId: 'command-1',
        action: { type: 'command' },
        review: {
          status: 'approved',
          riskLevel: 'medium',
          rationale: 'Command is limited to the workspace.',
        },
      },
    }, 'thread-1')

    expect(readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.approvals?.items).toEqual([
      expect.objectContaining({
        id: 'review-1',
        label: 'Auto review · Command',
        status: 'approved',
        riskLevel: 'medium',
        rationale: 'Command is limited to the workspace.',
      }),
    ])
  })
})
