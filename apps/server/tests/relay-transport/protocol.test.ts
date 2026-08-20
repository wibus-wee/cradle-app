import { describe, expect, it } from 'vitest'

import { INNER_FRAME_KIND, relayPriorityForInnerFrame } from '../../src/modules/relay-transport/protocol'

describe('fabric relay frame priority', () => {
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
