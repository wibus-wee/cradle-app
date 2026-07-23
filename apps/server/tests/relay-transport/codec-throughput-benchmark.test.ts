import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import {
  decodeRelayChunk,
  encodeRelayChunk,
  RELAY_MIN_COMPRESSION_INPUT_BYTES,
} from '../../src/modules/relay-transport/compression'
import { RelayCipher } from '../../src/modules/relay-transport/crypto'
import { decodeInnerFrame, encodeInnerFrame } from '../../src/modules/relay-transport/protocol'

type PayloadProfile = 'compressible' | 'incompressible'

interface CodecResult {
  profile: PayloadProfile
  payloadBytes: number
  baselineWireBytes: number
  optimizedWireBytes: number
  baselineMiBps: number
  optimizedMiBps: number
  throughputImprovementPercent: number
  wireReductionPercent: number
}

const KEY = new Uint8Array(32).fill(7)
const BASELINE_CIPHER = new RelayCipher(KEY, false)
const OPTIMIZED_CIPHER = new RelayCipher(KEY)

function payloadFor(profile: PayloadProfile, length: number): Uint8Array {
  if (profile === 'compressible') {
    const record = Buffer.from('{"type":"delta","content":"relay benchmark payload"}\n')
    return Uint8Array.from({ length }, (_, index) => record[index % record.length])
  }
  let state = 0xA341_316C
  return Uint8Array.from({ length }, () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state & 0xFF
  })
}

function baselineRoundTrip(data: Uint8Array): { data: Uint8Array, wireBytes: number } {
  const plaintext = encodeInnerFrame({
    kind: 'stream_data',
    streamId: 'benchmark',
    seq: 0,
    data,
  })
  const sealed = BASELINE_CIPHER.encrypt(plaintext)
  const decoded = decodeInnerFrame(BASELINE_CIPHER.decrypt(sealed))
  if (decoded.kind !== 'stream_data') {
    throw new Error('Baseline codec returned a non-data frame.')
  }
  return {
    data: decoded.data,
    wireBytes: sealed.byteLength,
  }
}

