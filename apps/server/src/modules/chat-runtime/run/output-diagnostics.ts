import type { UIMessageChunk } from 'ai'

export interface TurnOutputDiagnostics {
  emittedEventCount: number
  assistantBoundaryCount: number
  assistantTextCharCount: number
  reasoningTextCharCount: number
  toolInputDeltaCharCount: number
  toolEventCount: number
  /**
   * Count of output-bearing chunk types that aren't text/reasoning/the core
   * tool lifecycle events above: tool failures/denials, source citations,
   * generated files, and custom `data-*` parts. A turn that only produces
   * these should still count as having real output.
   */
  otherOutputEventCount: number
}

export function createTurnOutputDiagnostics(): TurnOutputDiagnostics {
  return {
    emittedEventCount: 0,
    assistantBoundaryCount: 0,
    assistantTextCharCount: 0,
    reasoningTextCharCount: 0,
    toolInputDeltaCharCount: 0,
    toolEventCount: 0,
    otherOutputEventCount: 0,
  }
}

export function accumulateDiagnostics(
  diagnostics: TurnOutputDiagnostics,
  chunk: UIMessageChunk,
): void {
  diagnostics.emittedEventCount += 1
  switch (chunk.type) {
    case 'text-start':
    case 'text-end':
      diagnostics.assistantBoundaryCount += 1
      break
    case 'text-delta':
      diagnostics.assistantTextCharCount += chunk.delta.length
      break
    case 'reasoning-delta':
      diagnostics.reasoningTextCharCount += chunk.delta.length
      break
    case 'tool-input-delta':
      diagnostics.toolInputDeltaCharCount += chunk.inputTextDelta.length
      break
    case 'tool-input-start':
    case 'tool-input-available':
    case 'tool-output-available':
      diagnostics.toolEventCount += 1
      break
    case 'tool-input-error':
    case 'tool-output-error':
    case 'tool-output-denied':
    case 'tool-approval-request':
    case 'source-url':
    case 'source-document':
    case 'file':
      diagnostics.otherOutputEventCount += 1
      break
    default:
      // Custom `data-*` parts (e.g. Cradle skill/plugin context) are also
      // real output; every other chunk type left here is purely structural
      // (start/finish/start-step/finish-step/message-metadata/error/abort).
      if (chunk.type.startsWith('data-')) {
        diagnostics.otherOutputEventCount += 1
      }
      break
  }
}
