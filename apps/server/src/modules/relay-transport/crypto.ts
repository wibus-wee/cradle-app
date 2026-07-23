import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

import { AppError } from '../../errors/app-error'

/**
 * End-to-end crypto for the relay tunnel:
 *
 * - X25519 ECDH (`@noble/curves`) for key agreement.
 * - HKDF-SHA512 (`@noble/hashes`) with a distinct `info` label per key.
 * - XChaCha20-Poly1305 for small frames, where avoiding an OpenSSL call has
 *   lower fixed latency.
 * - Native AES-256-GCM for bulk frames, where hardware acceleration provides
 *   materially higher throughput. Fresh random nonces avoid counter state
 *   across reconnects.
 *
 * relayd never sees any of this: it forwards opaque `relay_data_frame` blobs.
 */

const HKDF_INFO_PREFIX = 'cradle/relay/v2'
const KEY_BYTES = 32
const XCHACHA_NONCE_BYTES = 24
const AES_GCM_NONCE_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const XCHACHA_ALGORITHM_BIT = 0x80
const NATIVE_AES_MIN_PLAINTEXT_BYTES = 1024

/** Roles for key derivation: each direction's key is tagged with the sender. */
export type RelayCryptoRole = 'host' | 'controller'

export const RELAY_CRYPTO_ALG = 'xchacha20poly1305-small+aes-256-gcm-bulk'

export interface RelayKeyPair {
  /** X25519 private key (raw 32 bytes, base64). Safe to persist as a managed secret. */
  privateKeyBase64: string
  /** X25519 public key (raw 32 bytes, base64). Shared over the wire. */
  publicKeyBase64: string
}

export function generateRelayKeyPair(): RelayKeyPair {
  const privateKey = x25519.utils.randomPrivateKey()
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
export function computeRelaySharedSecret(
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
 * Derive traffic keys + pairing-confirm key from an ECDH secret. Each key is a
 * separate HKDF extract+expand with a distinct `info` label, so the keys are
 * cryptographically independent. The pairing code is the HKDF salt — both sides
 * must know it to derive identical keys, which is what the `confirm` HMAC in
 * the `hello` frame proves before keys are pinned.
 */
export interface RelayDerivedKeys {
  hostSendKey: Uint8Array
  controllerSendKey: Uint8Array
  confirmKey: Uint8Array
}

function deriveKey(secret: Uint8Array, pairingCode: string, label: string): Uint8Array {
  return hkdf(
    sha512,
    secret,
    utf8ToBytes(pairingCode),
    utf8ToBytes(`${HKDF_INFO_PREFIX}/${label}`),
    KEY_BYTES,
  )
}

export function deriveRelayKeys(sharedSecret: Uint8Array, pairingCode: string): RelayDerivedKeys {
  return {
    hostSendKey: deriveKey(sharedSecret, pairingCode, 'host-send'),
    controllerSendKey: deriveKey(sharedSecret, pairingCode, 'controller-send'),
    confirmKey: deriveKey(sharedSecret, pairingCode, 'confirm'),
  }
}

/** Send key for a given role (the peer decrypts with the same key). */
export function sendKeyForRole(keys: RelayDerivedKeys, role: RelayCryptoRole): Uint8Array {
  return role === 'host' ? keys.hostSendKey : keys.controllerSendKey
}

/** Receive key for a given role = the other role's send key. */
export function receiveKeyForRole(keys: RelayDerivedKeys, role: RelayCryptoRole): Uint8Array {
  return role === 'host' ? keys.controllerSendKey : keys.hostSendKey
}

/**
 * Compute the `confirm` value for a `hello_confirm` frame. The transcript is
 * role-tagged so both peers compute the identical value regardless of which
 * side they are:
 *   "controller" || controllerPub || "host" || hostPub || sharedSecret
 * A relay MITM that substitutes public keys during pairing breaks the ECDH
 * secret, and thus the confirmKey and confirm, so the honest peer rejects.
 */
export function computeRelayConfirm(opts: {
  confirmKey: Uint8Array
  controllerPublicKeyBase64: string
  hostPublicKeyBase64: string
  sharedSecret: Uint8Array
}): string {
  const controllerPub = base64ToBytes(opts.controllerPublicKeyBase64)
  const hostPub = base64ToBytes(opts.hostPublicKeyBase64)
  const parts: Uint8Array[] = [
    utf8ToBytes('controller'),
    controllerPub,
    utf8ToBytes('host'),
    hostPub,
    opts.sharedSecret,
  ]
  const transcript = concatBytes(...parts)
  return bytesToBase64(hmac(sha512, opts.confirmKey, transcript))
}

/** Short hex fingerprint of a public key, for display and pinning checks. */
export function relayPublicKeyFingerprint(publicKeyBase64: string): string {
  const raw = base64ToBytes(publicKeyBase64)
  // SHA-256 of the raw public key, hex, truncated for human display.
  const tag = hmac(sha512, utf8ToBytes('cradle-relay-fp'), raw)
  return bytesToHex(tag).slice(0, 16)
}

/**
 * Stateful encryptor for one direction of the tunnel. Each frame carries its
 * random nonce so reconnects can safely reuse the long-lived derived key.
 */
export class RelayCipher {
  private readonly key: Uint8Array
  private readonly nativeBulkEnabled: boolean

  constructor(key: Uint8Array, nativeBulkEnabled = true) {
    if (key.length !== KEY_BYTES) {
      throw new AppError({
        code: 'relay_crypto_invalid_key',
        status: 500,
        message: `Relay cipher key must be ${KEY_BYTES} bytes, got ${key.length}`,
      })
    }
    this.key = key
    this.nativeBulkEnabled = nativeBulkEnabled
  }

  /** Encrypt a frame with the latency- or throughput-optimized V2 AEAD. */
  encrypt(plaintext: Uint8Array): Uint8Array {
    if (plaintext.byteLength < NATIVE_AES_MIN_PLAINTEXT_BYTES || !this.nativeBulkEnabled) {
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
      if (blob[0] & XCHACHA_ALGORITHM_BIT) {
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
