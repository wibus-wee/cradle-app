import { gcm } from '@noble/ciphers/aes.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

import { base64ToBytes, bytesToBase64 } from './bytes'
import { FabricProtocolError } from './error'
import type { FabricCipherSuite } from './session-codec'
import { FABRIC_CIPHER_SUITE } from './session-codec'

/**
 * End-to-end crypto for one Fabric Session:
 *
 * - X25519 ECDH (`@noble/curves`) for key agreement.
 * - HKDF-SHA512 (`@noble/hashes`) with a distinct `info` label per key.
 * - A session-negotiated AEAD: native AES-256-GCM or XChaCha20-Poly1305.
 * - Fresh random nonces, avoiding counter state across reconnects.
 *
 * relayd never sees any of this: it forwards opaque Fabric envelope payloads.
 */

const HKDF_INFO_PREFIX = 'cradle/fabric/session/v1'
const KEY_BYTES = 32
const XCHACHA_NONCE_BYTES = 24
const AES_GCM_NONCE_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const XCHACHA_ALGORITHM_BIT = 0x80
/** Roles for key derivation: each direction's key is tagged with the sender. */
export type FabricSessionRole = 'node' | 'controller'

export const RELAY_CRYPTO_ALG = 'negotiated:aes-256-gcm|xchacha20poly1305'

export interface FabricSessionKeyPair {
  /** X25519 private key (raw 32 bytes, base64). Safe to persist as a managed secret. */
  privateKeyBase64: string
  /** X25519 public key (raw 32 bytes, base64). Shared over the wire. */
  publicKeyBase64: string
}

export type SecureRandomBytes = (length: number) => Uint8Array

export function generateFabricSessionKeyPair(randomBytes: SecureRandomBytes): FabricSessionKeyPair {
  const privateKey = randomBytes(32)
  if (privateKey.length !== 32) {
    throw new FabricProtocolError('relay_crypto_random_failed', `Secure random source returned ${privateKey.length} bytes, expected 32.`)
  }
  const publicKey = x25519.scalarMultBase(privateKey)
  return {
    privateKeyBase64: bytesToBase64(privateKey),
    publicKeyBase64: bytesToBase64(publicKey),
  }
}

/** Decode a stored base64 private key back to raw 32 bytes. */
export function loadPrivateKeyBytes(privateKeyBase64: string): Uint8Array {
  const raw = base64ToBytes(privateKeyBase64)
  if (raw.length !== 32) {
    throw new FabricProtocolError('relay_crypto_invalid_private_key', `Relay private key must be 32 bytes, got ${raw.length}.`)
  }
  return raw
}

/** Derive the public key from a stored private key (verifies it round-trips). */
export function publicKeyFromPrivate(privateKeyBase64: string): string {
  return bytesToBase64(x25519.scalarMultBase(loadPrivateKeyBytes(privateKeyBase64)))
}

/**
 * Compute the X25519 shared secret from our private key and the peer's raw
 * public key (base64, 32 bytes). Returns 32 raw bytes.
 */
