import { describe, expect, it } from 'vitest'

import { createKimiUsageEventId, KimiUsageEventProjector } from './usage-event-projector'
import type { KimiSessionEvent } from './websocket/client'

describe('kimi usage event projector', () => {
  it('projects exact turn usage, provider totals, cache subsets, and timestamp', () => {
    const projector = new KimiUsageEventProjector('session-1', 'kimi-k2.5')
    const event = projector.project(statusEvent())

    expect(event).toEqual({
      id: createKimiUsageEventId('main', '7'),
      providerThreadId: 'main',
      providerTurnId: '7',
      modelId: 'kimi-k2.5',
      occurredAt: 1_785_283_262,
      usage: {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 10,
      },
      providerTotal: {
        promptTokens: 510,
        completionTokens: 90,
        totalTokens: 600,
        cachedInputTokens: 400,
        cacheWriteInputTokens: 20,
      },
    })
  })

  it('retains turn and model identity across later status snapshots', () => {
    const projector = new KimiUsageEventProjector('session-1', null)
    projector.project(statusEvent())
    const event = projector.project({
      ...statusEvent(),
      payload: {
        type: 'agent.status.updated',
        usage: {
          currentTurn: {
            inputOther: 40,
            output: 40,
            inputCacheRead: 100,
            inputCacheCreation: 0,
          },
        },
      },
    })

    expect(event).toMatchObject({
      providerTurnId: '7',
      modelId: 'kimi-k2.5',
      usage: { totalTokens: 180 },
    })
  })
})

function statusEvent(): KimiSessionEvent {
  return {
    type: 'agent.status.updated',
    seq: 1,
    timestamp: '2026-07-29T00:01:02.345Z',
    session_id: 'session-1',
    agent_id: 'main',
    payload: {
      type: 'agent.status.updated',
      model: 'kimi-k2.5',
      phase: { kind: 'ended', turnId: 7 },
      usage: {
        currentTurn: {
          inputOther: 30,
          output: 30,
          inputCacheRead: 80,
          inputCacheCreation: 10,
        },
        total: {
          inputOther: 90,
          output: 90,
          inputCacheRead: 400,
          inputCacheCreation: 20,
        },
      },
    },
  }
}