function optimizedRoundTrip(data: Uint8Array): { data: Uint8Array, wireBytes: number } {
  const plaintext = data.byteLength < RELAY_MIN_COMPRESSION_INPUT_BYTES
    ? encodeInnerFrame({ kind: 'stream_data', streamId: 'benchmark', seq: 0, data })
    : (() => {
        const compressed = encodeRelayChunk(data)
        return encodeInnerFrame({
          kind: 'stream_data',
          streamId: 'benchmark',
          seq: 0,
          data: compressed.data,
          ...(compressed.compression === 'zstd'
            ? { compression: 'zstd' as const, uncompressedBytes: compressed.uncompressedBytes }
            : {}),
        })
      })()
  const sealed = OPTIMIZED_CIPHER.encrypt(plaintext)
  const decoded = decodeInnerFrame(OPTIMIZED_CIPHER.decrypt(sealed))
  if (decoded.kind !== 'stream_data') {
    throw new Error('Optimized codec returned a non-data frame.')
  }
  return {
    data: decodeRelayChunk({
      data: decoded.data,
      compression: decoded.compression ?? 'none',
      uncompressedBytes: decoded.uncompressedBytes ?? decoded.data.byteLength,
    }),
    wireBytes: sealed.byteLength,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function timeOperation(
  operation: (data: Uint8Array) => { data: Uint8Array, wireBytes: number },
  payload: Uint8Array,
  iterations: number,
): number {
  const startedAt = performance.now()
  for (let index = 0; index < iterations; index++) {
    operation(payload)
  }
  const elapsedMs = performance.now() - startedAt
  return payload.byteLength * iterations / (1024 * 1024) / (elapsedMs / 1_000)
}

function measureComparison(
  payload: Uint8Array,
  iterations: number,
): {
    baselineWireBytes: number
    optimizedWireBytes: number
    baselineMiBps: number
    optimizedMiBps: number
  } {
  const warmupIterations = Math.max(10, iterations / 20)
  timeOperation(baselineRoundTrip, payload, warmupIterations)
  timeOperation(optimizedRoundTrip, payload, warmupIterations)

  const baselineSamples: number[] = []
  const optimizedSamples: number[] = []
  for (let sample = 0; sample < 5; sample++) {
    if (sample % 2 === 0) {
      baselineSamples.push(timeOperation(baselineRoundTrip, payload, iterations))
      optimizedSamples.push(timeOperation(optimizedRoundTrip, payload, iterations))
    }
    else {
      optimizedSamples.push(timeOperation(optimizedRoundTrip, payload, iterations))
      baselineSamples.push(timeOperation(baselineRoundTrip, payload, iterations))
    }
  }

  const baseline = baselineRoundTrip(payload)
  const optimized = optimizedRoundTrip(payload)
  expect(baseline.data).toEqual(payload)
  expect(optimized.data).toEqual(payload)
  return {
    baselineWireBytes: baseline.wireBytes,
    optimizedWireBytes: optimized.wireBytes,
    baselineMiBps: median(baselineSamples),
    optimizedMiBps: median(optimizedSamples),
  }
}

describe('relay endpoint codec throughput benchmark', () => {
  it('compares the V2 baseline and optimized codec on interactive and bulk payloads', () => {
    const rows = (['compressible', 'incompressible'] as const).flatMap(profile => (
      [512, 64 * 1024].map((payloadBytes): CodecResult => {
        const payload = payloadFor(profile, payloadBytes)
        const iterations = payloadBytes < 1024 ? 10_000 : 100
        const comparison = measureComparison(payload, iterations)
        return {
          profile,
          payloadBytes,
          baselineWireBytes: comparison.baselineWireBytes,
          optimizedWireBytes: comparison.optimizedWireBytes,
          baselineMiBps: comparison.baselineMiBps,
          optimizedMiBps: comparison.optimizedMiBps,
          throughputImprovementPercent:
            (comparison.optimizedMiBps - comparison.baselineMiBps)
            / comparison.baselineMiBps * 100,
          wireReductionPercent:
            (comparison.baselineWireBytes - comparison.optimizedWireBytes)
            / comparison.baselineWireBytes * 100,
        }
      })
    ))

    console.info('# Relay endpoint codec CPU matrix')
    console.info('| Profile | Payload | V2 baseline | V2 optimized | Throughput improvement | Wire reduction |')
    console.info('| --- | ---: | ---: | ---: | ---: | ---: |')
    for (const row of rows) {
      console.info(`| ${row.profile} | ${row.payloadBytes} B | ${row.baselineMiBps.toFixed(1)} MiB/s / ${row.baselineWireBytes} B | ${row.optimizedMiBps.toFixed(1)} MiB/s / ${row.optimizedWireBytes} B | ${row.throughputImprovementPercent.toFixed(1)}% | ${row.wireReductionPercent.toFixed(1)}% |`)
    }
    console.info(JSON.stringify({
      kind: 'relay-endpoint-codec-cpu-matrix',
      conditions: {
        samples: 5,
        statistic: 'median',
        baseline: 'binary inner frame + XChaCha20-Poly1305',
        optimized: 'adaptive Zstandard + binary inner frame + size-adaptive AEAD',
      },
      rows,
    }))

    for (const row of rows) {
      expect(row.optimizedWireBytes).toBeLessThanOrEqual(row.baselineWireBytes)
      if (row.payloadBytes >= 64 * 1024) {
        expect(row.optimizedMiBps).toBeGreaterThan(row.baselineMiBps)
      }
      else {
        expect(row.optimizedMiBps).toBeGreaterThan(row.baselineMiBps * 0.85)
      }
    }
  }, 15_000)
})