export function computeFabricSharedSecret(
  ourPrivateKeyBase64: string,
  peerPublicKeyBase64: string,
): Uint8Array {
  const ourPrivate = loadPrivateKeyBytes(ourPrivateKeyBase64)
  const peerPublic = base64ToBytes(peerPublicKeyBase64)
  if (peerPublic.length !== 32) {
    throw new FabricProtocolError('relay_crypto_invalid_peer_public_key', `Expected 32-byte X25519 public key, got ${peerPublic.length} bytes.`)
  }
  try {
    return x25519.getSharedSecret(ourPrivate, peerPublic)
  }
  catch (error) {
    throw new FabricProtocolError('relay_crypto_invalid_peer_public_key', `ECDH failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Derive independent directional traffic keys from the ECDH secret and the
 * authenticated Fabric route. The route context prevents key reuse across
 * Fabric links while the certificates bind the public keys to their peers.
 */
export interface FabricSessionKeys {
  nodeSendKey: Uint8Array
  controllerSendKey: Uint8Array
}

export interface FabricSessionContext {
  fabricId: string
  linkId: string
}

function deriveKey(secret: Uint8Array, context: FabricSessionContext, label: string): Uint8Array {
  return hkdf(
    sha512,
    secret,
    utf8ToBytes(`${context.fabricId}\u0000${context.linkId}`),
    utf8ToBytes(`${HKDF_INFO_PREFIX}/${label}`),
    KEY_BYTES,
  )
}

export function deriveFabricSessionKeys(sharedSecret: Uint8Array, context: FabricSessionContext): FabricSessionKeys {
  return {
    nodeSendKey: deriveKey(sharedSecret, context, 'node-send'),
    controllerSendKey: deriveKey(sharedSecret, context, 'controller-send'),
  }
}

/** Send key for a given role (the peer decrypts with the same key). */
export function sendKeyForRole(keys: FabricSessionKeys, role: FabricSessionRole): Uint8Array {
  return role === 'node' ? keys.nodeSendKey : keys.controllerSendKey
}

/** Receive key for a given role = the other role's send key. */
export function receiveKeyForRole(keys: FabricSessionKeys, role: FabricSessionRole): Uint8Array {
  return role === 'node' ? keys.controllerSendKey : keys.nodeSendKey
}

/** Short hex fingerprint of a public key, for display and pinning checks. */
export function fabricPublicKeyFingerprint(publicKeyBase64: string): string {
  const raw = base64ToBytes(publicKeyBase64)
  // SHA-256 of the raw public key, hex, truncated for human display.
  const tag = hmac(sha512, utf8ToBytes('cradle-relay-fp'), raw)
  return bytesToHex(tag).slice(0, 16)
}

/**
 * Stateful encryptor for one direction of the tunnel. Each frame carries its
 * random nonce so reconnects can safely reuse the long-lived derived key.
 */
export class FabricSessionCipher {
  private readonly key: Uint8Array
  private readonly randomBytes: SecureRandomBytes
  readonly suite: FabricCipherSuite

  constructor(key: Uint8Array, suite: FabricCipherSuite, randomBytes: SecureRandomBytes) {
    if (key.length !== KEY_BYTES) {
      throw new FabricProtocolError('relay_crypto_invalid_key', `Relay cipher key must be ${KEY_BYTES} bytes, got ${key.length}`)
    }
    this.key = key
    this.suite = suite
    this.randomBytes = randomBytes
  }

  /** Encrypt a frame with the AEAD selected during the Fabric hello exchange. */
  encrypt(plaintext: Uint8Array): Uint8Array {
    if (this.suite === FABRIC_CIPHER_SUITE.xchacha20Poly1305) {
      const nonce = this.randomNonce(XCHACHA_NONCE_BYTES)
      nonce[0] = nonce[0]! | XCHACHA_ALGORITHM_BIT
      return concatBytes(nonce, xchacha20poly1305(this.key, nonce).encrypt(plaintext))
    }
    const nonce = this.randomNonce(AES_GCM_NONCE_BYTES)
    nonce[0] = nonce[0]! & ~XCHACHA_ALGORITHM_BIT
    return concatBytes(nonce, gcm(this.key, nonce).encrypt(plaintext))
  }

  /** Decrypt a raw blob produced by the peer's matching cipher. */
  decrypt(blob: Uint8Array): Uint8Array {
    if (blob.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
      throw new FabricProtocolError('relay_crypto_decrypt_failed', 'Relay ciphertext too short.')
    }
    try {
      const encodedSuite = blob[0]! & XCHACHA_ALGORITHM_BIT
        ? FABRIC_CIPHER_SUITE.xchacha20Poly1305
        : FABRIC_CIPHER_SUITE.aes256Gcm
      if (encodedSuite !== this.suite) {
        throw new Error(`Relay ciphertext uses ${encodedSuite}, expected ${this.suite}.`)
      }
      if (encodedSuite === FABRIC_CIPHER_SUITE.xchacha20Poly1305) {
        if (blob.length < XCHACHA_NONCE_BYTES + AES_GCM_TAG_BYTES) {
          throw new Error('Relay XChaCha ciphertext is too short.')
        }
        const nonce = blob.subarray(0, XCHACHA_NONCE_BYTES)
        return xchacha20poly1305(this.key, nonce).decrypt(blob.subarray(XCHACHA_NONCE_BYTES))
      }
      const nonce = blob.subarray(0, AES_GCM_NONCE_BYTES)
      return gcm(this.key, nonce).decrypt(blob.subarray(AES_GCM_NONCE_BYTES))
    }
    catch (error) {
      throw new FabricProtocolError('relay_crypto_decrypt_failed', `Relay decrypt failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private randomNonce(length: number): Uint8Array {
    const nonce = this.randomBytes(length)
    if (nonce.length !== length) {
      throw new FabricProtocolError('relay_crypto_random_failed', `Secure random source returned ${nonce.length} bytes, expected ${length}.`)
    }
    return nonce
  }
}

// ── byte helpers ──

function bytesToHex(bytes: Uint8Array): string {
  let output = ''
  for (const byte of bytes) { output += byte.toString(16).padStart(2, '0') }
  return output
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
