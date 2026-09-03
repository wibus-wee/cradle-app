import { randomBytes } from 'node:crypto'

import type {
  FabricSessionCallbacks,
  FabricSessionOptions as PortableFabricSessionOptions,
  FabricSessionRole,
} from '@cradle/fabric-protocol'
import {
  FabricSession as PortableFabricSession,
  RELAY_COMPRESSION_KIND,
} from '@cradle/fabric-protocol'

import {
  decodeRelayChunk,
  encodeRelayChunk,
  RELAY_MIN_COMPRESSION_INPUT_BYTES,
} from './compression'
import { FabricSessionCipher } from './crypto'

export type {
  FabricSessionCallbacks,
  FabricSessionEncodedChunk,
  FabricSessionOutboundEnvelope,
  FabricSessionRole,
} from '@cradle/fabric-protocol'

export type FabricSessionOptions = Omit<PortableFabricSessionOptions, 'cipherFactory' | 'compressionCodec' | 'randomBytes'>

const nodeCompressionCodec = {
  kind: RELAY_COMPRESSION_KIND.zstd,
  minInputBytes: RELAY_MIN_COMPRESSION_INPUT_BYTES,
  encode: encodeRelayChunk,
  decode: decodeRelayChunk,
} as const

export class FabricSession extends PortableFabricSession {
  constructor(
    role: FabricSessionRole,
    ourPrivateKeyBase64: string,
    options: FabricSessionOptions,
    callbacks: FabricSessionCallbacks,
  ) {
    super(role, ourPrivateKeyBase64, {
      ...options,
      randomBytes: length => randomBytes(length),
      cipherFactory: (key, suite) => new FabricSessionCipher(key, suite),
      compressionCodec: nodeCompressionCodec,
      supportedCompressions: options.supportedCompressions ?? [
        RELAY_COMPRESSION_KIND.zstd,
        RELAY_COMPRESSION_KIND.none,
      ],
    }, callbacks)
  }
}
