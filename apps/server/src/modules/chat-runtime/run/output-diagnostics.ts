import type { UIMessageChunk } from 'ai'

export interface TurnOutputDiagnostics {
  emittedEventCount: number
  assistantBoundaryCount: number
  assistantTextCharCount: number
  reasoningTextCharCount: number
  toolInputDeltaCharCount: number
  toolEventCount: number
  commandEventCount: number
  commandOutputCharCount: number
  fileChangeEventCount: number
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
    commandEventCount: 0,
    commandOutputCharCount: 0,
    fileChangeEventCount: 0
  }
}

export function accumulateDiagnostics(
  diagnostics: TurnOutputDiagnostics,
  chunk: UIMessageChunk
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
    default:
      break
  }
}

export function resolveTerminalChunkWithDiagnostics(
  chunk: UIMessageChunk,
  diagnostics: TurnOutputDiagnostics,
  options: { allowEmptyAssistantOutput?: boolean } = {}
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
  options: { allowEmptyAssistantOutput?: boolean } = {}
): TurnOutputValidationResult {
  const hasTextOutput =
    diagnostics.assistantTextCharCount > 0 || diagnostics.reasoningTextCharCount > 0
  const hasToolOutput = diagnostics.toolEventCount > 0
  const hasCommandOutput =
    diagnostics.commandEventCount > 0 || diagnostics.commandOutputCharCount > 0
  const hasFileChangeOutput = diagnostics.fileChangeEventCount > 0

  if (
    hasTextOutput ||
    hasToolOutput ||
    hasCommandOutput ||
    hasFileChangeOutput ||
    options.allowEmptyAssistantOutput
  ) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Provider finished without any assistant output events (events=${diagnostics.emittedEventCount}, assistant_boundaries=${diagnostics.assistantBoundaryCount}, assistant_text_chars=${diagnostics.assistantTextCharCount}, reasoning_chars=${diagnostics.reasoningTextCharCount}, tool_events=${diagnostics.toolEventCount}, command_events=${diagnostics.commandEventCount}, command_output_chars=${diagnostics.commandOutputCharCount}, file_change_events=${diagnostics.fileChangeEventCount})`
  }
}
