import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

import { AppError } from '../../errors/app-error'

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
export const FABRIC_CIPHER_SUITE = {
  aes256Gcm: 'aes-256-gcm',
  xchacha20Poly1305: 'xchacha20poly1305',
} as const

export type FabricCipherSuite = (typeof FABRIC_CIPHER_SUITE)[keyof typeof FABRIC_CIPHER_SUITE]

/** Roles for key derivation: each direction's key is tagged with the sender. */
export type FabricSessionRole = 'node' | 'controller'

export const RELAY_CRYPTO_ALG = 'negotiated:aes-256-gcm|xchacha20poly1305'

export interface FabricSessionKeyPair {
  /** X25519 private key (raw 32 bytes, base64). Safe to persist as a managed secret. */
  privateKeyBase64: string
  /** X25519 public key (raw 32 bytes, base64). Shared over the wire. */
  publicKeyBase64: string
}

export function generateFabricSessionKeyPair(): FabricSessionKeyPair {
  const privateKey = x25519.utils.randomSecretKey()
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
    throw new AppError({
      code: 'relay_crypto_invalid_private_key',
      status: 500,
      message: `Relay private key must be 32 bytes, got ${raw.length}.`,
    })
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
    throw new AppError({
      code: 'relay_crypto_invalid_peer_public_key',
      status: 400,
      message: `Expected 32-byte X25519 public key, got ${peerPublic.length} bytes.`,
    })
  }
  try {
    return x25519.getSharedSecret(ourPrivate, peerPublic)
  }
 catch (error) {
    throw new AppError({
      code: 'relay_crypto_invalid_peer_public_key',
      status: 400,
      message: `ECDH failed: ${error instanceof Error ? error.message : String(error)}`,
    })
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
  readonly suite: FabricCipherSuite

  constructor(key: Uint8Array, suite: FabricCipherSuite = FABRIC_CIPHER_SUITE.aes256Gcm) {
    if (key.length !== KEY_BYTES) {
      throw new AppError({
        code: 'relay_crypto_invalid_key',
        status: 500,
        message: `Relay cipher key must be ${KEY_BYTES} bytes, got ${key.length}`,
      })
    }
    this.key = key
    this.suite = suite
  }

  /** Encrypt a frame with the AEAD selected during the Fabric hello exchange. */
  encrypt(plaintext: Uint8Array): Uint8Array {
    if (this.suite === FABRIC_CIPHER_SUITE.xchacha20Poly1305) {
      const nonce = randomBytes(XCHACHA_NONCE_BYTES)
      nonce[0] |= XCHACHA_ALGORITHM_BIT
      return concatBytes(nonce, xchacha20poly1305(this.key, nonce).encrypt(plaintext))
    }
    const nonce = randomBytes(AES_GCM_NONCE_BYTES)
    nonce[0] &= ~XCHACHA_ALGORITHM_BIT
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    const ciphertext = cipher.update(plaintext)
    cipher.final()
    return concatBytes(nonce, ciphertext, cipher.getAuthTag())
  }

  /** Decrypt a raw blob produced by the peer's matching cipher. */
  decrypt(blob: Uint8Array): Uint8Array {
    if (blob.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
      throw new AppError({
        code: 'relay_crypto_decrypt_failed',
        status: 400,
        message: 'Relay ciphertext too short.',
      })
    }
    try {
      const encodedSuite = blob[0] & XCHACHA_ALGORITHM_BIT
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
      const ciphertext = blob.subarray(AES_GCM_NONCE_BYTES, -AES_GCM_TAG_BYTES)
      const tag = blob.subarray(-AES_GCM_TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', this.key, nonce)
      decipher.setAuthTag(tag)
      const plaintext = decipher.update(ciphertext)
      decipher.final()
      return new Uint8Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
    }
 catch (error) {
      throw new AppError({
        code: 'relay_crypto_decrypt_failed',
        status: 400,
        message: `Relay decrypt failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
}

// ── byte helpers ──

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
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
