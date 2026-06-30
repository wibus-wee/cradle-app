import { describe, expect, it } from 'vitest'

import {
  encodeRemoteAgentFrame,
  parseRemoteAgentFrame,
  REMOTE_AGENT_PROTOCOL_VERSION,
} from './index'

describe('remote agent protocol frames', () => {
  it('parses valid request frames', () => {
    expect(parseRemoteAgentFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.request',
      id: '1',
      method: 'host/hello',
      params: { clientName: 'test' },
    })).toMatchObject({
      kind: 'rpc.request',
      method: 'host/hello',
    })
  })

  it('rejects missing ids', () => {
    expect(() => parseRemoteAgentFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.request',
      method: 'host/hello',
      params: {},
    })).toThrow()
  })

  it('rejects unknown unary methods', () => {
    expect(() => parseRemoteAgentFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.request',
      id: '1',
      method: 'unknown/method',
      params: {},
    })).toThrow()
  })

  it('parses remote filesystem request frames', () => {
    expect(parseRemoteAgentFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.request',
      id: '1',
      method: 'fs/listDirectory',
      params: { path: '/tmp' },
    })).toMatchObject({
      kind: 'rpc.request',
      method: 'fs/listDirectory',
    })
  })

  it('rejects invalid stream ids', () => {
    expect(() => parseRemoteAgentFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.open',
      streamId: '',
      method: 'agent/turn',
      params: {},
    })).toThrow()
  })

  it('round trips encoded frames', () => {
    const encoded = encodeRemoteAgentFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.close',
      streamId: 'stream-1',
    })

    expect(parseRemoteAgentFrame(encoded)).toEqual({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.close',
      streamId: 'stream-1',
    })
  })
})
