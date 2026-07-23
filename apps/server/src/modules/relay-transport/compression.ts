import {
  constants as zlibConstants,
  zstdCompressSync,
  zstdDecompressSync,
} from 'node:zlib'

import { AppError } from '../../errors/app-error'
import { RELAY_MAX_STREAM_CHUNK_BYTES } from './protocol'

export const RELAY_COMPRESSION_KIND = {
  none: 'none',
  zstd: 'zstd',
} as const

export type RelayCompressionKind
  = (typeof RELAY_COMPRESSION_KIND)[keyof typeof RELAY_COMPRESSION_KIND]

export interface EncodedRelayChunk {
  data: Uint8Array
  compression: RelayCompressionKind
  uncompressedBytes: number
}

export const RELAY_MIN_COMPRESSION_INPUT_BYTES = 1024
const MIN_COMPRESSION_SAVINGS_BYTES = 64
const ZSTD_OPTIONS = {
  params: {
    [zlibConstants.ZSTD_c_compressionLevel]: 1,
  },
} as const

function bufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Compress one independently decodable stream chunk before encryption. Level 1
 * keeps compression below the cost of the old pure-JS cipher on 64 KiB chunks.
 * Incompressible and tiny chunks stay raw so compression never expands the wire.
 */
export function encodeRelayChunk(
  data: Uint8Array,
  compressionEnabled = true,
): EncodedRelayChunk {
  if (data.byteLength < RELAY_MIN_COMPRESSION_INPUT_BYTES || !compressionEnabled) {
    return {
      data,
      compression: RELAY_COMPRESSION_KIND.none,
      uncompressedBytes: data.byteLength,
    }
  }

  const compressed = zstdCompressSync(bufferView(data), ZSTD_OPTIONS)
  if (compressed.byteLength + MIN_COMPRESSION_SAVINGS_BYTES >= data.byteLength) {
    return {
      data,
      compression: RELAY_COMPRESSION_KIND.none,
      uncompressedBytes: data.byteLength,
    }
  }
  return {
    data: new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength),
    compression: RELAY_COMPRESSION_KIND.zstd,
    uncompressedBytes: data.byteLength,
  }
}

export function decodeRelayChunk(chunk: EncodedRelayChunk): Uint8Array {
  if (chunk.compression === RELAY_COMPRESSION_KIND.none) {
    if (chunk.data.byteLength !== chunk.uncompressedBytes) {
      throw compressionError('Raw Relay chunk length does not match its declared length.')
    }
    return chunk.data
  }
  if (
    chunk.uncompressedBytes <= 0
    || chunk.uncompressedBytes > RELAY_MAX_STREAM_CHUNK_BYTES
  ) {
    throw compressionError('Compressed Relay chunk declares an invalid output length.')
  }
  try {
    const decompressed = zstdDecompressSync(bufferView(chunk.data), {
      maxOutputLength: chunk.uncompressedBytes,
    })
    if (decompressed.byteLength !== chunk.uncompressedBytes) {
      throw compressionError('Compressed Relay chunk output length does not match its declaration.')
    }
    return new Uint8Array(
      decompressed.buffer,
      decompressed.byteOffset,
      decompressed.byteLength,
    )
  }
  catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw compressionError(
      `Relay chunk decompression failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function compressionError(message: string): AppError {
  return new AppError({
    code: 'relay_protocol_invalid_compression',
    status: 400,
    message,
  })
}
