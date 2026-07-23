import { describe, expect, it } from 'vitest'

import { generateRelayKeyPair } from '../../src/modules/relay-transport/crypto'
import { decodeRelayEnvelope } from '../../src/modules/relay-transport/protocol'
import { RelaySession } from '../../src/modules/relay-transport/session'

const TRANSFER_BYTES = 2 * 1024 * 1024

interface LinkScenario {
  name: 'stable' | 'mobile' | 'constrained' | 'hostile'
  rttMs: number
  bandwidthKbps: number
  jitterMs: number
  lossPercent: number
}

interface NetworkResult {
  scenario: LinkScenario['name']
  profile: 'compressible' | 'incompressible'
  mode: 'V2 baseline' | 'V2 optimized'
  completionMs: number
  wireBytes: number
  pauses: number
  resumes: number
}

interface ScheduledEnvelope {
  deliverAt: number
  order: number
  deliver: (data: Uint8Array) => void
  data: Uint8Array
}

const SCENARIOS: LinkScenario[] = [
  { name: 'stable', rttMs: 20, bandwidthKbps: 100_000, jitterMs: 2, lossPercent: 0 },
  { name: 'mobile', rttMs: 100, bandwidthKbps: 5_000, jitterMs: 20, lossPercent: 1 },
  { name: 'constrained', rttMs: 250, bandwidthKbps: 512, jitterMs: 50, lossPercent: 3 },
  { name: 'hostile', rttMs: 800, bandwidthKbps: 128, jitterMs: 200, lossPercent: 10 },
]

class ShapedTcpWire {
  now = 0
  wireBytes = 0
  private order = 0
  private randomState = 0xC0FFEE
  private readonly queue: ScheduledEnvelope[] = []
  private readonly paths = new Map<'controller-host' | 'host-controller', { nextSendAt: number, lastArrival: number }>([
    ['controller-host', { nextSendAt: 0, lastArrival: 0 }],
    ['host-controller', { nextSendAt: 0, lastArrival: 0 }],
  ])

  constructor(private readonly scenario: LinkScenario) {}

  send(
    direction: 'controller-host' | 'host-controller',
    deliver: (data: Uint8Array) => void,
    data: Uint8Array,
  ): void {
    const path = this.paths.get(direction)!
    const segmentBytes = 1_200
    const segments = Math.max(1, Math.ceil(data.byteLength / segmentBytes))
    let retransmittedBytes = 0
    let retransmissionRounds = 0
    for (let segment = 0; segment < segments; segment++) {
      const bytes = Math.min(segmentBytes, data.byteLength - segment * segmentBytes)
      let attempts = 0
      while (this.nextRandom() < this.scenario.lossPercent / 100) {
        retransmittedBytes += bytes
        attempts++
        if (attempts === 8) {
          break
        }
      }
      retransmissionRounds = Math.max(retransmissionRounds, attempts)
    }
    const transmittedBytes = data.byteLength + retransmittedBytes
    const start = Math.max(this.now, path.nextSendAt)
    // One kbit/s is one bit/ms, so bytes * 8 / kbit/s yields milliseconds.
    const serializationMs = transmittedBytes * 8 / this.scenario.bandwidthKbps
    const retransmitDelay
      = retransmissionRounds * Math.max(200, this.scenario.rttMs * 1.5)
    const jitter = (this.nextRandom() * 2 - 1) * this.scenario.jitterMs
    const arrival = Math.max(
      path.lastArrival,
      start + serializationMs + this.scenario.rttMs / 2 + retransmitDelay + jitter,
    )
    path.nextSendAt = start + serializationMs
    path.lastArrival = arrival
    this.wireBytes += transmittedBytes
    this.queue.push({ deliverAt: arrival, order: this.order++, deliver, data })
  }

  drainUntil(done: () => boolean, label: string): void {
    while (!done()) {
      const next = this.queue.shift()
      if (!next) {
        throw new Error(`Shaped TCP wire drained before ${label}.`)
      }
      this.queue.sort((left, right) => left.deliverAt - right.deliverAt || left.order - right.order)
      this.now = next.deliverAt
      next.deliver(next.data)
    }
  }

  private nextRandom(): number {
    this.randomState = (this.randomState * 1_664_525 + 1_013_904_223) >>> 0
    return this.randomState / 0x1_0000_0000
  }
}

function payloadFor(profile: NetworkResult['profile']): Uint8Array {
  if (profile === 'compressible') {
    return new Uint8Array(TRANSFER_BYTES).fill(7)
  }
  let state = 0xA341_316C
  return Uint8Array.from({ length: TRANSFER_BYTES }, () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state & 0xFF
  })
}

