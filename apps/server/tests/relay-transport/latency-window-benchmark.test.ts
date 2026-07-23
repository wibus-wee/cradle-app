import { describe, expect, it } from 'vitest'

import { generateRelayKeyPair } from '../../src/modules/relay-transport/crypto'
import { decodeRelayEnvelope } from '../../src/modules/relay-transport/protocol'
import { RelaySession } from '../../src/modules/relay-transport/session'

const TRANSFER_BYTES = 8 * 1024 * 1024
const INITIAL_CREDIT_BYTES = 512 * 1024
const ADAPTIVE_MAX_CREDIT_BYTES = 8 * 1024 * 1024

interface VirtualTransferResult {
  rttMs: number
  mode: 'fixed-512KiB' | 'adaptive-8MiB'
  completionMs: number
  usefulMiBps: number
  pauses: number
  resumes: number
}

interface ScheduledEnvelope {
  deliverAt: number
  order: number
  data: Uint8Array
  deliver: (data: Uint8Array) => void
}

/**
 * Test-only, deterministic one-way-delay wire. It delivers real encrypted
 * RelaySession envelopes in virtual timestamp order without using wall-clock
 * sleeps or claiming to emulate WebSocket, relayd, packet loss, or the WAN.
 */
class VirtualDelayedWire {
  now = 0
  private nextOrder = 0
  private readonly queue: ScheduledEnvelope[] = []

  constructor(private readonly oneWayDelayMs: number) {}

  send(deliver: (data: Uint8Array) => void, data: Uint8Array): void {
    this.queue.push({
      deliverAt: this.now + this.oneWayDelayMs,
      order: this.nextOrder++,
      data,
      deliver,
    })
  }

  drainUntil(done: () => boolean, label: string): void {
    while (!done()) {
      const next = this.takeNext()
      if (!next) {
        throw new Error(`Virtual delayed wire drained before ${label}.`)
      }
      this.now = next.deliverAt
      next.deliver(next.data)
    }
  }

  private takeNext(): ScheduledEnvelope | undefined {
    if (this.queue.length === 0) {
      return undefined
    }
    this.queue.sort((left, right) => left.deliverAt - right.deliverAt || left.order - right.order)
    return this.queue.shift()
  }
}

function runVirtualTransfer(
  rttMs: number,
  mode: VirtualTransferResult['mode'],
): VirtualTransferResult {
  const hostKeys = generateRelayKeyPair()
  const controllerKeys = generateRelayKeyPair()
  const wire = new VirtualDelayedWire(rttMs / 2)
  const payload = new Uint8Array(TRANSFER_BYTES).fill(7)
  const maxStreamCreditBytes = mode === 'fixed-512KiB'
    ? INITIAL_CREDIT_BYTES
    : ADAPTIVE_MAX_CREDIT_BYTES
  let receivedBytes = 0
  let hostStreamOpened = false
  let pauses = 0
  let resumes = 0
  let deliverToController: (envelope: Uint8Array) => void = () => {
    throw new Error('Controller delivery was used before session setup.')
  }
  let deliverToHost: (envelope: Uint8Array) => void = () => {
    throw new Error('Host delivery was used before session setup.')
  }

  const host = new RelaySession(
    'host',
    hostKeys.privateKeyBase64,
    {
      roomId: 'virtual_rtt_benchmark',
      pairingCode: 'VIRTUAL-RTT',
      ourPublicKeyBase64: hostKeys.publicKeyBase64,
      maxStreamCreditBytes,
    },
    {
      send: data => wire.send(deliverToController, data),
      onStreamOpen: () => {
        hostStreamOpened = true
      },
      onStreamData: (streamId, data) => {
        receivedBytes += data.byteLength
        // This models a local target that has accepted the bytes immediately.
        // The ACK still crosses the virtual delayed wire through the real
        // RelaySession encryption, framing, and cumulative-ack code paths.
        host.reportStreamDataConsumed(streamId, data.byteLength)
      },
      onError: (error) => {
        throw error
      },
    },
  )
  const controller = new RelaySession(
    'controller',
    controllerKeys.privateKeyBase64,
    {
      roomId: 'virtual_rtt_benchmark',
      pairingCode: 'VIRTUAL-RTT',
      ourPublicKeyBase64: controllerKeys.publicKeyBase64,
      maxStreamCreditBytes,
    },
    {
      send: data => wire.send(deliverToHost, data),
      onPauseStream: () => {
        pauses++
      },
      onResumeStream: () => {
        resumes++
      },
      onError: (error) => {
        throw error
      },
    },
  )
  deliverToController = envelope => controller.handleEnvelope(decodeRelayEnvelope(envelope))
  deliverToHost = envelope => host.handleEnvelope(decodeRelayEnvelope(envelope))

  host.start()
  controller.start()
  wire.drainUntil(() => host.isReady && controller.isReady, 'the relay handshake')

  controller.openStream('virtual-stream')
  wire.drainUntil(() => hostStreamOpened, 'stream open')
  const transferStartedAt = wire.now
  controller.writeStreamData('virtual-stream', payload)
  wire.drainUntil(() => receivedBytes === payload.byteLength && resumes > 0, 'stream delivery and resume')
  const completionMs = wire.now - transferStartedAt

  return {
    rttMs,
    mode,
    completionMs,
    usefulMiBps: TRANSFER_BYTES / (1024 * 1024) / (completionMs / 1_000),
    pauses,
    resumes,
  }
}

