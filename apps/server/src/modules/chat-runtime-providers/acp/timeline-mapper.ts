import { randomUUID } from 'node:crypto'

import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

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
      chunks.push({ type: 'reasoning-end', id: this.currentReasoningItemId })
      this.currentReasoningItemId = null
    }

    if (this.currentMessageItemId) {
      chunks.push({ type: 'text-end', id: this.currentMessageItemId })
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
        { type: 'text-start', id: this.currentMessageItemId },
        { type: 'text-delta', id: this.currentMessageItemId, delta: text },
      ]
    }

    return [{ type: 'text-delta', id: this.currentMessageItemId, delta: text }]
  }

  private handleAgentThought(update: ContentChunk): UIMessageChunk[] {
    const text = extractText(update.content)
    if (text === null) {
      return []
    }

    if (!this.currentReasoningItemId) {
      this.currentReasoningItemId = randomUUID()
      return [
        { type: 'reasoning-start', id: this.currentReasoningItemId },
        { type: 'reasoning-delta', id: this.currentReasoningItemId, delta: text },
      ]
    }

    return [{ type: 'reasoning-delta', id: this.currentReasoningItemId, delta: text }]
  }

  private handleToolCall(update: ToolCall): UIMessageChunk[] {
    const output = stringifyPayload(update.rawOutput)
    const chunks: UIMessageChunk[] = [
      { type: 'tool-input-start', toolCallId: update.toolCallId, toolName: update.title },
    ]

    if (update.status === 'completed' && output) {
      chunks.push({ type: 'tool-output-available', toolCallId: update.toolCallId, output })
    }

    return chunks
  }

  private handleToolCallUpdate(update: ToolCallUpdate): UIMessageChunk[] {
    const output = stringifyPayload(update.rawOutput)
    const chunks: UIMessageChunk[] = []

    if (output) {
      chunks.push({ type: 'tool-input-delta', toolCallId: update.toolCallId, inputTextDelta: output })
    }

    if (update.status === 'completed') {
      chunks.push({ type: 'tool-output-available', toolCallId: update.toolCallId, output: output || '' })
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
