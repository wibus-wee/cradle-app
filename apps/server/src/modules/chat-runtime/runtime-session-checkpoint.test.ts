import { describe, expect, it } from 'vitest'

import type { RuntimeSession } from './runtime-provider-types'
import {
  readRuntimeSessionProviderCheckpointRevision,
  replaceRuntimeSessionProviderCheckpoint,
} from './runtime-session-checkpoint'

describe('runtime session checkpoint revision', () => {
  it('advances only when durable checkpoint content changes', () => {
    const runtimeSession: RuntimeSession = {
      id: 'runtime-session-1',
      chatSessionId: 'chat-session-1',
      runtimeKind: 'codex',
      providerTargetId: 'provider-1',
      providerSessionId: 'thread-1',
      providerStateSnapshot: '{"version":1}',
    }

    expect(readRuntimeSessionProviderCheckpointRevision(runtimeSession)).toBe(0)
    replaceRuntimeSessionProviderCheckpoint(runtimeSession, '{"version":1}')
    expect(readRuntimeSessionProviderCheckpointRevision(runtimeSession)).toBe(0)
    replaceRuntimeSessionProviderCheckpoint(runtimeSession, '{"version":2}')
    expect(readRuntimeSessionProviderCheckpointRevision(runtimeSession)).toBe(1)
  })
})
