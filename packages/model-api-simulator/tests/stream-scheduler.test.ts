import { describe, expect, it } from 'vitest'

import { ScenarioController } from '../src/core/scenario-runtime'
import { createScheduledStream } from '../src/core/stream-scheduler'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('stream scheduler', () => {
  it('waits at named gates and preserves event order', async () => {
    const controller = new ScenarioController()
    const steps = [
      { kind: 'event' as const, event: { type: 'first' } },
      { kind: 'gate' as const, name: 'next' },
      { kind: 'event' as const, event: { type: 'second' } },
      { kind: 'close' as const },
    ]
    const reader = createScheduledStream(controller, steps, step =>
      encoder.encode(JSON.stringify(step.event))).getReader()
    await expect(reader.read()).resolves.toMatchObject({ done: false })
    const second = reader.read()
    controller.release('next')
    expect(decoder.decode((await second).value)).toContain('second')
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    controller.assertExhausted()
  })

  it('cancels a gated stream when the simulator closes', async () => {
    const controller = new ScenarioController()
    const reader = createScheduledStream(
      controller,
      [{ kind: 'gate', name: 'never' }],
      () => encoder.encode('unused'),
    ).getReader()
    const pending = reader.read()
    controller.close()
    await expect(pending).rejects.toThrow('Simulator closed')
  })

  it('surfaces explicit disconnects', async () => {
    const controller = new ScenarioController()
    const reader = createScheduledStream(
      controller,
      [{ kind: 'disconnect', reason: 'fixture' }],
      () => encoder.encode('unused'),
    ).getReader()
    await expect(reader.read()).rejects.toThrow('Disconnected: fixture')
  })
})
