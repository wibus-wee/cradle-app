import type { UIMessageChunk } from 'ai'

export interface ProviderChunkSequenceContractOptions {
  openTextIds?: Iterable<string>
  openReasoningIds?: Iterable<string>
  startedToolCallIds?: Iterable<string>
  allowOpenTextAtEnd?: boolean
  allowOpenReasoningAtEnd?: boolean
  allowMissingToolInputStart?: boolean
  allowChunksAfterFinish?: boolean
  allowDuplicateToolInputStart?: boolean
}

export interface ProviderChunkSequenceViolation {
  index: number
  type: UIMessageChunk['type'] | 'end-of-sequence'
  message: string
}

export class ProviderChunkSequenceContractError extends Error {
  readonly violations: ProviderChunkSequenceViolation[]

  constructor(violations: ProviderChunkSequenceViolation[]) {
    super(formatProviderChunkSequenceViolations(violations))
    this.name = 'ProviderChunkSequenceContractError'
    this.violations = violations
  }
}

export function validateProviderChunkSequence(
  chunks: readonly UIMessageChunk[],
  options: ProviderChunkSequenceContractOptions = {},
): ProviderChunkSequenceViolation[] {
  const openTextIds = new Set(options.openTextIds ?? [])
  const openReasoningIds = new Set(options.openReasoningIds ?? [])
  const startedToolCallIds = new Set(options.startedToolCallIds ?? [])
  const violations: ProviderChunkSequenceViolation[] = []
  let finishIndex: number | null = null

  for (const [index, chunk] of chunks.entries()) {
    if (finishIndex !== null && !options.allowChunksAfterFinish) {
      violations.push({
        index,
        type: chunk.type,
        message: `chunk appears after finish at index ${finishIndex}`,
      })
    }

    switch (chunk.type) {
      case 'text-start':
        if (openTextIds.has(chunk.id)) {
          violations.push({
            index,
            type: chunk.type,
            message: `text block "${chunk.id}" starts while already open`,
          })
        }
        openTextIds.add(chunk.id)
        break
      case 'text-delta':
        if (!openTextIds.has(chunk.id)) {
          violations.push({
            index,
            type: chunk.type,
            message: `text block "${chunk.id}" receives delta before text-start`,
          })
        }
        break
      case 'text-end':
        if (!openTextIds.has(chunk.id)) {
          violations.push({
            index,
            type: chunk.type,
            message: `text block "${chunk.id}" ends before text-start`,
          })
        }
 else {
          openTextIds.delete(chunk.id)
        }
        break
      case 'reasoning-start':
        if (openReasoningIds.has(chunk.id)) {
          violations.push({
            index,
            type: chunk.type,
            message: `reasoning block "${chunk.id}" starts while already open`,
          })
        }
        openReasoningIds.add(chunk.id)
        break
      case 'reasoning-delta':
        if (!openReasoningIds.has(chunk.id)) {
          violations.push({
            index,
            type: chunk.type,
            message: `reasoning block "${chunk.id}" receives delta before reasoning-start`,
          })
        }
        break
      case 'reasoning-end':
        if (!openReasoningIds.has(chunk.id)) {
          violations.push({
            index,
            type: chunk.type,
            message: `reasoning block "${chunk.id}" ends before reasoning-start`,
          })
        }
 else {
          openReasoningIds.delete(chunk.id)
        }
        break
      case 'tool-input-start':
        if (startedToolCallIds.has(chunk.toolCallId) && !options.allowDuplicateToolInputStart) {
          violations.push({
            index,
            type: chunk.type,
            message: `tool call "${chunk.toolCallId}" starts more than once`,
          })
        }
        startedToolCallIds.add(chunk.toolCallId)
        break
      case 'tool-input-available':
      case 'tool-input-delta':
      case 'tool-output-available':
      case 'tool-output-error':
      case 'tool-approval-request':
        if (!startedToolCallIds.has(chunk.toolCallId) && !options.allowMissingToolInputStart) {
          violations.push({
            index,
            type: chunk.type,
            message: `tool call "${chunk.toolCallId}" emits ${chunk.type} before tool-input-start`,
          })
        }
        break
      case 'finish':
        finishIndex = index
        if (openTextIds.size > 0 && !options.allowOpenTextAtEnd) {
          violations.push({
            index,
            type: chunk.type,
            message: `finish emitted with open text blocks: ${formatIdSet(openTextIds)}`,
          })
        }
        if (openReasoningIds.size > 0 && !options.allowOpenReasoningAtEnd) {
          violations.push({
            index,
            type: chunk.type,
            message: `finish emitted with open reasoning blocks: ${formatIdSet(openReasoningIds)}`,
          })
        }
        break
      default:
        break
    }
  }

  if (openTextIds.size > 0 && !options.allowOpenTextAtEnd) {
    violations.push({
      index: chunks.length,
      type: 'end-of-sequence',
      message: `sequence ended with open text blocks: ${formatIdSet(openTextIds)}`,
    })
  }

  if (openReasoningIds.size > 0 && !options.allowOpenReasoningAtEnd) {
    violations.push({
      index: chunks.length,
      type: 'end-of-sequence',
      message: `sequence ended with open reasoning blocks: ${formatIdSet(openReasoningIds)}`,
    })
  }

  return violations
}

export function assertValidProviderChunkSequence(
  chunks: readonly UIMessageChunk[],
  options: ProviderChunkSequenceContractOptions = {},
): void {
  const violations = validateProviderChunkSequence(chunks, options)
  if (violations.length > 0) {
    throw new ProviderChunkSequenceContractError(violations)
  }
}

function formatProviderChunkSequenceViolations(violations: readonly ProviderChunkSequenceViolation[]): string {
  return [
    'Provider chunk sequence violates the Chat Runtime contract:',
    ...violations.map(violation => `- [${violation.index}] ${violation.type}: ${violation.message}`),
  ].join('\n')
}

function formatIdSet(ids: ReadonlySet<string>): string {
  return Array.from(ids).sort().join(', ')
}
