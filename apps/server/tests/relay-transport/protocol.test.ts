import { describe, expect, it } from 'vitest'

import { decodeInnerFrame, encodeInnerFrame, FABRIC_SESSION_PROTOCOL_VERSION, INNER_FRAME_KIND, relayPriorityForInnerFrame } from '../../src/modules/relay-transport/protocol'

describe('fabric relay frame priority', () => {
  it('round-trips a portable Controller capability offer', () => {
    const hello = {
      kind: INNER_FRAME_KIND.hello,
      version: FABRIC_SESSION_PROTOCOL_VERSION,
      pubkey: Buffer.alloc(32, 7).toString('base64'),
      selection: false,
      cipherSuites: ['aes-256-gcm' as const],
      compressions: ['none' as const],
    }

    expect(decodeInnerFrame(encodeInnerFrame(hello))).toEqual(hello)
  })

  it('keeps stream close in the ordered data lane', () => {
    expect(relayPriorityForInnerFrame({
      kind: INNER_FRAME_KIND.streamClose,
      streamId: 'stream-a',
      reason: 'done',
    })).toBe('data')
  })

  it('keeps acknowledgements in the control lane', () => {
    expect(relayPriorityForInnerFrame({
      kind: INNER_FRAME_KIND.streamAck,
      streamId: 'stream-a',
      ackedBytes: 1,
    })).toBe('control')
  })
})
