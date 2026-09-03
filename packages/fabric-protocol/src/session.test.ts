import { describe, expect, it } from 'vitest'

import type { FabricSessionOutboundEnvelope } from './session'
import { FabricSession } from './session'
import {
  decodeFabricSessionEnvelope,
  encodeFabricSessionEnvelope,
  FABRIC_SESSION_PROTOCOL_VERSION,
} from './session-codec'
import { generateFabricSessionKeyPair } from './session-crypto'

const fabricId = 'fabric-portable'
const linkId = 'link-portable'

function deterministicRandom(seed: number): (length: number) => Uint8Array {
  let counter = seed
  return length => Uint8Array.from({ length }, () => {
    counter = (counter + 29) & 0xFF
    return counter
  })
}

function encodeEnvelope(frame: FabricSessionOutboundEnvelope): Uint8Array {
  return encodeFabricSessionEnvelope({
    version: FABRIC_SESSION_PROTOCOL_VERSION,
    linkId,
    ...frame,
  })
}

describe('portable Fabric Session', () => {
  it('authenticates peers and exchanges AES-GCM stream bytes without platform globals', () => {
    const nodeRandom = deterministicRandom(1)
    const controllerRandom = deterministicRandom(101)
    const nodeKeys = generateFabricSessionKeyPair(nodeRandom)
    const controllerKeys = generateFabricSessionKeyPair(controllerRandom)
    const received: Uint8Array[] = []
    let ackedBytes = 0
    let sendFromNode: (data: Uint8Array) => void = () => {}
    let sendFromController: (data: Uint8Array) => void = () => {}
    const node = new FabricSession('node', nodeKeys.privateKeyBase64, {
      fabricId,
      linkId,
      expectedPeerPubkey: controllerKeys.publicKeyBase64,
      ourPublicKeyBase64: nodeKeys.publicKeyBase64,
      supportedCipherSuites: ['aes-256-gcm'],
      supportedCompressions: ['none'],
      randomBytes: nodeRandom,
      encodeOutboundEnvelope: encodeEnvelope,
    }, {
      send: data => sendFromNode(data),
      onStreamData: (streamId, data) => {
        received.push(data)
        node.reportStreamDataConsumed(streamId, data.byteLength)
        node.reportStreamDataConsumed(streamId, 0, { flush: true })
      },
    })
    const controller = new FabricSession('controller', controllerKeys.privateKeyBase64, {
      fabricId,
      linkId,
      expectedPeerPubkey: nodeKeys.publicKeyBase64,
      ourPublicKeyBase64: controllerKeys.publicKeyBase64,
      supportedCipherSuites: ['aes-256-gcm'],
      supportedCompressions: ['none'],
      randomBytes: controllerRandom,
      encodeOutboundEnvelope: encodeEnvelope,
    }, {
      send: data => sendFromController(data),
      onStreamAck: (_streamId, value) => {
        ackedBytes = value
      },
    })
    sendFromNode = data => controller.handleEnvelope(decodeFabricSessionEnvelope(data))
    sendFromController = data => node.handleEnvelope(decodeFabricSessionEnvelope(data))

    controller.start()
    expect(node.isReady).toBe(true)
    expect(controller.isReady).toBe(true)

    const payload = new TextEncoder().encode('portable mobile transport')
    controller.openStream('stream-mobile')
    controller.writeStreamData('stream-mobile', payload)
    expect(received).toEqual([payload])
    expect(ackedBytes).toBe(payload.byteLength)
  })
})
