import { describe, expect, it, vi } from 'vitest'

import { generateFabricSessionKeyPair } from '../../src/modules/relay-transport/crypto'
import {
  decodeFabricSessionEnvelope,
  encodeFabricSessionEnvelope,
  FABRIC_SESSION_PROTOCOL_VERSION,
  RELAY_STREAM_MIN_CREDIT_BYTES,
} from '../../src/modules/relay-transport/protocol'
import type {
  FabricSessionCallbacks,
  FabricSessionOptions,
} from '../../src/modules/relay-transport/session'
import { FabricSession } from '../../src/modules/relay-transport/session'

const fabricId = 'fabric-test'
const linkId = 'link-test'

function encode(data: Omit<Parameters<typeof encodeFabricSessionEnvelope>[0], 'version' | 'linkId'>): Uint8Array {
  return encodeFabricSessionEnvelope({
    version: FABRIC_SESSION_PROTOCOL_VERSION,
    linkId,
    ...data,
  })
}

function wire(left: FabricSession, right: FabricSession): void {
  ;(left as unknown as { cb: { send: (data: Uint8Array) => void } }).cb.send = (data) => {
    right.handleEnvelope(decodeFabricSessionEnvelope(data))
  }
  ;(right as unknown as { cb: { send: (data: Uint8Array) => void } }).cb.send = (data) => {
    left.handleEnvelope(decodeFabricSessionEnvelope(data))
  }
}

function session(
  role: 'node' | 'controller',
  keys: { privateKeyBase64: string, publicKeyBase64: string },
  expectedPeerPubkey: string,
  callbacks: FabricSessionCallbacks,
  capabilities: Pick<FabricSessionOptions, 'supportedCipherSuites' | 'supportedCompressions'> = {},
): FabricSession {
  return new FabricSession(role, keys.privateKeyBase64, {
    fabricId,
    linkId,
    expectedPeerPubkey,
    ourPublicKeyBase64: keys.publicKeyBase64,
    ...capabilities,
    encodeOutboundEnvelope: encode,
  }, callbacks)
}

