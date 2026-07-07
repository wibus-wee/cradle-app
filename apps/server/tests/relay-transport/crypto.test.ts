import { describe, expect, it } from 'vitest'

import {
  computeRelayConfirm,
  computeRelaySharedSecret,
  deriveRelayKeys,
  generateRelayKeyPair,
  loadPrivateKeyBytes,
  publicKeyFromPrivate,
  receiveKeyForRole,
  RelayCipher,
  relayPublicKeyFingerprint,
  sendKeyForRole,
} from '../../src/modules/relay-transport/crypto'

describe('relay crypto', () => {
  it('derives matching ECDH shared secrets from both sides', () => {
    const host = generateRelayKeyPair()
    const controller = generateRelayKeyPair()

    const hostSecret = computeRelaySharedSecret(host.privateKeyBase64, controller.publicKeyBase64)
    const controllerSecret = computeRelaySharedSecret(controller.privateKeyBase64, host.publicKeyBase64)

    expect(Buffer.from(hostSecret).equals(Buffer.from(controllerSecret))).toBe(true)
  })

  it('derives matching traffic keys when the pairing code matches', () => {
    const host = generateRelayKeyPair()
    const controller = generateRelayKeyPair()
    const code = 'PAIR-1234'

    const hostSecret = computeRelaySharedSecret(host.privateKeyBase64, controller.publicKeyBase64)
    const controllerSecret = computeRelaySharedSecret(controller.privateKeyBase64, host.publicKeyBase64)

    const hostKeys = deriveRelayKeys(hostSecret, code)
    const controllerKeys = deriveRelayKeys(controllerSecret, code)

    expect(Buffer.from(hostKeys.hostSendKey).equals(Buffer.from(controllerKeys.hostSendKey))).toBe(true)
    expect(Buffer.from(hostKeys.controllerSendKey).equals(Buffer.from(controllerKeys.controllerSendKey))).toBe(true)
    expect(Buffer.from(hostKeys.confirmKey).equals(Buffer.from(controllerKeys.confirmKey))).toBe(true)
  })

  it('derives different keys when the pairing code differs', () => {
    const host = generateRelayKeyPair()
    const controller = generateRelayKeyPair()
    const secret = computeRelaySharedSecret(host.privateKeyBase64, controller.publicKeyBase64)

    const a = deriveRelayKeys(secret, 'CODE-A')
    const b = deriveRelayKeys(secret, 'CODE-B')

    expect(Buffer.from(a.hostSendKey).equals(Buffer.from(b.hostSendKey))).toBe(false)
    expect(Buffer.from(a.confirmKey).equals(Buffer.from(b.confirmKey))).toBe(false)
  })

  it('computes identical confirm values from both peers (canonical transcript)', () => {
    const host = generateRelayKeyPair()
    const controller = generateRelayKeyPair()
    const code = 'PAIR-XYZ'

    const hostSecret = computeRelaySharedSecret(host.privateKeyBase64, controller.publicKeyBase64)
    const controllerSecret = computeRelaySharedSecret(controller.privateKeyBase64, host.publicKeyBase64)
    const hostKeys = deriveRelayKeys(hostSecret, code)
    const controllerKeys = deriveRelayKeys(controllerSecret, code)

    const hostConfirm = computeRelayConfirm({
      confirmKey: hostKeys.confirmKey,
      controllerPublicKeyBase64: controller.publicKeyBase64,
      hostPublicKeyBase64: host.publicKeyBase64,
      sharedSecret: hostSecret,
    })
    const controllerConfirm = computeRelayConfirm({
      confirmKey: controllerKeys.confirmKey,
      controllerPublicKeyBase64: controller.publicKeyBase64,
      hostPublicKeyBase64: host.publicKeyBase64,
      sharedSecret: controllerSecret,
    })

    expect(hostConfirm).toBe(controllerConfirm)
  })

  it('round-trips AEAD encryption with per-direction keys', () => {
    const host = generateRelayKeyPair()
    const controller = generateRelayKeyPair()
    const secret = computeRelaySharedSecret(host.privateKeyBase64, controller.publicKeyBase64)
    const keys = deriveRelayKeys(secret, 'CODE')

    // Host encrypts with its send key; controller decrypts with the same key
    // (controller's "receive" key == host's send key).
    const hostSender = new RelayCipher(sendKeyForRole(keys, 'host'))
    const controllerReceiver = new RelayCipher(receiveKeyForRole(keys, 'controller'))

    const plaintext = new TextEncoder().encode('hello relay tunnel — end to end')
    const sealed = hostSender.encrypt(plaintext)
    const opened = controllerReceiver.decrypt(sealed)

    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true)
  })

  it('produces a fresh ciphertext (random nonce) per encryption', () => {
    const keys = deriveRelayKeys(new Uint8Array(32).fill(1), 'CODE')
    const cipher = new RelayCipher(sendKeyForRole(keys, 'host'))
    const plaintext = new TextEncoder().encode('same input')

    const a = cipher.encrypt(plaintext)
    const b = cipher.encrypt(plaintext)

    expect(a).not.toBe(b)
    expect(cipher.decrypt(a)).toEqual(plaintext)
    expect(cipher.decrypt(b)).toEqual(plaintext)
  })

  it('rejects tampered ciphertext (auth tag verification)', () => {
    const keys = deriveRelayKeys(new Uint8Array(32).fill(1), 'CODE')
    const cipher = new RelayCipher(sendKeyForRole(keys, 'host'))
    const sealed = cipher.encrypt(new TextEncoder().encode('payload'))

    const buf = Buffer.from(sealed, 'base64')
    buf[buf.length - 1] ^= 0x01 // flip a bit in the auth tag
    const tampered = buf.toString('base64')

    expect(() => cipher.decrypt(tampered)).toThrow()
  })

  it('round-trips a private key through storage and re-derives the public key', () => {
    const pair = generateRelayKeyPair()
    const reloaded = publicKeyFromPrivate(pair.privateKeyBase64)
    expect(reloaded).toBe(pair.publicKeyBase64)
    expect(loadPrivateKeyBytes(pair.privateKeyBase64).length).toBe(32)
  })

  it('produces stable, distinct fingerprints', () => {
    const a = generateRelayKeyPair()
    const b = generateRelayKeyPair()
    const fpA = relayPublicKeyFingerprint(a.publicKeyBase64)
    const fpA2 = relayPublicKeyFingerprint(a.publicKeyBase64)
    const fpB = relayPublicKeyFingerprint(b.publicKeyBase64)

    expect(fpA).toBe(fpA2) // stable
    expect(fpA).not.toBe(fpB) // distinct
    expect(fpA).toMatch(/^[0-9a-f]{16}$/)
  })
})
