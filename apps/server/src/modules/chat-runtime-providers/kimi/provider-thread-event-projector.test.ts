import { describe, expect, it } from 'vitest'

import { getKimiEventAgentId, KimiProviderThreadEventProjector } from './provider-thread-event-projector'
import type { KimiSessionEvent } from './websocket/client'

describe('kimi provider thread event projector', () => {
  it('keeps child-agent mapper state isolated from the parent transcript', () => {
    const projector = new KimiProviderThreadEventProjector()
    const text = projector.project(event({ type: 'assistant.delta', agentId: 'agent-2', turnId: 4, delta: 'Child' }))
    const finish = projector.project(event({ type: 'turn.ended', agentId: 'agent-2', turnId: 4, reason: 'completed' }))

    expect(text).toMatchObject({
      providerThreadId: 'agent-2',
      providerTurnId: '4',
      chunks: [
        { type: 'text-start', id: 'kimi-text-4' },
        { type: 'text-delta', id: 'kimi-text-4', delta: 'Child' },
      ],
    })
    expect(finish?.chunks.map(chunk => chunk.type)).toEqual(['text-end', 'data-runtime-event', 'finish'])
  })

  it('does not project main-agent events as provider threads', () => {
    const projector = new KimiProviderThreadEventProjector()
    expect(projector.project(event({ type: 'assistant.delta', agentId: 'main', turnId: 1, delta: 'Main' }))).toBeNull()
  })

  it('falls back to the envelope agent id', () => {
    const candidate = event({ type: 'assistant.delta', turnId: 1, delta: 'Child' })
    candidate.agent_id = 'agent-envelope'
    expect(getKimiEventAgentId(candidate)).toBe('agent-envelope')
  })
})

function event(payload: KimiSessionEvent['payload']): KimiSessionEvent {
  return {
    type: payload.type,
    seq: 1,
    timestamp: '2026-08-30T00:00:00.000Z',
    session_id: 'session-1',
    payload,
  }
}
