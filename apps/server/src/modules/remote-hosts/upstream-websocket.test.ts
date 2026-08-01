import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

import type { UpstreamBridgeSocket } from './upstream-websocket'
import {
  buildUpstreamWebSocketUrl,
  RemoteUpstreamWebSocketBridge,
} from './upstream-websocket'

describe('remote-host upstream websocket', () => {
  const closeCallbacks: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map(close => close()))
  })

  it('removes the local ticket while preserving remote query parameters', () => {
    expect(buildUpstreamWebSocketUrl(
      'http://127.0.0.1:4100',
      '/terminal-sessions/shell/pty-1/socket?ticket=local-secret&fromSeq=42',
    ).toString()).toBe(
      'ws://127.0.0.1:4100/terminal-sessions/shell/pty-1/socket?fromSeq=42',
    )
  })

  it('bridges text and binary frames in both directions', async () => {
    const httpServer = createServer()
    const upstreamServer = new WebSocketServer({ server: httpServer })
    upstreamServer.on('connection', (socket) => {
      socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }))
    })
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, '127.0.0.1', resolve)
    })
    closeCallbacks.push(async () => {
      upstreamServer.close()
      await new Promise<void>(resolve => httpServer.close(() => resolve()))
    })
    const address = httpServer.address() as AddressInfo
    const received: Array<string | Uint8Array> = []
    const local: UpstreamBridgeSocket = {
      send: (data) => {
        received.push(typeof data === 'string'
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        return 1
      },
      close: () => {},
    }
    const bridge = new RemoteUpstreamWebSocketBridge(
      local,
      async () => `http://127.0.0.1:${address.port}`,
      '/echo?ticket=local-secret',
    )

    await bridge.open()
    bridge.send('hello')
    bridge.send(new Uint8Array([1, 2, 3]))

    await expect.poll(() => received.length).toBe(2)
    expect(received[0]).toBe('hello')
    expect(received[1]).toEqual(new Uint8Array([1, 2, 3]))
    bridge.close()
  })
})