function printVirtualResults(results: VirtualTransferResult[]): void {
  const rows = [20, 100, 200, 400].map(rttMs => ({
    rttMs,
    fixed: results.find(result => result.rttMs === rttMs && result.mode === 'fixed-512KiB')!,
    adaptive: results.find(result => result.rttMs === rttMs && result.mode === 'adaptive-8MiB')!,
  }))
  const markdown = [
    '# Relay session virtual-time RTT matrix',
    '',
    'This is a deterministic RelaySession simulation: real handshake, binary codec, adaptive AEAD frames, ACKs, pause/resume, and credit state; it is not a real relayd, WebSocket, Tailscale, or WAN measurement.',
    '',
    '| RTT | V2 fixed 512 KiB completion / useful rate / pause-resume | V2 adaptive 8 MiB completion / useful rate / pause-resume | Adaptive improvement |',
    '| ---: | --- | --- | ---: |',
    ...rows.map(({ rttMs, fixed, adaptive }) => {
      const fixedCell = `${fixed.completionMs} ms / ${fixed.usefulMiBps.toFixed(2)} MiB/s / ${fixed.pauses}-${fixed.resumes}`
      const adaptiveCell = `${adaptive.completionMs} ms / ${adaptive.usefulMiBps.toFixed(2)} MiB/s / ${adaptive.pauses}-${adaptive.resumes}`
      const improvement = ((fixed.completionMs - adaptive.completionMs) / fixed.completionMs) * 100
      return `| ${rttMs} ms | ${fixedCell} | ${adaptiveCell} | ${improvement.toFixed(1)}% faster |`
    }),
  ].join('\n')
  console.info(markdown)
  console.info(JSON.stringify({
    kind: 'relay-session-virtual-rtt-matrix',
    conditions: {
      transferBytes: TRANSFER_BYTES,
      initialCreditBytes: INITIAL_CREDIT_BYTES,
      fixedMaxCreditBytes: INITIAL_CREDIT_BYTES,
      adaptiveMaxCreditBytes: ADAPTIVE_MAX_CREDIT_BYTES,
      transport: 'virtual-time RelaySession wire',
    },
    rows,
  }))
}

describe('relay session controlled RTT benchmark', () => {
  it('compares fixed and adaptive V2 credit using real session frames', () => {
    const results = [20, 100, 200, 400].flatMap(rttMs => [
      runVirtualTransfer(rttMs, 'fixed-512KiB'),
      runVirtualTransfer(rttMs, 'adaptive-8MiB'),
    ])
    printVirtualResults(results)

    for (const result of results) {
      expect(result.completionMs).toBeGreaterThan(0)
      expect(result.pauses).toBeGreaterThan(0)
      expect(result.resumes).toBeGreaterThan(0)
    }
    for (const rttMs of [200, 400]) {
      const fixed = results.find(result => result.rttMs === rttMs && result.mode === 'fixed-512KiB')!
      const adaptive = results.find(result => result.rttMs === rttMs && result.mode === 'adaptive-8MiB')!
      expect(adaptive.completionMs).toBeLessThan(fixed.completionMs)
    }
  })
})
