import { describe, expect, it } from 'vitest'

import {
  decodeRelayChunk,
  encodeRelayChunk,
  RELAY_COMPRESSION_KIND,
} from '../../src/modules/relay-transport/compression'
import { decodeInnerFrame, encodeInnerFrame } from '../../src/modules/relay-transport/protocol'

function incompressibleBytes(length: number): Uint8Array {
  let state = 0xA341_316C
  return Uint8Array.from({ length }, () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state & 0xFF
  })
}

describe('relay chunk compression', () => {
  it('compresses repetitive endpoint data and round-trips the exact plaintext', () => {
    const plaintext = new Uint8Array(64 * 1024).fill(7)
    const encoded = encodeRelayChunk(plaintext)

    expect(encoded.compression).toBe(RELAY_COMPRESSION_KIND.zstd)
    expect(encoded.data.byteLength).toBeLessThan(plaintext.byteLength)
    expect(decodeRelayChunk(encoded)).toEqual(plaintext)
  })

  it('keeps incompressible data raw and never expands the wire', () => {
    const plaintext = incompressibleBytes(64 * 1024)
    const encoded = encodeRelayChunk(plaintext)

    expect(encoded.compression).toBe(RELAY_COMPRESSION_KIND.none)
    expect(encoded.data).toBe(plaintext)
    expect(decodeRelayChunk(encoded)).toBe(plaintext)
  })

  it('skips tiny chunks to preserve interactive latency', () => {
    const plaintext = new Uint8Array(512).fill(7)
    const encoded = encodeRelayChunk(plaintext)

    expect(encoded.compression).toBe(RELAY_COMPRESSION_KIND.none)
    expect(encoded.data).toBe(plaintext)
  })

  it('rejects a forged decompressed length before allocating output', () => {
    const encoded = encodeRelayChunk(new Uint8Array(64 * 1024).fill(7))

    expect(() => decodeRelayChunk({
      ...encoded,
      uncompressedBytes: 64 * 1024 + 1,
    })).toThrow('invalid output length')
  })

  it('rejects corrupted compressed bytes', () => {
    const encoded = encodeRelayChunk(new Uint8Array(64 * 1024).fill(7))
    const corrupted = encoded.data.slice()
    corrupted[Math.floor(corrupted.byteLength / 2)] ^= 0xFF

    expect(() => decodeRelayChunk({ ...encoded, data: corrupted })).toThrow()
  })

  it('preserves the compact raw frame and round-trips the compressed frame code', () => {
    const rawData = incompressibleBytes(4 * 1024)
    const raw = encodeInnerFrame({
      kind: 'stream_data',
      streamId: 's1',
      seq: 10,
      data: rawData,
    })
    expect(raw[0]).toBe(4)
    expect(raw.byteLength).toBe(7 + 2 + rawData.byteLength)
    expect(decodeInnerFrame(raw)).toEqual({
      kind: 'stream_data',
      streamId: 's1',
      seq: 10,
      data: rawData,
    })

    const compressed = encodeRelayChunk(new Uint8Array(4 * 1024).fill(7))
    const encoded = encodeInnerFrame({
      kind: 'stream_data',
      streamId: 's1',
      seq: 10,
      data: compressed.data,
      compression: 'zstd',
      uncompressedBytes: compressed.uncompressedBytes,
    })
    expect(encoded[0]).toBe(7)
    expect(decodeInnerFrame(encoded)).toEqual({
      kind: 'stream_data',
      streamId: 's1',
      seq: 10,
      data: compressed.data,
      compression: 'zstd',
      uncompressedBytes: compressed.uncompressedBytes,
    })
  })
})
