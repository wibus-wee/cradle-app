import { describe, expect, it } from 'vitest'

import {
  getRemoteHostId,
  isRemoteHostExecution,
  readSessionExecution,
} from './session-execution'

describe('session-execution', () => {
  it('treats missing execution as local', () => {
    expect(readSessionExecution(null)).toEqual({ kind: 'local' })
    expect(readSessionExecution({})).toEqual({ kind: 'local' })
    expect(isRemoteHostExecution({ execution: { kind: 'local' } })).toBe(false)
    expect(getRemoteHostId({ execution: { kind: 'local' } })).toBeNull()
  })

  it('reads remote-host execution metadata', () => {
    const session = {
      execution: {
        kind: 'remote-host',
        hostId: 'host-1',
        remoteSessionId: 'remote-session-1',
      },
    }
    expect(isRemoteHostExecution(session)).toBe(true)
    expect(getRemoteHostId(session)).toBe('host-1')
    expect(readSessionExecution(session)).toEqual(session.execution)
  })
})
