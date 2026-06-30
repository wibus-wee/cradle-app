import { randomUUID } from 'node:crypto'

import type { UIMessage, UIMessageChunk } from 'ai'

import type {
  AgentAttachParams,
  AgentCancelParams,
  AgentStartParams,
  AgentSteerParams,
  RemoteAgentSummary,
  RemoteAgentTurnEvent,
  RemoteAgentTurnParams,
} from '@cradle/remote-agent-protocol'

interface AgentRecord extends RemoteAgentSummary {}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>()

  list(): { agents: RemoteAgentSummary[] } {
    return { agents: Array.from(this.agents.values()) }
  }

  start(rawParams: unknown): { agent: RemoteAgentSummary } {
    const params = rawParams as AgentStartParams
    if (params.runtimeKind !== 'mock-remote') {
      throw new Error(`Unsupported runtime: ${params.runtimeKind}`)
    }
    const now = Date.now()
    const agent: AgentRecord = {
      agentId: randomUUID(),
      runtimeKind: params.runtimeKind,
      workspacePath: params.workspacePath,
      status: 'idle',
      providerSessionId: params.providerSessionId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.agents.set(agent.agentId, agent)
    return { agent }
  }

  attach(rawParams: unknown): { agent: RemoteAgentSummary } {
    const params = rawParams as AgentAttachParams
    return { agent: this.requireAgent(params.remoteAgentId) }
  }

  cancel(rawParams: unknown): { cancelled: boolean } {
    const params = rawParams as AgentCancelParams
    const agent = this.requireAgent(params.remoteAgentId)
    agent.status = 'idle'
    agent.updatedAt = Date.now()
    return { cancelled: true }
  }

  steer(rawParams: unknown): { accepted: boolean } {
    const params = rawParams as AgentSteerParams
    this.requireAgent(params.remoteAgentId)
    return { accepted: true }
  }

  async* turn(rawParams: unknown): AsyncGenerator<RemoteAgentTurnEvent, void, void> {
    const params = rawParams as RemoteAgentTurnParams
    const agent = this.requireAgent(params.remoteAgentId)
    agent.status = 'running'
    agent.updatedAt = Date.now()
    const textId = `remote-mock-text-${params.runId}`
    const text = `Remote mock response: ${readMessageText(params.message) || '(empty)'}`
    const chunks: UIMessageChunk[] = [
      { type: 'text-start', id: textId },
      { type: 'text-delta', id: textId, delta: text },
      { type: 'text-end', id: textId },
      { type: 'finish', finishReason: 'stop' },
    ]
    try {
      for (const chunk of chunks) {
        yield { kind: 'chunk', chunk }
      }
    }
    finally {
      agent.status = 'idle'
      agent.updatedAt = Date.now()
    }
  }

  private requireAgent(agentId: string): AgentRecord {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Remote agent not found: ${agentId}`)
    }
    return agent
  }
}

function readMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => {
      if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .join('')
    .trim()
}
