import type { UIMessageChunk } from 'ai'

import { providerChunk } from '../kit/chunk-mapper'
import { buildKimiToolInput, buildKimiToolOutput } from './tools/mapper'
import type { KimiSessionEvent } from './websocket/client'

export class KimiEventToChunkMapper {
  private readonly textBlocks = new Map<number, string>()
  private readonly thinkingBlocks = new Map<number, string>()
  private readonly textBlockCounts = new Map<number, number>()
  private readonly thinkingBlockCounts = new Map<number, number>()
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
        this.toolNames.set(payload.toolCallId, payload.name)
        this.toolArgs.set(payload.toolCallId, payload.args)
        return [
          ...this.closeActiveBlocks(payload.turnId),
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
    const activeId = this.textBlocks.get(turnId)
    if (activeId) {
      return [providerChunk.textDelta(activeId, delta)]
    }

    const id = this.nextBlockId('kimi-text', turnId, this.textBlockCounts)
    this.textBlocks.set(turnId, id)
    return [providerChunk.textStart(id), providerChunk.textDelta(id, delta)]
  }

  private mapThinking(turnId: number, delta: string): UIMessageChunk[] {
    const activeId = this.thinkingBlocks.get(turnId)
    if (activeId) {
      return [providerChunk.reasoningDelta(activeId, delta)]
    }

    const id = this.nextBlockId('kimi-thinking', turnId, this.thinkingBlockCounts)
    this.thinkingBlocks.set(turnId, id)
    return [providerChunk.reasoningStart(id), providerChunk.reasoningDelta(id, delta)]
  }

  private finish(reason: 'completed' | 'cancelled' | 'failed' | 'blocked'): UIMessageChunk[] {
    return [
      ...this.closeActiveBlocks(),
      providerChunk.finish(reason === 'failed' || reason === 'blocked' ? 'error' : 'stop'),
    ]
  }

  private closeActiveBlocks(turnId?: number): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    for (const [id, textBlockId] of this.textBlocks) {
      if (turnId !== undefined && id !== turnId) {
        continue
      }
      this.textBlocks.delete(id)
      chunks.push(providerChunk.textEnd(textBlockId))
    }
    for (const [id, thinkingBlockId] of this.thinkingBlocks) {
      if (turnId !== undefined && id !== turnId) {
        continue
      }
      this.thinkingBlocks.delete(id)
      chunks.push(providerChunk.reasoningEnd(thinkingBlockId))
    }
    return chunks
  }

  private nextBlockId(prefix: string, turnId: number, counts: Map<number, number>): string {
    const count = counts.get(turnId) ?? 0
    counts.set(turnId, count + 1)
    return count === 0 ? `${prefix}-${turnId}` : `${prefix}-${turnId}-${count}`
  }
}