describe('fabric Session', () => {
  it('authenticates both Fabric members and exchanges stream data', () => {
    const nodeKeys = generateFabricSessionKeyPair()
    const controllerKeys = generateFabricSessionKeyPair()
    const nodeReady = vi.fn()
    const controllerReady = vi.fn()
    const received: Uint8Array[] = []
    const node = session('node', nodeKeys, controllerKeys.publicKeyBase64, {
      send: () => {},
      onReady: nodeReady,
      onStreamOpen: () => {},
      onStreamData: (_streamId, data) => received.push(data),
    })
    const controller = session('controller', controllerKeys, nodeKeys.publicKeyBase64, {
      send: () => {},
      onReady: controllerReady,
    })
    wire(node, controller)

    controller.start()

    expect(node.isReady).toBe(true)
    expect(controller.isReady).toBe(true)
    expect(nodeReady).toHaveBeenCalledOnce()
    expect(controllerReady).toHaveBeenCalledOnce()

    controller.openStream('stream-1')
    const payload = new TextEncoder().encode('Fabric stream payload')
    controller.writeStreamData('stream-1', payload)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(payload)
  })

  it('negotiates the CryptoKit AES-GCM and uncompressed portable baseline', () => {
    const nodeKeys = generateFabricSessionKeyPair()
    const controllerKeys = generateFabricSessionKeyPair()
    const nodeNegotiated = vi.fn()
    const controllerNegotiated = vi.fn()
    const received: Uint8Array[] = []
    const node = session('node', nodeKeys, controllerKeys.publicKeyBase64, {
      send: () => {},
      onNegotiatedCapabilities: nodeNegotiated,
      onStreamOpen: () => {},
      onStreamData: (_streamId, data) => received.push(data),
    })
    const controller = session('controller', controllerKeys, nodeKeys.publicKeyBase64, {
      send: () => {},
      onNegotiatedCapabilities: controllerNegotiated,
    }, {
      supportedCipherSuites: ['aes-256-gcm'],
      supportedCompressions: ['none'],
    })
    wire(node, controller)

    controller.start()
    controller.openStream('portable-stream')
    controller.writeStreamData('portable-stream', new Uint8Array(4 * 1024).fill(9))

    const expected = { cipherSuite: 'aes-256-gcm', compression: 'none' }
    expect(nodeNegotiated).toHaveBeenCalledWith(expected)
    expect(controllerNegotiated).toHaveBeenCalledWith(expected)
    expect(received).toEqual([new Uint8Array(4 * 1024).fill(9)])
  })

  it('fails closed when peers have no common cipher suite', () => {
    const nodeKeys = generateFabricSessionKeyPair()
    const controllerKeys = generateFabricSessionKeyPair()
    const error = vi.fn()
    const node = session('node', nodeKeys, controllerKeys.publicKeyBase64, {
      send: () => {},
      onError: error,
    }, { supportedCipherSuites: ['xchacha20poly1305'] })
    const controller = session('controller', controllerKeys, nodeKeys.publicKeyBase64, {
      send: () => {},
      onError: error,
    }, { supportedCipherSuites: ['aes-256-gcm'] })
    wire(node, controller)

    controller.start()

    expect(node.isReady).toBe(false)
    expect(controller.isReady).toBe(false)
    expect(error).toHaveBeenCalledOnce()
  })

  it('flushes data queued beyond stream credit before closing', () => {
    const nodeKeys = generateFabricSessionKeyPair()
    const controllerKeys = generateFabricSessionKeyPair()
    const received: Uint8Array[] = []
    const events: string[] = []
    let acknowledge = false
    const node = session('node', nodeKeys, controllerKeys.publicKeyBase64, {
      send: () => {},
      onStreamData: (streamId, data) => {
        received.push(data)
        events.push('data')
        if (acknowledge) {
          node.reportStreamDataConsumed(streamId, data.byteLength, { flush: true })
        }
      },
      onStreamClose: () => events.push('close'),
    })
    const controller = session('controller', controllerKeys, nodeKeys.publicKeyBase64, {
      send: () => {},
    })
    wire(node, controller)
    controller.start()
    controller.openStream('stream-large')

    const payload = new Uint8Array(RELAY_STREAM_MIN_CREDIT_BYTES + 128 * 1024).fill(7)
    controller.writeStreamData('stream-large', payload)
    controller.closeStream('stream-large', 'local socket closed')

    expect(received.reduce((total, chunk) => total + chunk.byteLength, 0))
      .toBe(RELAY_STREAM_MIN_CREDIT_BYTES)
    expect(events).not.toContain('close')

    acknowledge = true
    node.reportStreamDataConsumed(
      'stream-large',
      RELAY_STREAM_MIN_CREDIT_BYTES,
      { flush: true },
    )

    expect(received.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(payload.byteLength)
    expect(events.at(-1)).toBe('close')
  })

  it('propagates a controller stream close to the node exactly once', () => {
    const nodeKeys = generateFabricSessionKeyPair()
    const controllerKeys = generateFabricSessionKeyPair()
    const nodeStreamClose = vi.fn()
    const node = session('node', nodeKeys, controllerKeys.publicKeyBase64, {
      send: () => {},
      onStreamOpen: () => {},
      onStreamClose: nodeStreamClose,
    })
    const controller = session('controller', controllerKeys, nodeKeys.publicKeyBase64, {
      send: () => {},
    })
    wire(node, controller)
    controller.start()
    controller.openStream('cancelled-stream')

    controller.closeStream('cancelled-stream', 'local socket closed')
    controller.closeStream('cancelled-stream', 'duplicate close')

    expect(nodeStreamClose).toHaveBeenCalledOnce()
    expect(nodeStreamClose).toHaveBeenCalledWith('cancelled-stream', 'local socket closed')
  })

  it('rejects a session when the peer key is not the Fabric certificate key', () => {
    const nodeKeys = generateFabricSessionKeyPair()
    const controllerKeys = generateFabricSessionKeyPair()
    const error = vi.fn()
    const node = session('node', nodeKeys, controllerKeys.publicKeyBase64, {
      send: () => {},
      onError: error,
    })
    const controller = session('controller', controllerKeys, generateFabricSessionKeyPair().publicKeyBase64, {
      send: () => {},
      onError: error,
    })
    wire(node, controller)

    controller.start()

    expect(error).toHaveBeenCalledOnce()
    expect(controller.isReady).toBe(false)
  })

  it('rejects frames from another Fabric link', () => {
    const nodeKeys = generateFabricSessionKeyPair()
    const controllerKeys = generateFabricSessionKeyPair()
    const nodeError = vi.fn()
    const node = session('node', nodeKeys, controllerKeys.publicKeyBase64, {
      send: () => {},
      onError: nodeError,
    })
    const controller = session('controller', controllerKeys, nodeKeys.publicKeyBase64, {
      send: () => {},
    })
    wire(node, controller)
    controller.start()

    const foreign = decodeFabricSessionEnvelope(encode({
      seq: 0,
      kind: 'relay_data_frame',
      priority: 'control',
      payload: new Uint8Array([1]),
    }))
    node.handleEnvelope({ ...foreign, linkId: 'another-link' })
    expect(nodeError).toHaveBeenCalledOnce()
  })
})
