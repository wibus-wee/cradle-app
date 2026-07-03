import { randomUUID } from 'node:crypto'

import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

import { providerChunk } from '../kit/chunk-mapper'

export class AcpChunkMapper {
  private currentMessageItemId: string | null = null
  private currentReasoningItemId: string | null = null

  convert(update: SessionUpdate): UIMessageChunk[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return this.handleAgentMessage(update as ContentChunk & { sessionUpdate: 'agent_message_chunk' })
      case 'agent_thought_chunk':
        return this.handleAgentThought(update as ContentChunk & { sessionUpdate: 'agent_thought_chunk' })
      case 'tool_call':
        return this.handleToolCall(update as ToolCall & { sessionUpdate: 'tool_call' })
      case 'tool_call_update':
        return this.handleToolCallUpdate(update as ToolCallUpdate & { sessionUpdate: 'tool_call_update' })
      default:
        return []
    }
  }

  flush(): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []

    if (this.currentReasoningItemId) {
      chunks.push(providerChunk.reasoningEnd(this.currentReasoningItemId))
      this.currentReasoningItemId = null
    }

    if (this.currentMessageItemId) {
      chunks.push(providerChunk.textEnd(this.currentMessageItemId))
      this.currentMessageItemId = null
    }

    return chunks
  }

  private handleAgentMessage(update: ContentChunk): UIMessageChunk[] {
    const text = extractText(update.content)
    if (text === null) {
      return []
    }

    if (!this.currentMessageItemId) {
      this.currentMessageItemId = randomUUID()
      return [
        providerChunk.textStart(this.currentMessageItemId),
        providerChunk.textDelta(this.currentMessageItemId, text),
      ]
    }

    return [providerChunk.textDelta(this.currentMessageItemId, text)]
  }

  private handleAgentThought(update: ContentChunk): UIMessageChunk[] {
    const text = extractText(update.content)
    if (text === null) {
      return []
    }

    if (!this.currentReasoningItemId) {
      this.currentReasoningItemId = randomUUID()
      return [
        providerChunk.reasoningStart(this.currentReasoningItemId),
        providerChunk.reasoningDelta(this.currentReasoningItemId, text),
      ]
    }

    return [providerChunk.reasoningDelta(this.currentReasoningItemId, text)]
  }

  private handleToolCall(update: ToolCall): UIMessageChunk[] {
    const output = stringifyPayload(update.rawOutput)
    const chunks: UIMessageChunk[] = [
      providerChunk.toolInputStart(update.toolCallId, update.title),
    ]

    if (update.status === 'completed' && output) {
      chunks.push(providerChunk.toolOutputAvailable({ toolCallId: update.toolCallId, output }))
    }

    return chunks
  }

  private handleToolCallUpdate(update: ToolCallUpdate): UIMessageChunk[] {
    const output = stringifyPayload(update.rawOutput)
    const chunks: UIMessageChunk[] = []

    if (output) {
      chunks.push(providerChunk.toolInputDelta(update.toolCallId, output))
    }

    if (update.status === 'completed') {
      chunks.push(providerChunk.toolOutputAvailable({ toolCallId: update.toolCallId, output: output || '' }))
    }

    return chunks
  }
}

function extractText(block: ContentBlock): string | null {
  return block.type === 'text' ? block.text : null
}

function stringifyPayload(value: unknown): string | null {
  if (value === undefined) {
    return null
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}