function runTransfer(
  scenario: LinkScenario,
  profile: NetworkResult['profile'],
  mode: NetworkResult['mode'],
): NetworkResult {
  const hostKeys = generateRelayKeyPair()
  const controllerKeys = generateRelayKeyPair()
  const wire = new ShapedTcpWire(scenario)
  const payload = payloadFor(profile)
  let receivedBytes = 0
  let hostStreamOpened = false
  let pauses = 0
  let resumes = 0
  let deliverToController: (data: Uint8Array) => void = () => {
    throw new Error('Controller delivery used before setup.')
  }
  let deliverToHost: (data: Uint8Array) => void = () => {
    throw new Error('Host delivery used before setup.')
  }
  const makeOptions = () => ({
    roomId: 'adverse-network-benchmark',
    pairingCode: 'ADVERSE-NETWORK',
    optimizedCodecEnabled: mode === 'V2 optimized',
    maxStreamCreditBytes: 8 * 1024 * 1024,
  })
  const host = new RelaySession('host', hostKeys.privateKeyBase64, {
    ...makeOptions(),
    ourPublicKeyBase64: hostKeys.publicKeyBase64,
  }, {
    send: data => wire.send('host-controller', deliverToController, data),
    onStreamOpen: () => { hostStreamOpened = true },
    onStreamData: (streamId, data) => {
      receivedBytes += data.byteLength
      host.reportStreamDataConsumed(streamId, data.byteLength)
    },
    onError: (error) => { throw error },
  })
  const controller = new RelaySession('controller', controllerKeys.privateKeyBase64, {
    ...makeOptions(),
    ourPublicKeyBase64: controllerKeys.publicKeyBase64,
  }, {
    send: data => wire.send('controller-host', deliverToHost, data),
    onPauseStream: () => { pauses++ },
    onResumeStream: () => { resumes++ },
    onError: (error) => { throw error },
  })
  deliverToController = data => controller.handleEnvelope(decodeRelayEnvelope(data))
  deliverToHost = data => host.handleEnvelope(decodeRelayEnvelope(data))
  host.start()
  controller.start()
  wire.drainUntil(() => host.isReady && controller.isReady, 'handshake')
  controller.openStream('adverse-stream')
  wire.drainUntil(() => hostStreamOpened, 'stream open')
  const transferStartedAt = wire.now
  controller.writeStreamData('adverse-stream', payload)
  wire.drainUntil(
    () => receivedBytes === payload.byteLength && resumes > 0,
    'stream transfer',
  )
  return {
    scenario: scenario.name,
    profile,
    mode,
    completionMs: wire.now - transferStartedAt,
    wireBytes: wire.wireBytes,
    pauses,
    resumes,
  }
}

describe('relay adverse-network benchmark', () => {
  it('compares V2 before and after endpoint optimization under shaped TCP conditions', () => {
    const results = SCENARIOS.flatMap(scenario => [
      ...(['compressible', 'incompressible'] as const).flatMap(profile => [
        runTransfer(scenario, profile, 'V2 baseline'),
        runTransfer(scenario, profile, 'V2 optimized'),
      ]),
    ])
    const rows = SCENARIOS.flatMap(scenario => (
      ['compressible', 'incompressible'] as const
    ).map((profile) => {
      const baseline = results.find(result => result.scenario === scenario.name && result.profile === profile && result.mode === 'V2 baseline')!
      const optimized = results.find(result => result.scenario === scenario.name && result.profile === profile && result.mode === 'V2 optimized')!
      return {
        scenario: scenario.name,
        profile,
        baselineMs: baseline.completionMs,
        optimizedMs: optimized.completionMs,
        baselineUsefulKbps: TRANSFER_BYTES * 8 / baseline.completionMs,
        optimizedUsefulKbps: TRANSFER_BYTES * 8 / optimized.completionMs,
        completionImprovementPercent: (baseline.completionMs - optimized.completionMs) / baseline.completionMs * 100,
        baselineWireBytes: baseline.wireBytes,
        optimizedWireBytes: optimized.wireBytes,
        wireReductionPercent: (baseline.wireBytes - optimized.wireBytes) / baseline.wireBytes * 100,
      }
    }))
    console.info('# Relay adverse-network matrix')
    console.info('| Scenario | Profile | V2 baseline | V2 optimized | Improvement | Wire reduction |')
    console.info('| --- | --- | ---: | ---: | ---: | ---: |')
    for (const row of rows) {
      console.info(`| ${row.scenario} | ${row.profile} | ${row.baselineMs.toFixed(1)} ms / ${row.baselineWireBytes} B | ${row.optimizedMs.toFixed(1)} ms / ${row.optimizedWireBytes} B | ${row.completionImprovementPercent.toFixed(1)}% | ${row.wireReductionPercent.toFixed(1)}% |`)
    }
    console.info(JSON.stringify({
      kind: 'relay-adverse-network-matrix',
      conditions: {
        transferBytes: TRANSFER_BYTES,
        linkModel: 'ordered TCP serialization with deterministic jitter, bandwidth, segment loss, and retransmission timeout',
        scenarios: SCENARIOS,
      },
      rows,
    }))
    for (const row of rows) {
      expect(row.optimizedWireBytes).toBeLessThanOrEqual(row.baselineWireBytes)
      if (row.profile === 'compressible') {
        expect(row.optimizedMs).toBeLessThan(row.baselineMs)
        expect(row.optimizedWireBytes).toBeLessThan(row.baselineWireBytes * 0.1)
      }
      else {
        expect(Math.abs(row.completionImprovementPercent)).toBeLessThan(1)
      }
    }
  })
})
