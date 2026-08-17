import { describe, expect, it, vi } from 'vitest'

import { generateFabricSessionKeyPair } from '../../src/modules/relay-transport/crypto'
import {
  decodeFabricSessionEnvelope,
  encodeFabricSessionEnvelope,
  FABRIC_SESSION_PROTOCOL_VERSION,
} from '../../src/modules/relay-transport/protocol'
import type { FabricSessionCallbacks } from '../../src/modules/relay-transport/session'
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
): FabricSession {
  return new FabricSession(role, keys.privateKeyBase64, {
    fabricId,
    linkId,
    expectedPeerPubkey,
    ourPublicKeyBase64: keys.publicKeyBase64,
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
