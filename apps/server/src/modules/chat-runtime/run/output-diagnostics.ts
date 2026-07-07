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

interface TurnOutputValidationResult {
  ok: boolean
  errorText: string | null
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

export function resolveTerminalChunkWithDiagnostics(
  chunk: UIMessageChunk,
  diagnostics: TurnOutputDiagnostics,
  options: { allowEmptyAssistantOutput?: boolean } = {},
): UIMessageChunk {
  if (chunk.type !== 'finish') {
    return chunk
  }

  const validation = validateTurnOutput(diagnostics, options)
  if (validation.ok) {
    return chunk
  }

  const errorText = validation.errorText ?? 'Provider finished without assistant output events'
  return { type: 'error', errorText }
}

function validateTurnOutput(
  diagnostics: TurnOutputDiagnostics,
  options: { allowEmptyAssistantOutput?: boolean } = {},
): TurnOutputValidationResult {
  const hasTextOutput
    = diagnostics.assistantTextCharCount > 0 || diagnostics.reasoningTextCharCount > 0
  const hasToolOutput = diagnostics.toolEventCount > 0
  const hasOtherOutput = diagnostics.otherOutputEventCount > 0

  if (
    hasTextOutput
    || hasToolOutput
    || hasOtherOutput
    || options.allowEmptyAssistantOutput
  ) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Provider finished without any assistant output events (events=${diagnostics.emittedEventCount}, assistant_boundaries=${diagnostics.assistantBoundaryCount}, assistant_text_chars=${diagnostics.assistantTextCharCount}, reasoning_chars=${diagnostics.reasoningTextCharCount}, tool_events=${diagnostics.toolEventCount}, other_output_events=${diagnostics.otherOutputEventCount})`,
  }
}
