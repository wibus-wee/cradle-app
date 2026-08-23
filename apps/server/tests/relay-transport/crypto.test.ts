import { describe, expect, it } from 'vitest'

import {
  computeFabricSharedSecret,
  deriveFabricSessionKeys,
  FABRIC_CIPHER_SUITE,
  fabricPublicKeyFingerprint,
  FabricSessionCipher,
  generateFabricSessionKeyPair,
  loadPrivateKeyBytes,
  publicKeyFromPrivate,
  receiveKeyForRole,
  sendKeyForRole,
} from '../../src/modules/relay-transport/crypto'

describe('relay crypto', () => {
  it('derives matching ECDH shared secrets from both sides', () => {
    const node = generateFabricSessionKeyPair()
    const controller = generateFabricSessionKeyPair()

    const nodeSecret = computeFabricSharedSecret(node.privateKeyBase64, controller.publicKeyBase64)
    const controllerSecret = computeFabricSharedSecret(controller.privateKeyBase64, node.publicKeyBase64)

    expect(Buffer.from(nodeSecret).equals(Buffer.from(controllerSecret))).toBe(true)
  })

  it('derives matching traffic keys for the same Fabric link', () => {
    const node = generateFabricSessionKeyPair()
    const controller = generateFabricSessionKeyPair()
    const nodeSecret = computeFabricSharedSecret(node.privateKeyBase64, controller.publicKeyBase64)
    const controllerSecret = computeFabricSharedSecret(controller.privateKeyBase64, node.publicKeyBase64)

    const nodeKeys = deriveFabricSessionKeys(nodeSecret, { fabricId: 'fabric-a', linkId: 'link-a' })
    const controllerKeys = deriveFabricSessionKeys(controllerSecret, { fabricId: 'fabric-a', linkId: 'link-a' })

    expect(Buffer.from(nodeKeys.nodeSendKey).equals(Buffer.from(controllerKeys.nodeSendKey))).toBe(true)
    expect(Buffer.from(nodeKeys.controllerSendKey).equals(Buffer.from(controllerKeys.controllerSendKey))).toBe(true)
  })

  it('derives different keys when the Fabric link context differs', () => {
    const node = generateFabricSessionKeyPair()
    const controller = generateFabricSessionKeyPair()
    const secret = computeFabricSharedSecret(node.privateKeyBase64, controller.publicKeyBase64)

    const a = deriveFabricSessionKeys(secret, { fabricId: 'fabric-a', linkId: 'link-a' })
    const b = deriveFabricSessionKeys(secret, { fabricId: 'fabric-b', linkId: 'link-b' })

    expect(Buffer.from(a.nodeSendKey).equals(Buffer.from(b.nodeSendKey))).toBe(false)
  })

  it('round-trips AEAD encryption with per-direction keys', () => {
    const node = generateFabricSessionKeyPair()
    const controller = generateFabricSessionKeyPair()
    const secret = computeFabricSharedSecret(node.privateKeyBase64, controller.publicKeyBase64)
    const keys = deriveFabricSessionKeys(secret, { fabricId: 'fabric-a', linkId: 'link-a' })

    // The Node encrypts with its send key; the Controller decrypts with it.
    const nodeSender = new FabricSessionCipher(sendKeyForRole(keys, 'node'))
    const controllerReceiver = new FabricSessionCipher(receiveKeyForRole(keys, 'controller'))

    const plaintext = new TextEncoder().encode('hello relay tunnel — end to end')
    const sealed = nodeSender.encrypt(plaintext)
    const opened = controllerReceiver.decrypt(sealed)

    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true)
  })

  it('produces a fresh ciphertext (random nonce) per encryption', () => {
    const keys = deriveFabricSessionKeys(new Uint8Array(32).fill(1), { fabricId: 'fabric-a', linkId: 'link-a' })
    const cipher = new FabricSessionCipher(sendKeyForRole(keys, 'node'))
    const plaintext = new TextEncoder().encode('same input')

    const a = cipher.encrypt(plaintext)
    const b = cipher.encrypt(plaintext)

    expect(a).not.toBe(b)
    expect(cipher.decrypt(a)).toEqual(plaintext)
    expect(cipher.decrypt(b)).toEqual(plaintext)
  })

  it('keeps the benchmark baseline on XChaCha for bulk frames', () => {
    const cipher = new FabricSessionCipher(new Uint8Array(32).fill(7), FABRIC_CIPHER_SUITE.xchacha20Poly1305)
    const plaintext = new Uint8Array(64 * 1024)
    const sealed = cipher.encrypt(plaintext)

    expect(sealed.byteLength).toBe(plaintext.byteLength + 40)
    expect(sealed[0] & 0x80).toBe(0x80)
    expect(cipher.decrypt(sealed)).toEqual(plaintext)
  })

  it('rejects tampered ciphertext (auth tag verification)', () => {
    const keys = deriveFabricSessionKeys(new Uint8Array(32).fill(1), { fabricId: 'fabric-a', linkId: 'link-a' })
    const cipher = new FabricSessionCipher(sendKeyForRole(keys, 'node'))
    const sealed = cipher.encrypt(new TextEncoder().encode('payload'))

    const buf = Buffer.from(sealed, 'base64')
    buf[buf.length - 1] ^= 0x01 // flip a bit in the auth tag
    const tampered = new Uint8Array(buf)

    expect(() => cipher.decrypt(tampered)).toThrow()
  })

  it('round-trips a private key through storage and re-derives the public key', () => {
    const pair = generateFabricSessionKeyPair()
    const reloaded = publicKeyFromPrivate(pair.privateKeyBase64)
    expect(reloaded).toBe(pair.publicKeyBase64)
    expect(loadPrivateKeyBytes(pair.privateKeyBase64).length).toBe(32)
  })

  it('produces stable, distinct fingerprints', () => {
    const a = generateFabricSessionKeyPair()
    const b = generateFabricSessionKeyPair()
    const fpA = fabricPublicKeyFingerprint(a.publicKeyBase64)
    const fpA2 = fabricPublicKeyFingerprint(a.publicKeyBase64)
    const fpB = fabricPublicKeyFingerprint(b.publicKeyBase64)

    expect(fpA).toBe(fpA2) // stable
    expect(fpA).not.toBe(fpB) // distinct
    expect(fpA).toMatch(/^[0-9a-f]{16}$/)
  })
})
