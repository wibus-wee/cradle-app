import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { FabricCipherSuite } from '@cradle/fabric-protocol'
import {
  FABRIC_CIPHER_SUITE,
  FabricProtocolError,
  FabricSessionCipher as PortableFabricSessionCipher,
  generateFabricSessionKeyPair as generatePortableFabricSessionKeyPair,
} from '@cradle/fabric-protocol'

export type {
  FabricCipherSuite,
  FabricSessionContext,
  FabricSessionKeyPair,
  FabricSessionKeys,
  FabricSessionRole,
} from '@cradle/fabric-protocol'
export {
  computeFabricSharedSecret,
  deriveFabricSessionKeys,
  FABRIC_CIPHER_SUITE,
  fabricPublicKeyFingerprint,
  loadPrivateKeyBytes,
  publicKeyFromPrivate,
  receiveKeyForRole,
  RELAY_CRYPTO_ALG,
  sendKeyForRole,
} from '@cradle/fabric-protocol'

function nodeSecureRandomBytes(length: number): Uint8Array {
  return randomBytes(length)
}

const AES_GCM_NONCE_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const XCHACHA_ALGORITHM_BIT = 0x80

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export function generateFabricSessionKeyPair() {
  return generatePortableFabricSessionKeyPair(nodeSecureRandomBytes)
}

export class FabricSessionCipher extends PortableFabricSessionCipher {
  private readonly nodeKey: Uint8Array

  constructor(key: Uint8Array, suite: FabricCipherSuite = FABRIC_CIPHER_SUITE.aes256Gcm) {
    super(key, suite, nodeSecureRandomBytes)
    this.nodeKey = Uint8Array.from(key)
  }

  override encrypt(plaintext: Uint8Array): Uint8Array {
    if (this.suite === FABRIC_CIPHER_SUITE.xchacha20Poly1305) {
      return super.encrypt(plaintext)
    }

    const nonce = randomBytes(AES_GCM_NONCE_BYTES)
    nonce[0] = nonce[0]! & ~XCHACHA_ALGORITHM_BIT
    const cipher = createCipheriv('aes-256-gcm', this.nodeKey, nonce)
    const ciphertext = concatBytes(cipher.update(plaintext), cipher.final())
    return concatBytes(nonce, ciphertext, cipher.getAuthTag())
  }

  override decrypt(blob: Uint8Array): Uint8Array {
    if (this.suite === FABRIC_CIPHER_SUITE.xchacha20Poly1305) {
      return super.decrypt(blob)
    }
    if (blob.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES || (blob[0]! & XCHACHA_ALGORITHM_BIT) !== 0) {
      return super.decrypt(blob)
    }

    try {
      const nonce = blob.subarray(0, AES_GCM_NONCE_BYTES)
      const authTagOffset = blob.length - AES_GCM_TAG_BYTES
      const decipher = createDecipheriv('aes-256-gcm', this.nodeKey, nonce)
      decipher.setAuthTag(blob.subarray(authTagOffset))
      return concatBytes(
        decipher.update(blob.subarray(AES_GCM_NONCE_BYTES, authTagOffset)),
        decipher.final(),
      )
    }
    catch (error) {
      throw new FabricProtocolError('relay_crypto_decrypt_failed', `Relay decrypt failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
