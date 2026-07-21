import type { UIMessageChunk } from 'ai'

import { providerChunk } from '../kit/chunk-mapper'
import { buildKimiToolInput, buildKimiToolOutput } from './tools/mapper'
import type { KimiSessionEvent } from './websocket/client'

export class KimiEventToChunkMapper {
  private readonly textBlocks = new Set<number>()
  private readonly thinkingBlocks = new Set<number>()
  private readonly tools = new Set<string>()
  private readonly toolNames = new Map<string, string>()
  private readonly toolArgs = new Map<string, unknown>()

  map(event: KimiSessionEvent): UIMessageChunk[] {
    const payload = event.payload
    switch (payload.type) {
      case 'assistant.delta':
        return this.mapText(payload.turnId, payload.delta)
      case 'thinking.delta':
        return this.mapThinking(payload.turnId, payload.delta)
      case 'tool.call.started':
        this.tools.add(payload.toolCallId)
        this.toolNames.set(payload.toolCallId, payload.name)
        this.toolArgs.set(payload.toolCallId, payload.args)
        return [
          providerChunk.toolInputStart(payload.toolCallId, payload.name),
          providerChunk.toolInputAvailable({ toolCallId: payload.toolCallId, toolName: payload.name, input: buildKimiToolInput(payload.name, payload.args) }),
        ]
      case 'tool.call.delta':
        return payload.argumentsPart ? [providerChunk.toolInputDelta(payload.toolCallId, payload.argumentsPart)] : []
      case 'tool.progress':
        return [providerChunk.toolOutputAvailable({
          toolCallId: payload.toolCallId,
          output: buildKimiToolOutput(this.toolNames.get(payload.toolCallId) ?? 'unknown', this.toolArgs.get(payload.toolCallId), payload.update),
          preliminary: true,
        })]
      case 'tool.result':
        return payload.isError
          ? [providerChunk.toolOutputError(payload.toolCallId, String(payload.output))]
          : [providerChunk.toolOutputAvailable({ toolCallId: payload.toolCallId, output: buildKimiToolOutput(this.toolNames.get(payload.toolCallId) ?? 'unknown', this.toolArgs.get(payload.toolCallId), payload.output) })]
      case 'turn.ended':
        return this.finish(payload.reason)
      default:
        return []
    }
  }

  private mapText(turnId: number, delta: string): UIMessageChunk[] {
    const id = `kimi-text-${turnId}`
    const started = this.textBlocks.has(turnId)
    this.textBlocks.add(turnId)
    return started ? [providerChunk.textDelta(id, delta)] : [providerChunk.textStart(id), providerChunk.textDelta(id, delta)]
  }

  private mapThinking(turnId: number, delta: string): UIMessageChunk[] {
    const id = `kimi-thinking-${turnId}`
    const started = this.thinkingBlocks.has(turnId)
    this.thinkingBlocks.add(turnId)
    return started ? [providerChunk.reasoningDelta(id, delta)] : [providerChunk.reasoningStart(id), providerChunk.reasoningDelta(id, delta)]
  }

  private finish(reason: 'completed' | 'cancelled' | 'failed' | 'blocked'): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    for (const turnId of this.textBlocks) { chunks.push(providerChunk.textEnd(`kimi-text-${turnId}`)) }
    for (const turnId of this.thinkingBlocks) { chunks.push(providerChunk.reasoningEnd(`kimi-thinking-${turnId}`)) }
    chunks.push(providerChunk.finish(reason === 'failed' || reason === 'blocked' ? 'error' : 'stop'))
    return chunks
  }
}
