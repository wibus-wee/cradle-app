import { describe, expect, it } from 'vitest'

import { forwardManagedTargetMessage } from './managed-process-protocol'

describe('managed process IPC forwarding', () => {
  it('preserves server bootstrap events inside the runner envelope', () => {
    const bootstrapEvent = {
      type: 'cradle-server-bootstrap' as const,
      phase: 'persisted-run-recovery',
      kind: 'started' as const,
      at: '2026-07-24T00:00:00.000Z',
    }

    expect(forwardManagedTargetMessage(bootstrapEvent)).toEqual({
      type: 'target-message',
      message: bootstrapEvent,
    })
  })
})
