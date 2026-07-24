import { describe, expect, it, vi } from 'vitest'

import { ServerBootstrapReporter } from './bootstrap-lifecycle'

describe('server bootstrap lifecycle', () => {
  it('reports ordered phase timestamps and emits ready only after listener completion', async () => {
    const publish = vi.fn()
    const reporter = new ServerBootstrapReporter(publish)

    await reporter.run('persisted-run-recovery', async () => undefined)
    reporter.started('listener-establishment')
    reporter.completed('listener-establishment')
    reporter.ready()

    expect(publish.mock.calls.map(([event]) => ({ phase: event.phase, kind: event.kind }))).toEqual(
      [
        { phase: 'persisted-run-recovery', kind: 'started' },
        { phase: 'persisted-run-recovery', kind: 'completed' },
        { phase: 'listener-establishment', kind: 'started' },
        { phase: 'listener-establishment', kind: 'completed' },
        { phase: 'listener-establishment', kind: 'ready' },
      ],
    )
    expect(publish.mock.calls.every(([event]) => typeof event.at === 'string')).toBe(true)
  })

  it('timestamps the phase failure before preserving the original error', async () => {
    const publish = vi.fn()
    const reporter = new ServerBootstrapReporter(publish)

    await expect(
      reporter.run('plugin-activation', async () => {
        throw new Error('plugin failed')
      }),
    ).rejects.toThrow('plugin failed')

    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'plugin-activation',
        kind: 'failed',
        error: 'plugin failed',
        at: expect.any(String),
      }),
    )
  })
})
