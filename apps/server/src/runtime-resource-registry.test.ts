import { describe, expect, it, vi } from 'vitest'

import { RuntimeResourceRegistry } from './runtime-resource-registry'

describe('runtime resource registry', () => {
  it('drains before stopping resources and closes infrastructure last', async () => {
    const calls: string[] = []
    const registry = new RuntimeResourceRegistry()
    registry.register({ name: 'database', phase: 'close', stop: () => { calls.push('database') } })
    registry.register({ name: 'provider', phase: 'stop', stop: () => { calls.push('provider') } })
    registry.register({ name: 'runs', phase: 'drain', stop: () => { calls.push('runs') } })

    await registry.shutdown()

    expect(calls).toEqual(['runs', 'provider', 'database'])
  })

  it('rejects new work and aborts pending resources before draining', async () => {
    const calls: string[] = []
    const registry = new RuntimeResourceRegistry()
    registry.shutdownSignal.addEventListener('abort', () => calls.push('abort'))
    registry.register({
      name: 'connectors',
      phase: 'cancel',
      stop: () => {
        expect(registry.acceptingCommands).toBe(false)
        expect(registry.shutdownSignal.aborted).toBe(true)
        calls.push('cancel')
      },
    })
    registry.register({ name: 'runs', phase: 'drain', stop: () => { calls.push('drain') } })

    await registry.shutdown()

    expect(calls).toEqual(['abort', 'cancel', 'drain'])
    expect(() => registry.register({ name: 'late', phase: 'stop', stop: () => {} }))
      .toThrow('during shutdown')
  })

  it('is idempotent while shutdown is in flight', async () => {
    const stop = vi.fn()
    const registry = new RuntimeResourceRegistry()
    registry.register({ name: 'resource', phase: 'stop', stop })

    await Promise.all([registry.shutdown(), registry.shutdown()])

    expect(stop).toHaveBeenCalledOnce()
  })
})
