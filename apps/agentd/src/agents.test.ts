import type { UIMessage } from 'ai'
import type { RemoteAgentTurnEvent } from '@cradle/remote-agent-protocol'
import { describe, expect, it } from 'vitest'

import { AgentRegistry } from './agents'

function userMessage(text: string): UIMessage {
  return {
    id: 'user-message-1',
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

describe('AgentRegistry', () => {
  it('starts, lists, and streams a mock turn derived from input text', async () => {
    const registry = new AgentRegistry()
    const started = registry.start({
      runtimeKind: 'mock-remote',
      workspacePath: '/workspace',
      chatSessionId: 'session-1',
      modelId: null,
    })

    expect(registry.list()).toEqual({
      agents: [expect.objectContaining({
        agentId: started.agent.agentId,
        runtimeKind: 'mock-remote',
        workspacePath: '/workspace',
        status: 'idle',
      })],
    })

    const events: RemoteAgentTurnEvent[] = []
    for await (const event of registry.turn({
      remoteAgentId: started.agent.agentId,
      chatSessionId: 'session-1',
      runId: 'run-1',
      message: userMessage('hello daemon'),
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { kind: 'chunk', chunk: { type: 'text-start', id: 'remote-mock-text-run-1' } },
      { kind: 'chunk', chunk: { type: 'text-delta', id: 'remote-mock-text-run-1', delta: 'Remote mock response: hello daemon' } },
      { kind: 'chunk', chunk: { type: 'text-end', id: 'remote-mock-text-run-1' } },
      { kind: 'chunk', chunk: { type: 'finish', finishReason: 'stop' } },
    ])
    expect(registry.attach({ remoteAgentId: started.agent.agentId }).agent.status).toBe('idle')
  })
})
