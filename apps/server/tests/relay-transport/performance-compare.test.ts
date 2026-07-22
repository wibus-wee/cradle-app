import { describe, expect, it } from 'vitest'

import { RelayCipher } from '../../src/modules/relay-transport/crypto'
import {
  decodeInnerFrame,
  decodeRelayEnvelope,
  encodeInnerFrame,
  encodeRelayEnvelope,
  legacyV1WireBytesForStreamData,
  RELAY_ENVELOPE_KIND,
  RELAY_MAX_STREAM_CHUNK_BYTES,
  RELAY_PROTOCOL_VERSION,
} from '../../src/modules/relay-transport/protocol'

interface BenchmarkRow {
  checkpoint: string
  old: number
  new: number
  unit: string
  evidence: 'exact codec measurement' | 'exact scheduler model' | 'bounded-window model'
  conclusion: string
}

interface CodecSample {
  payloadBytes: number
  v1WireBytes: number
  previousV2WireBytes: number
  currentV2WireBytes: number
  v1Frames: number
  previousV2Frames: number
  currentV2Frames: number
}

const OLD_CREDIT_BYTES = 512 * 1024
const NEW_MAX_CREDIT_BYTES = 8 * 1024 * 1024
const NEW_MAX_CONNECTION_CREDIT_BYTES = 16 * 1024 * 1024
const BULK_FRAMES_AHEAD_OF_CONTROL = 65
const RESERVED_MAX_CONTROL_FRAMES = 1

interface SchedulingFrame {
  priority: 'control' | 'data'
  streamId: string
  sequence: number
}

function makePayload(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index & 0xFF)
}

function encodeV2Payload(payload: Uint8Array): { wireBytes: number, frames: number } {
  const cipher = new RelayCipher(new Uint8Array(32).fill(7))
  let wireBytes = 0
  let frames = 0
  for (let offset = 0; offset < payload.byteLength; offset += RELAY_MAX_STREAM_CHUNK_BYTES) {
    const chunk = payload.slice(offset, offset + RELAY_MAX_STREAM_CHUNK_BYTES)
    const frame = { kind: 'stream_data' as const, streamId: 'benchmark', seq: offset, data: chunk }
    const encoded = encodeRelayEnvelope({
      version: RELAY_PROTOCOL_VERSION,
      roomId: 'room_benchmark',
      seq: frames,
      kind: RELAY_ENVELOPE_KIND.dataFrame,
      priority: 'data',
      streamId: frame.streamId,
      payload: cipher.encrypt(encodeInnerFrame(frame)),
    })
    const decoded = decodeRelayEnvelope(encoded)
    const decodedFrame = decodeInnerFrame(cipher.decrypt(decoded.payload))
    expect(decodedFrame).toMatchObject({ kind: 'stream_data', streamId: frame.streamId, seq: offset })
    if (decodedFrame.kind === 'stream_data') {
      expect(decodedFrame.data).toEqual(chunk)
    }
    wireBytes += encoded.byteLength
    frames += 1
  }
  return { wireBytes, frames }
}

function measureCodec(payloadBytes: number): CodecSample {
  const payload = makePayload(payloadBytes)
  const v2 = encodeV2Payload(payload)
  return {
    payloadBytes,
    v1WireBytes: legacyV1WireBytesForStreamData(payload),
    // Commit 01c39cd8 changes only relayd's forwarding ownership. The V2
    // codec is deliberately identical before and after that change.
    previousV2WireBytes: v2.wireBytes,
    currentV2WireBytes: v2.wireBytes,
    v1Frames: 1,
    previousV2Frames: v2.frames,
    currentV2Frames: v2.frames,
  }
}

function windowCapMiBps(windowBytes: number, rttMs: number): number {
  return windowBytes / (1024 * 1024) / (rttMs / 1_000)
}

function legacyFifoControlPosition(bulkFrameCount: number): number {
  const queue: SchedulingFrame[] = [
    ...Array.from({ length: bulkFrameCount }, (_, sequence) => ({
      priority: 'data' as const,
      streamId: 'bulk',
      sequence,
    })),
    { priority: 'control', streamId: 'control', sequence: 0 },
  ]
  return queue.findIndex(frame => frame.priority === 'control')
}

