import type { UIMessageChunk } from 'ai'

import { providerChunk } from '../kit/chunk-mapper'
import { buildKimiToolInput, buildKimiToolOutput } from './tools/mapper'
import type { KimiTranscriptTurn } from './transcript-projector'
import { readKimiTranscriptTurnSequence } from './transcript-projector'
import type { KimiSessionEvent } from './websocket/client'

export class KimiEventToChunkMapper {
  private readonly textBlocks = new Map<number, string>()
  private readonly thinkingBlocks = new Map<number, string>()
  private readonly textBlockCounts = new Map<number, number>()
  private readonly thinkingBlockCounts = new Map<number, number>()
  private readonly toolNames = new Map<string, string>()
  private readonly toolArgs = new Map<string, unknown>()
  private readonly completedToolCalls = new Set<string>()
  private readonly emittedTextByTurn = new Map<number, string>()
  private readonly emittedThinkingByTurn = new Map<number, string>()

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
        this.completedToolCalls.add(payload.toolCallId)
        return payload.isError
          ? [providerChunk.toolOutputError(payload.toolCallId, String(payload.output))]
          : [providerChunk.toolOutputAvailable({ toolCallId: payload.toolCallId, output: buildKimiToolOutput(this.toolNames.get(payload.toolCallId) ?? 'unknown', this.toolArgs.get(payload.toolCallId), payload.output) })]
      case 'turn.ended':
        return this.finishTurn({
          turnId: payload.turnId,
          reason: payload.reason,
          interruptReason: payload.interruptReason,
          durationMs: payload.durationMs,
          error: payload.error,
        })
      default:
        return []
    }
  }

  finishFromRecovery(reason: 'completed' | 'cancelled' | 'failed' | 'blocked'): UIMessageChunk[] {
    return this.finishTurn({ reason })
  }

  reconcileTranscriptTurn(turn: KimiTranscriptTurn): UIMessageChunk[] {
    const turnId = readKimiTranscriptTurnSequence(turn.turnId)
    if (turnId === null) {
      return []
    }
    const chunks: UIMessageChunk[] = []
    let expectedText = ''
    let expectedThinking = ''
    for (const step of turn.steps) {
      for (const frame of step.frames) {
        switch (frame.kind) {
          case 'text':
            if (frame.role !== 'assistant') {
              break
            }
            expectedText += frame.text
            chunks.push(...this.reconcileText(turnId, expectedText))
            break
          case 'thinking':
            expectedThinking += frame.text
            chunks.push(...this.reconcileThinking(turnId, expectedThinking))
            break
          case 'tool':
            chunks.push(...this.reconcileTool(turnId, frame))
            break
          case 'notice':
            if (frame.level !== 'info') {
              chunks.push(
                ...this.closeActiveBlocks(turnId),
                providerChunk.runtimeWarning({
                  message: frame.message,
                  additionalDetails: readKimiNoticeDetails(frame.detail),
                }),
              )
            }
            break
        }
      }
    }
    return chunks
  }

  private mapText(turnId: number, delta: string): UIMessageChunk[] {
    this.emittedTextByTurn.set(turnId, `${this.emittedTextByTurn.get(turnId) ?? ''}${delta}`)
    const activeId = this.textBlocks.get(turnId)
    if (activeId) {
      return [providerChunk.textDelta(activeId, delta)]
    }

    const id = this.nextBlockId('kimi-text', turnId, this.textBlockCounts)
    this.textBlocks.set(turnId, id)
    return [providerChunk.textStart(id), providerChunk.textDelta(id, delta)]
  }

  private mapThinking(turnId: number, delta: string): UIMessageChunk[] {
    this.emittedThinkingByTurn.set(turnId, `${this.emittedThinkingByTurn.get(turnId) ?? ''}${delta}`)
    const activeId = this.thinkingBlocks.get(turnId)
    if (activeId) {
      return [providerChunk.reasoningDelta(activeId, delta)]
    }

    const id = this.nextBlockId('kimi-thinking', turnId, this.thinkingBlockCounts)
    this.thinkingBlocks.set(turnId, id)
    return [providerChunk.reasoningStart(id), providerChunk.reasoningDelta(id, delta)]
  }

  private finishTurn(input: {
    turnId?: number
    reason: 'completed' | 'cancelled' | 'failed' | 'blocked'
    interruptReason?: 'user_cancelled' | 'aborted' | 'max_steps' | 'error' | 'filtered' | 'blocked'
    durationMs?: number
    error?: { code: string, message: string, retryable: boolean }
  }): UIMessageChunk[] {
    const interruptIsFailure = input.interruptReason === 'max_steps'
      || input.interruptReason === 'error'
      || input.interruptReason === 'filtered'
      || input.interruptReason === 'blocked'
    const finishReason = input.reason === 'failed' || input.reason === 'blocked' || interruptIsFailure
      ? 'error'
      : 'stop'

    return [
      ...this.closeActiveBlocks(),
      {
        type: 'data-runtime-event',
        data: {
          kind: 'kimi.turn.ended',
          turnId: input.turnId ?? null,
          reason: input.reason,
          interruptReason: input.interruptReason ?? null,
          durationMs: input.durationMs ?? null,
          error: input.error ?? null,
        },
      },
      providerChunk.finish(finishReason),
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

  private reconcileText(turnId: number, expected: string): UIMessageChunk[] {
    const emitted = this.emittedTextByTurn.get(turnId) ?? ''
    return expected.length > emitted.length && expected.startsWith(emitted)
      ? this.mapText(turnId, expected.slice(emitted.length))
      : []
  }

  private reconcileThinking(turnId: number, expected: string): UIMessageChunk[] {
    const emitted = this.emittedThinkingByTurn.get(turnId) ?? ''
    return expected.length > emitted.length && expected.startsWith(emitted)
      ? this.mapThinking(turnId, expected.slice(emitted.length))
      : []
  }

  private reconcileTool(
    turnId: number,
    frame: Extract<KimiTranscriptTurn['steps'][number]['frames'][number], { kind: 'tool' }>,
  ): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    if (!this.toolNames.has(frame.toolCallId)) {
      chunks.push(...this.closeActiveBlocks(turnId))
      this.toolNames.set(frame.toolCallId, frame.name)
      this.toolArgs.set(frame.toolCallId, frame.input ?? frame.inputText)
      chunks.push(
        providerChunk.toolInputStart(frame.toolCallId, frame.name),
        providerChunk.toolInputAvailable({
          toolCallId: frame.toolCallId,
          toolName: frame.name,
          input: buildKimiToolInput(frame.name, frame.input ?? frame.inputText),
        }),
      )
    }
    if (frame.state === 'running' || this.completedToolCalls.has(frame.toolCallId)) {
      return chunks
    }
    this.completedToolCalls.add(frame.toolCallId)
    if (frame.state === 'error') {
      chunks.push(providerChunk.toolOutputError(
        frame.toolCallId,
        frame.error ?? 'Kimi tool call failed.',
      ))
      return chunks
    }
    chunks.push(providerChunk.toolOutputAvailable({
      toolCallId: frame.toolCallId,
      output: buildKimiToolOutput(
        frame.name,
        frame.input ?? frame.inputText,
        frame.output ?? frame.progress,
      ),
    }))
    return chunks
  }
}

function readKimiNoticeDetails(detail: unknown): string | null {
  if (detail === undefined || detail === null) {
    return null
  }
  if (typeof detail === 'string') {
    return detail
  }
  return JSON.stringify(detail) ?? null
}
