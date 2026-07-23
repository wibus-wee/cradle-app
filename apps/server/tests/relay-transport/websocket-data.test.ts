import { describe, expect, it } from 'vitest'
import type WebSocket from 'ws'

import { relayWebSocketDataView } from '../../src/modules/relay-transport/websocket-data'

describe('relay WebSocket data view', () => {
  it('shares Buffer memory without copying', () => {
    const source = Buffer.from([1, 2, 3])
    const view = relayWebSocketDataView(source)

    view[1] = 9
    expect(source[1]).toBe(9)
  })

  it('shares ArrayBuffer memory without copying', () => {
    const source = new Uint8Array([1, 2, 3])
    const view = relayWebSocketDataView(source.buffer)

    view[1] = 9
    expect(source[1]).toBe(9)
  })

  it('coalesces the fragmented Buffer-array form', () => {
    const source = [Buffer.from([1, 2]), Buffer.from([3, 4])] as WebSocket.RawData

    expect(relayWebSocketDataView(source)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })
})
