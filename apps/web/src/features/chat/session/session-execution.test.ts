import { describe, expect, it } from 'vitest'

import {
  getSessionNodeId,
  isNodeExecution,
  readSessionExecution,
} from './session-execution'

describe('session-execution', () => {
  it('treats missing execution as local', () => {
    expect(readSessionExecution(null)).toEqual({ kind: 'local' })
    expect(readSessionExecution({})).toEqual({ kind: 'local' })
    expect(isNodeExecution({ execution: { kind: 'local' } })).toBe(false)
    expect(getSessionNodeId({ execution: { kind: 'local' } })).toBeNull()
  })

  it('reads node execution metadata', () => {
    const session = {
      execution: {
        kind: 'node',
        nodeId: 'node-1',
        remoteSessionId: 'remote-session-1',
      },
    }
    expect(isNodeExecution(session)).toBe(true)
    expect(getSessionNodeId(session)).toBe('node-1')
    expect(readSessionExecution(session)).toEqual(session.execution)
  })
})
