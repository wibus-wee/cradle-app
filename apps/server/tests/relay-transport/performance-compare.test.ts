import { describe, expect, it } from 'vitest'

import { RelayCipher } from '../../src/modules/relay-transport/crypto'
import {
  decodeInnerFrame,
  decodeRelayEnvelope,
  encodeInnerFrame,
  encodeRelayEnvelope,
  legacyV1WireBytesForStreamData,
  RELAY_ENVELOPE_KIND,
  RELAY_PROTOCOL_VERSION,
} from '../../src/modules/relay-transport/protocol'

interface ComparisonCheckpoint {
  checkpoint: string
  old: number
  new: number
  unit: string
  interpretation: string
}

function printComparison(checkpoints: ComparisonCheckpoint[]): void {
  console.info(
    JSON.stringify({
      kind: 'relay-latency-compare',
      protocol: { old: 1, new: RELAY_PROTOCOL_VERSION },
      conditions: {
        payloadBytes: 64 * 1024,
        oldCreditBytes: 512 * 1024,
        newCreditRangeBytes: [512 * 1024, 8 * 1024 * 1024],
        syntheticRttMs: 200,
      },
      checkpoints,
    }),
  )
}

describe('relay Old/New performance comparison', () => {
  it('reports deterministic wire, round-trip, queue, and BDP checkpoints', () => {
    const payload = new Uint8Array(64 * 1024)
    payload.forEach((_, index) => {
      payload[index] = index & 0xFF
    })
    const frame = { kind: 'stream_data' as const, streamId: 'c1', seq: 0, data: payload }
    const cipher = new RelayCipher(new Uint8Array(32).fill(7))
    const encoded = encodeRelayEnvelope({
      version: RELAY_PROTOCOL_VERSION,
      roomId: 'room_compare',
      seq: 0,
      kind: RELAY_ENVELOPE_KIND.dataFrame,
      priority: 'data',
      streamId: frame.streamId,
      payload: cipher.encrypt(encodeInnerFrame(frame)),
    })
    const decoded = decodeRelayEnvelope(encoded)
    const decodedFrame = decodeInnerFrame(cipher.decrypt(decoded.payload))
    expect(decodedFrame.kind).toBe('stream_data')
    if (decodedFrame.kind === 'stream_data') {
      expect(decodedFrame.data).toEqual(payload)
    }

    const oldWireBytes = legacyV1WireBytesForStreamData(payload)
    const newWireBytes = encoded.byteLength
    const checkpoints: ComparisonCheckpoint[] = [
      {
        checkpoint: 'wireBytes.streamData.64KiB',
        old: oldWireBytes,
        new: newWireBytes,
        unit: 'bytes',
        interpretation: 'V2 carries raw encrypted bytes instead of nested Base64 and JSON.',
      },
      {
        checkpoint: 'readyRoundTrips.reconnect',
        old: 1,
        new: 1,
        unit: 'round trips',
        interpretation:
          'Protocol encoding does not add a reconnect handshake round trip; warming removes it from a user request.',
      },
      {
        checkpoint: 'controlQueuePosition.behindBulk',
        old: 65,
        new: 0,
        unit: 'bulk frames ahead',
        interpretation:
          'The legacy FIFO can place a control frame behind the full queue; V2 reserves control priority.',
      },
      {
        checkpoint: 'creditThroughputCap.200msRtt',
        old: 2.5,
        new: 40,
        unit: 'MiB/s theoretical window cap',
        interpretation:
          'Old is 512 KiB / 200 ms; new may grow to 8 MiB after successful application acknowledgements.',
      },
    ]
    printComparison(checkpoints)
    expect(newWireBytes).toBeLessThan(oldWireBytes * 0.7)
  })
})
