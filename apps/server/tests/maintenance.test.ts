import { afterEach, describe, expect, it, vi } from 'vitest'

import * as BackgroundActivity from '../src/modules/background-activity/service'
import * as Maintenance from '../src/modules/maintenance/service'

afterEach(() => {
  Maintenance.reset()
  BackgroundActivity.reset()
  vi.useRealTimers()
})

describe('maintenance scheduler', () => {
  it('runs startup work through Background Activity and reports its result', async () => {
    const run = vi.fn(() => ({ changed: 3 }))
    Maintenance.registerTask({
      ownerNamespace: 'test-owner',
      key: 'startup',
      title: 'Startup maintenance',
      intervalMs: null,
      runOnStart: true,
      manuallyRunnable: true,
      run,
    })

    Maintenance.start()
    // runOnStart fires through a real 5s setTimeout deferred past app.listen —
    // vi.waitFor's default 1s timeout can never observe it.
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce(), { timeout: 10_000 })
    await vi.waitFor(() =>
      expect(BackgroundActivity.list()).toEqual([
        expect.objectContaining({
          ownerNamespace: 'test-owner',
          key: 'startup',
          status: 'succeeded',
          progress: { changed: 3, completed: true },
        }),
      ]), { timeout: 10_000 })
  })

  it('single-flights interval and manual requests and stops future timers', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(async () => {
      await blocked
      return { changed: 1 }
    })
    Maintenance.registerTask({
      ownerNamespace: 'test-owner',
      key: 'periodic',
      title: 'Periodic maintenance',
      intervalMs: 100,
      runOnStart: false,
      manuallyRunnable: true,
      run,
    })
    Maintenance.start()

    await vi.advanceTimersByTimeAsync(200)
    const manual = BackgroundActivity.requestManualRun('test-owner', 'periodic')
    expect(run).toHaveBeenCalledOnce()
    release?.()
    await manual

    Maintenance.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledOnce()
  })

  it('tells tasks whether a run was automatic or manual', async () => {
    const sources: string[] = []
    Maintenance.registerTask({
      ownerNamespace: 'test-owner',
      key: 'run-source',
      title: 'Run source maintenance',
      intervalMs: null,
      runOnStart: false,
      manuallyRunnable: true,
      run: (context) => {
        sources.push(context.source)
        return { source: context.source }
      },
    })

    await BackgroundActivity.requestRun('test-owner', 'run-source')
    await BackgroundActivity.requestManualRun('test-owner', 'run-source')

    expect(sources).toEqual(['automatic', 'manual'])
  })
})
