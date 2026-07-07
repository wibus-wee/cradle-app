import { describe, expect, it, vi } from 'vitest'

import { generateRelayKeyPair } from '../../src/modules/relay-transport/crypto'
import type { RelayEnvelope } from '../../src/modules/relay-transport/protocol'
import { relayEnvelopeSchema } from '../../src/modules/relay-transport/protocol'
import { RelaySession } from '../../src/modules/relay-transport/session'

/**
 * Wire two sessions together as if relayd were forwarding envelopes between
 * them. Returns a pair of send callbacks; each stamps the roomId and hands the
 * envelope to the peer's handleEnvelope.
 */
function wireSessions(
  host: RelaySession,
  controller: RelaySession,
  roomId: string,
): { hostSend: (data: string) => void, controllerSend: (data: string) => void } {
  const hostSend = (data: string) => {
    const env = relayEnvelopeSchema.parse(JSON.parse(data))
    controller.handleEnvelope({ ...env, roomId })
  }
  const controllerSend = (data: string) => {
    const env = relayEnvelopeSchema.parse(JSON.parse(data))
    host.handleEnvelope({ ...env, roomId })
  }
  return { hostSend, controllerSend }
}

describe('relay session', () => {
  it('completes the first-pairing handshake and exchanges stream data end-to-end', () => {
    const hostKeys = generateRelayKeyPair()
    const controllerKeys = generateRelayKeyPair()
    const pairingCode = 'PAIR-ABCD'
    const roomId = 'room_test_1'

    const hostReady = vi.fn()
    const controllerReady = vi.fn()
    const hostStreamOpen = vi.fn()
    const hostStreamData: Array<{ streamId: string, data: Uint8Array }> = []

    const host = new RelaySession(
      'host',
      hostKeys.privateKeyBase64,
      { roomId, pairingCode, ourPublicKeyBase64: hostKeys.publicKeyBase64 },
      {
        send: () => {},
        onReady: hostReady,
        onStreamOpen: hostStreamOpen,
        onStreamData: (streamId, data) => hostStreamData.push({ streamId, data }),
      },
    )
    const controller = new RelaySession(
      'controller',
      controllerKeys.privateKeyBase64,
      { roomId, pairingCode, ourPublicKeyBase64: controllerKeys.publicKeyBase64 },
      { send: () => {}, onReady: controllerReady },
    )

    // Rebind the send callbacks now that both sessions exist.
    const wire = wireSessions(host, controller, roomId)
    ;(host as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.hostSend
    ;(controller as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.controllerSend

    host.start()
    controller.start()

    expect(hostReady).toHaveBeenCalledTimes(1)
    expect(controllerReady).toHaveBeenCalledTimes(1)
    expect(host.isReady).toBe(true)
    expect(controller.isReady).toBe(true)
    expect(host.peerPublicKey).toBe(controllerKeys.publicKeyBase64)
    expect(controller.peerPublicKey).toBe(hostKeys.publicKeyBase64)

    // Controller opens a stream and sends data; host receives it.
    controller.openStream('c1')
    expect(hostStreamOpen).toHaveBeenCalledWith('c1')

    const payload = new TextEncoder().encode('hello over the relay tunnel')
    controller.writeStreamData('c1', payload)

    expect(hostStreamData).toHaveLength(1)
    expect(hostStreamData[0].streamId).toBe('c1')
    expect(Buffer.from(hostStreamData[0].data).equals(Buffer.from(payload))).toBe(true)
  })

  it('reconnects using a pinned peer pubkey (no confirm exchange)', () => {
    const hostKeys = generateRelayKeyPair()
    const controllerKeys = generateRelayKeyPair()
    const roomId = 'room_reconnect'

    const hostReady = vi.fn()
    const controllerReady = vi.fn()

    const host = new RelaySession(
      'host',
      hostKeys.privateKeyBase64,
      { roomId, pinnedPeerPubkey: controllerKeys.publicKeyBase64, ourPublicKeyBase64: hostKeys.publicKeyBase64 },
      { send: () => {}, onReady: hostReady },
    )
    const controller = new RelaySession(
      'controller',
      controllerKeys.privateKeyBase64,
      { roomId, pinnedPeerPubkey: hostKeys.publicKeyBase64, ourPublicKeyBase64: controllerKeys.publicKeyBase64 },
      { send: () => {}, onReady: controllerReady },
    )

    const wire = wireSessions(host, controller, roomId)
    ;(host as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.hostSend
    ;(controller as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.controllerSend

    host.start()
    controller.start()

    // No pairing code → no hello_confirm exchange, but pinning makes both ready.
    expect(hostReady).toHaveBeenCalledTimes(1)
    expect(controllerReady).toHaveBeenCalledTimes(1)
  })

  it('rejects a reconnect when a MITM substitutes the peer pubkey', () => {
    const hostKeys = generateRelayKeyPair()
    const controllerKeys = generateRelayKeyPair()
    const mitmKeys = generateRelayKeyPair()
    const roomId = 'room_mitm'

    const hostError = vi.fn()
    const controllerError = vi.fn()
    const host = new RelaySession(
      'host',
      hostKeys.privateKeyBase64,
      { roomId, pinnedPeerPubkey: controllerKeys.publicKeyBase64, ourPublicKeyBase64: hostKeys.publicKeyBase64 },
      { send: () => {}, onError: hostError },
    )
    // Real controller, pinned to the host.
    const controller = new RelaySession(
      'controller',
      controllerKeys.privateKeyBase64,
      { roomId, pinnedPeerPubkey: hostKeys.publicKeyBase64, ourPublicKeyBase64: controllerKeys.publicKeyBase64 },
      { send: () => {}, onError: controllerError },
    )

    // Simulate a relay MITM: it rewrites the pubkey on each forwarded hello to
    // its own, so each honest peer sees the MITM's pubkey where it expects the
    // real peer's. At least one honest peer must reject (whichever receives the
    // rewritten hello first); in a real relay the detection is symmetric.
    const wire = (b: RelaySession) => (data: string) => {
      const env = relayEnvelopeSchema.parse(JSON.parse(data))
      if (env.payload && typeof env.payload === 'object' && (env.payload as { kind?: string }).kind === 'hello') {
        const rewritten = { ...(env.payload as object), pubkey: mitmKeys.publicKeyBase64 }
        b.handleEnvelope({ ...env, roomId, payload: rewritten })
        return
      }
      b.handleEnvelope({ ...env, roomId })
    }
    ;(host as unknown as { cb: { send: (d: string) => void } }).cb.send = wire(controller)
    ;(controller as unknown as { cb: { send: (d: string) => void } }).cb.send = wire(host)

    host.start()
    controller.start()

    expect(hostError.mock.calls.length + controllerError.mock.calls.length).toBeGreaterThan(0)
    expect(host.isReady).toBe(false)
    expect(controller.isReady).toBe(false)
  })

  it('rejects a first-pairing handshake when the pairing code differs', () => {
    const hostKeys = generateRelayKeyPair()
    const controllerKeys = generateRelayKeyPair()
    const roomId = 'room_code_mismatch'

    const hostError = vi.fn()
    const controllerError = vi.fn()

    const host = new RelaySession(
      'host',
      hostKeys.privateKeyBase64,
      { roomId, pairingCode: 'RIGHT-CODE', ourPublicKeyBase64: hostKeys.publicKeyBase64 },
      { send: () => {}, onError: hostError },
    )
    const controller = new RelaySession(
      'controller',
      controllerKeys.privateKeyBase64,
      { roomId, pairingCode: 'WRONG-CODE', ourPublicKeyBase64: controllerKeys.publicKeyBase64 },
      { send: () => {}, onError: controllerError },
    )

    const wire = wireSessions(host, controller, roomId)
    ;(host as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.hostSend
    ;(controller as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.controllerSend

    host.start()
    controller.start()

    // The confirm values won't match → at least one side errors.
    expect(hostError.mock.calls.length + controllerError.mock.calls.length).toBeGreaterThan(0)
  })

  it('does not mark ready when an encrypted stream frame arrives before the handshake', () => {
    const hostKeys = generateRelayKeyPair()

    const host = new RelaySession(
      'host',
      hostKeys.privateKeyBase64,
      { roomId: 'r', pairingCode: 'CODE', ourPublicKeyBase64: hostKeys.publicKeyBase64 },
      { send: () => {}, onError: () => {} },
    )

    // A bare plaintext stream_open injected pre-handshake must be rejected.
    const malicious: RelayEnvelope = {
      version: 1,
      roomId: 'r',
      seq: 99,
      kind: 'relay_data_frame',
      payload: { kind: 'stream_open', streamId: 'evil' },
    }
    host.handleEnvelope(malicious)
    expect(host.isReady).toBe(false)
  })

  it('chunks large stream data across multiple frames and reassembles', () => {
    const hostKeys = generateRelayKeyPair()
    const controllerKeys = generateRelayKeyPair()
    const pairingCode = 'PAIR-LARGE'
    const roomId = 'room_large'

    const hostStreamData: Uint8Array[] = []
    const host = new RelaySession(
      'host',
      hostKeys.privateKeyBase64,
      { roomId, pairingCode, ourPublicKeyBase64: hostKeys.publicKeyBase64 },
      {
        send: () => {},
        onStreamOpen: () => {},
        onStreamData: (_streamId, data) => hostStreamData.push(data),
      },
    )
    const controller = new RelaySession(
      'controller',
      controllerKeys.privateKeyBase64,
      { roomId, pairingCode, ourPublicKeyBase64: controllerKeys.publicKeyBase64 },
      { send: () => {} },
    )

    const wire = wireSessions(host, controller, roomId)
    ;(host as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.hostSend
    ;(controller as unknown as { cb: { send: (d: string) => void } }).cb.send = wire.controllerSend

    host.start()
    controller.start()

    controller.openStream('c1')
    // 1 MiB payload — forces multiple 256 KiB chunks.
    const payload = new Uint8Array(1024 * 1024)
    for (let i = 0; i < payload.length; i++) {
      payload[i] = i & 0xFF
    }
    controller.writeStreamData('c1', payload)

    const reassembled = Buffer.concat(hostStreamData.map(chunk => Buffer.from(chunk)))
    expect(reassembled.length).toBe(payload.length)
    expect(reassembled.equals(Buffer.from(payload))).toBe(true)
  })
})
