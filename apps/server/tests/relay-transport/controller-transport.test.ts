import net from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { generateRelaySigningKeyPair, signRelayAssertion } from '../../src/modules/relay-servers/relay-signature-service'
import { startRelayControllerTransport } from '../../src/modules/relay-transport/controller-transport'
import { generateRelayKeyPair } from '../../src/modules/relay-transport/crypto'

describe('relay controller transport', () => {
  const servers: net.Server[] = []
  const sockets = new Set<net.Socket>()

  afterEach(async () => {
    for (const socket of sockets) {
      socket.destroy()
    }
    sockets.clear()
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  })

  it('fails a stalled websocket handshake without an uncaught websocket error', async () => {
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test server to have a TCP address.')
    }

    const controllerKeys = generateRelayKeyPair()
    const signingKeys = generateRelaySigningKeyPair()
    const wsAssertion = signRelayAssertion(signingKeys.privateKeyBase64, {
      role: 'controller',
      purpose: 'ws',
      roomId: 'test-room',
    })

    await expect(startRelayControllerTransport({
      hostId: 'test-host',
      relayUrl: `http://127.0.0.1:${address.port}`,
      roomId: 'test-room',
      wsAssertion,
      controllerPrivateKeyBase64: controllerKeys.privateKeyBase64,
      controllerPublicKeyBase64: controllerKeys.publicKeyBase64,
      readyTimeoutMs: 25,
    })).rejects.toMatchObject({ code: 'relay_controller_connect_failed' })
  })
})