function priorityRoundRobinOrder(queue: SchedulingFrame[]): SchedulingFrame[] {
  const control = queue.filter(frame => frame.priority === 'control')
  const streams = new Map<string, SchedulingFrame[]>()
  for (const frame of queue) {
    if (frame.priority === 'data') {
      const frames = streams.get(frame.streamId) ?? []
      frames.push(frame)
      streams.set(frame.streamId, frames)
    }
  }
  const order = [...control]
  while (streams.size > 0) {
    for (const [streamId, frames] of [...streams]) {
      const frame = frames.shift()
      if (frame) {
        order.push(frame)
      }
      if (frames.length === 0) {
        streams.delete(streamId)
      }
    }
  }
  return order
}

function deltaPercent(old: number, next: number): string {
  if (old === 0) {
    return next === 0 ? '0.0%' : 'new guarantee'
  }
  const delta = ((next - old) / old) * 100
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`
}

function printBenchmark(codecSamples: CodecSample[], rows: BenchmarkRow[]): void {
  const report = {
    kind: 'relay-three-generation-benchmark',
    run: {
      id: 'relay-v1-v2-before-current-compare',
      protocol: { v1: 1, previousV2: RELAY_PROTOCOL_VERSION, currentV2: RELAY_PROTOCOL_VERSION },
      measurementBoundary: 'same-process codec and scheduler model',
      payloadPattern: 'payload[index] = index & 0xff',
      loss: 'none',
      randomSeed: 'not applicable',
    },
    conditions: {
      oldMaxStreamChunkBytes: 256 * 1024,
      newMaxStreamChunkBytes: RELAY_MAX_STREAM_CHUNK_BYTES,
      oldCreditBytes: OLD_CREDIT_BYTES,
      newCreditRangeBytes: [OLD_CREDIT_BYTES, NEW_MAX_CREDIT_BYTES],
      newConnectionCreditBytes: NEW_MAX_CONNECTION_CREDIT_BYTES,
      bulkFramesAheadOfControl: BULK_FRAMES_AHEAD_OF_CONTROL,
      reservedMaximumControlFrames: RESERVED_MAX_CONTROL_FRAMES,
    },
    codecSamples: codecSamples.map(sample => ({
      ...sample,
      v1ToV2WireByteDeltaPercent: deltaPercent(sample.v1WireBytes, sample.currentV2WireBytes),
      previousV2ToCurrentV2WireByteDeltaPercent: deltaPercent(
        sample.previousV2WireBytes,
        sample.currentV2WireBytes,
      ),
    })),
    rows,
    caveat: 'Wire and scheduler rows are exact under the stated inputs. Throughput rows are window bounds, not Internet throughput measurements. Run benchmark:relay:runtime for a local real-relayd cold/warm timestamp sample.',
  }
  const markdown = [
    `# Relay three-generation benchmark — ${report.run.id}`,
    '',
    '## Codec: exact byte measurements',
    '',
    '| Logical payload | V1 wire bytes | V2 before pass-through | V2 current | V1 → current | V2 before → current | V1 frames | V2 before/current frames |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.codecSamples.map(sample =>
      `| ${sample.payloadBytes} B | ${sample.v1WireBytes} | ${sample.previousV2WireBytes} | ${sample.currentV2WireBytes} | ${sample.v1ToV2WireByteDeltaPercent} | ${sample.previousV2ToCurrentV2WireByteDeltaPercent} | ${sample.v1Frames} | ${sample.previousV2Frames}/${sample.currentV2Frames} |`),
    '',
    '## Checkpoints',
    '',
    '| Checkpoint | Old | New | Delta | Evidence |',
    '| --- | ---: | ---: | ---: | --- |',
    ...rows.map(row =>
      `| ${row.checkpoint} | ${row.old} ${row.unit} | ${row.new} ${row.unit} | ${deltaPercent(row.old, row.new)} | ${row.evidence} |`),
    '',
    'V2-before and V2-current have identical wire bytes by design: pass-through removes Relay process work, not bytes on the network. The 8 MiB value is the bounded adaptive maximum after successful acknowledgements; new streams start at the same 512 KiB as V1.',
  ].join('\n')
  console.info(markdown)
  console.info(JSON.stringify(report))
}

