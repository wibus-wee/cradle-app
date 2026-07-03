/**
 * Output: AI SDK UIMessageChunk events projected from jar-core assistant message events.
 * Input: jar-core assistant message event payloads and per-turn bridge state.
 * Position: System Agent provider package event mapper between jar-core and Chat Runtime chunks.
 */

import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'

import { providerChunk } from '../kit/chunk-mapper'
import type { SystemAgentAssistantMessageEvent } from './types'

export interface SystemAgentBridgeState {
  currentTextId: string | null
  currentReasoningId: string | null
  assistantStarted: boolean
}

export function createSystemAgentBridgeState(): SystemAgentBridgeState {
  return {
    currentTextId: null,
    currentReasoningId: null,
    assistantStarted: false,
  }
}

export function closeSystemAgentBridgeState(state: SystemAgentBridgeState): UIMessageChunk[] {
  const out: UIMessageChunk[] = []
  closeTextBlock(state, out)
  closeReasoningBlock(state, out)
  return out
}

export function mapSystemAgentEventToChunks(
  event: SystemAgentAssistantMessageEvent,
  state: SystemAgentBridgeState,
): UIMessageChunk[] {
  const out: UIMessageChunk[] = []

  switch (event.type) {
    case 'text_start':
      openTextBlock(state, out)
      break
    case 'text_delta':
      if (!state.currentTextId) {
        openTextBlock(state, out, event.delta)
      }
      else if (event.delta) {
        out.push(providerChunk.textDelta(state.currentTextId, event.delta))
      }
      break
    case 'thinking_start':
      openReasoningBlock(state, out)
      break
    case 'thinking_delta':
      if (!state.currentReasoningId) {
        openReasoningBlock(state, out, event.delta)
      }
      else if (event.delta) {
        out.push(providerChunk.reasoningDelta(state.currentReasoningId, event.delta))
      }
      break
    case 'thinking_end':
      closeReasoningBlock(state, out)
      break
    case 'error':
      if (!state.currentTextId) {
        openTextBlock(state, out)
      }
      out.push(providerChunk.textDelta(state.currentTextId!, '\n\n[Error occurred]'))
      break
  }

  return out
}

function closeTextBlock(state: SystemAgentBridgeState, out: UIMessageChunk[]): void {
  if (state.currentTextId) {
    out.push(providerChunk.textEnd(state.currentTextId))
    state.currentTextId = null
  }
}

function closeReasoningBlock(state: SystemAgentBridgeState, out: UIMessageChunk[]): void {
  if (state.currentReasoningId) {
    out.push(providerChunk.reasoningEnd(state.currentReasoningId))
    state.currentReasoningId = null
  }
}

function openTextBlock(state: SystemAgentBridgeState, out: UIMessageChunk[], delta?: string): void {
  closeReasoningBlock(state, out)
  const id = randomUUID()
  state.currentTextId = id
  out.push(providerChunk.textStart(id))
  if (delta) {
    out.push(providerChunk.textDelta(id, delta))
  }
  state.assistantStarted = true
}

function openReasoningBlock(state: SystemAgentBridgeState, out: UIMessageChunk[], delta?: string): void {
  closeTextBlock(state, out)
  const id = randomUUID()
  state.currentReasoningId = id
  out.push(providerChunk.reasoningStart(id))
  if (delta) {
    out.push(providerChunk.reasoningDelta(id, delta))
  }
}
