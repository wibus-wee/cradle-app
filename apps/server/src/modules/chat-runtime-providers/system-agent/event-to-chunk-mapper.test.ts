import { describe, expect, it } from 'vitest'

import { assertValidProviderChunkSequence } from '../kit/testing/chunk-contract'
import {
  closeSystemAgentBridgeState,
  createSystemAgentBridgeState,
  mapSystemAgentEventToChunks,
} from './event-to-chunk-mapper'

describe('system agent chunk mapper', () => {
  it('projects scripted jar-core events into a valid provider chunk sequence', () => {
    const state = createSystemAgentBridgeState()

    const chunks = [
      ...mapSystemAgentEventToChunks({ type: 'thinking_delta', delta: 'Planning' }, state),
      ...mapSystemAgentEventToChunks({ type: 'text_delta', delta: 'Done' }, state),
      ...closeSystemAgentBridgeState(state),
    ]

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'text-start',
      'text-delta',
      'text-end',
    ])
    assertValidProviderChunkSequence(chunks)
  })
})