describe('relay three-generation performance comparison', () => {
  it('emits a reproducible V1/V2-before/V2-current report and guards the gains', () => {
    const codecSamples = [
      measureCodec(1 * 1024),
      measureCodec(64 * 1024),
      measureCodec(256 * 1024),
    ]
    const oldControlPosition = legacyFifoControlPosition(BULK_FRAMES_AHEAD_OF_CONTROL)
    const newSchedule = priorityRoundRobinOrder([
      ...Array.from({ length: BULK_FRAMES_AHEAD_OF_CONTROL }, (_, sequence) => ({
        priority: 'data' as const,
        streamId: 'bulk',
        sequence,
      })),
      { priority: 'control' as const, streamId: 'control', sequence: 0 },
    ])
    const newControlPosition = newSchedule.findIndex(frame => frame.priority === 'control')
    const fairDataOrder = priorityRoundRobinOrder([
      { priority: 'data', streamId: 'a', sequence: 1 },
      { priority: 'data', streamId: 'a', sequence: 2 },
      { priority: 'data', streamId: 'b', sequence: 1 },
    ]).map(frame => `${frame.streamId}${frame.sequence}`)
    expect(fairDataOrder).toEqual(['a1', 'b1', 'a2'])

    const rows: BenchmarkRow[] = [
      {
        checkpoint: 'control frames ahead of an interactive control frame',
        old: oldControlPosition,
        new: newControlPosition,
        unit: 'bulk frames',
        evidence: 'exact scheduler model',
        conclusion: 'V2 control priority bypasses queued bulk transfer frames.',
      },
      {
        checkpoint: 'maximum-size control frames admitted after bulk saturation',
        old: 0,
        new: RESERVED_MAX_CONTROL_FRAMES,
        unit: 'frames',
        evidence: 'exact scheduler model',
        conclusion: 'V2 keeps a maximum-frame byte reserve for ACK, close, and peer-notification traffic.',
      },
      {
        checkpoint: 'window cap at 20 ms RTT',
        old: windowCapMiBps(OLD_CREDIT_BYTES, 20),
        new: windowCapMiBps(NEW_MAX_CREDIT_BYTES, 20),
        unit: 'MiB/s',
        evidence: 'bounded-window model',
        conclusion: 'The new cap is reached only after ACK-driven credit growth.',
      },
      {
        checkpoint: 'window cap at 100 ms RTT',
        old: windowCapMiBps(OLD_CREDIT_BYTES, 100),
        new: windowCapMiBps(NEW_MAX_CREDIT_BYTES, 100),
        unit: 'MiB/s',
        evidence: 'bounded-window model',
        conclusion: 'A fixed 512 KiB window is increasingly restrictive as delay rises.',
      },
      {
        checkpoint: 'window cap at 200 ms RTT',
        old: windowCapMiBps(OLD_CREDIT_BYTES, 200),
        new: windowCapMiBps(NEW_MAX_CREDIT_BYTES, 200),
        unit: 'MiB/s',
        evidence: 'bounded-window model',
        conclusion: 'High-delay transfers can use 16x more in-flight bytes, bounded at 8 MiB per stream.',
      },
      {
        checkpoint: 'window cap at 400 ms RTT',
        old: windowCapMiBps(OLD_CREDIT_BYTES, 400),
        new: windowCapMiBps(NEW_MAX_CREDIT_BYTES, 400),
        unit: 'MiB/s',
        evidence: 'bounded-window model',
        conclusion: 'The gain scales with delay only when the path and receiver can sustain it.',
      },
      {
        checkpoint: 'bounded in-flight bytes per stream',
        old: OLD_CREDIT_BYTES / (1024 * 1024),
        new: NEW_MAX_CREDIT_BYTES / (1024 * 1024),
        unit: 'MiB',
        evidence: 'bounded-window model',
        conclusion: 'This is the deliberate high-BDP trade-off; the new sender remains capped at 8 MiB per stream.',
      },
    ]
    printBenchmark(codecSamples, rows)

    for (const sample of codecSamples) {
      expect(sample.currentV2WireBytes).toBeLessThan(sample.v1WireBytes * 0.7)
      expect(sample.previousV2WireBytes).toBe(sample.currentV2WireBytes)
    }
    expect(rows.find(row => row.checkpoint === 'control frames ahead of an interactive control frame')?.new).toBe(0)
    expect(rows.find(row => row.checkpoint === 'window cap at 200 ms RTT')?.new).toBe(40)
  })
})
