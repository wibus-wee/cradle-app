import { describe, expect, it } from 'vitest'

import { providerChunk } from '../chunk-mapper'
import {
  assertValidProviderChunkSequence,
  ProviderChunkSequenceContractError,
  validateProviderChunkSequence,
} from './chunk-contract'

describe('provider chunk contract', () => {
  it('accepts closed text, reasoning, tool, and finish chunks', () => {
    const chunks = [
      providerChunk.textStart('text-1'),
      providerChunk.textDelta('text-1', 'Done'),
      providerChunk.textEnd('text-1'),
      providerChunk.reasoningStart('reasoning-1'),
      providerChunk.reasoningDelta('reasoning-1', 'Thinking'),
      providerChunk.reasoningEnd('reasoning-1'),
      providerChunk.toolInputStart('tool-1', 'bash'),
      providerChunk.toolInputAvailable({ toolCallId: 'tool-1', toolName: 'bash', input: { command: 'pwd' } }),
      providerChunk.toolOutputAvailable({ toolCallId: 'tool-1', output: 'ok' }),
      providerChunk.finish('stop'),
    ]

    expect(validateProviderChunkSequence(chunks)).toEqual([])
    expect(() => assertValidProviderChunkSequence(chunks)).not.toThrow()
  })

  it('reports text deltas without a matching start', () => {
    const violations = validateProviderChunkSequence([
      providerChunk.textDelta('text-1', 'Done'),
    ])

    expect(violations).toEqual([
      {
        index: 0,
        type: 'text-delta',
        message: 'text block "text-1" receives delta before text-start',
      },
    ])
  })

  it('reports tool chunks without a matching input start', () => {
    const violations = validateProviderChunkSequence([
      providerChunk.toolOutputAvailable({ toolCallId: 'tool-1', output: 'ok' }),
    ])

    expect(violations).toEqual([
      {
        index: 0,
        type: 'tool-output-available',
        message: 'tool call "tool-1" emits tool-output-available before tool-input-start',
      },
    ])
  })

  it('reports open blocks and chunks after finish', () => {
    expect(() => assertValidProviderChunkSequence([
      providerChunk.textStart('text-1'),
      providerChunk.finish('stop'),
      providerChunk.textDelta('text-1', 'late'),
    ])).toThrow(ProviderChunkSequenceContractError)
  })

  it('accepts sequences with caller-provided open text state', () => {
    expect(validateProviderChunkSequence([
      providerChunk.textDelta('text-1', 'Done'),
      providerChunk.textEnd('text-1'),
    ], {
      openTextIds: ['text-1'],
    })).toEqual([])
  })
})
