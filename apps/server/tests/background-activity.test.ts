import { Elysia } from 'elysia'
import { afterEach, describe, expect, it } from 'vitest'

import type { AppError } from '../src/errors/app-error'
import { backgroundActivity } from '../src/modules/background-activity'
import * as BackgroundActivity from '../src/modules/background-activity/service'

afterEach(() => {
  BackgroundActivity.reset()
})

describe('background activities', () => {
  it('registers idempotently and lists running activities before newer idle ones', async () => {
    let releaseRun: (() => void) | undefined
    const running = new Promise<void>((resolve) => {
      releaseRun = resolve
    })

    const measureStorage = {
      ownerNamespace: 'worktree',
      key: 'measure-storage',
      title: 'Measure worktree storage',
      priority: 'low',
      trigger: 'stale snapshot',
      manuallyRunnable: true,
      async run(reporter) {
        reporter.report({ completed: 1, total: 2 })
        await running
      },
    } as const
    BackgroundActivity.register(measureStorage)
    const secondRegistration = BackgroundActivity.register(measureStorage)
    BackgroundActivity.register({
      ownerNamespace: 'chronicle',
      key: 'compact-index',
      title: 'Compact Chronicle index',
      priority: 'low',
      trigger: 'scheduled maintenance',
      manuallyRunnable: false,
      async run() {},
    })

    expect(secondRegistration.status).toBe('idle')
    expect(BackgroundActivity.list()).toHaveLength(2)

    const run = BackgroundActivity.requestRun('worktree', 'measure-storage')
    await Promise.resolve()

    expect(BackgroundActivity.list()).toMatchObject([
      {
        ownerNamespace: 'worktree',
        key: 'measure-storage',
        status: 'running',
        progress: { completed: 1, total: 2 },
      },
      { ownerNamespace: 'chronicle', key: 'compact-index', status: 'idle' },
    ])

    releaseRun?.()
    await expect(run).resolves.toMatchObject({ status: 'succeeded', lastError: null })
  })

  it('runs each registered activity once at a time and records failures', async () => {
    let calls = 0
    let releaseRun: (() => void) | undefined
    const running = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    BackgroundActivity.register({
      ownerNamespace: 'runtime',
      key: 'reap-processes',
      title: 'Reap runtime processes',
      priority: 'normal',
      trigger: 'periodic maintenance',
      manuallyRunnable: true,
      async run() {
        calls += 1
        await running
      },
    })

    const first = BackgroundActivity.requestRun('runtime', 'reap-processes')
    const second = BackgroundActivity.requestRun('runtime', 'reap-processes')
    expect(first).toBe(second)

    releaseRun?.()
    await first
    expect(calls).toBe(1)

    BackgroundActivity.register({
      ownerNamespace: 'runtime',
      key: 'reap-processes',
      title: 'Reap runtime processes',
      priority: 'normal',
      trigger: 'periodic maintenance',
      manuallyRunnable: true,
      async run() {
        throw new Error('reaper unavailable')
      },
    })

    await expect(BackgroundActivity.requestRun('runtime', 'reap-processes')).resolves.toMatchObject({
      status: 'failed',
      lastError: 'reaper unavailable',
    })
  })

  it('exposes manual activities over HTTP and rejects missing or automatic activity runs', async () => {
    const app = new Elysia().use(backgroundActivity)
    BackgroundActivity.register({
      ownerNamespace: 'worktree',
      key: 'measure-storage',
      title: 'Measure worktree storage',
      priority: 'low',
      trigger: 'explicit refresh',
      manuallyRunnable: true,
      async run() {},
    })
    BackgroundActivity.register({
      ownerNamespace: 'runtime',
      key: 'reap-processes',
      title: 'Reap runtime processes',
      priority: 'normal',
      trigger: 'periodic maintenance',
      manuallyRunnable: false,
      async run() {},
    })

    const list = await app.handle(new Request('http://localhost/background-activities'))
    expect(list.status).toBe(200)
    expect(await list.json()).toHaveLength(2)

    const run = await app.handle(new Request(
      'http://localhost/background-activities/worktree/measure-storage/run',
      { method: 'POST' },
    ))
    expect(run.status).toBe(200)
    expect(await run.json()).toMatchObject({ status: 'running' })

    expect(() => BackgroundActivity.requestManualRun('runtime', 'reap-processes')).toThrow(
      expect.objectContaining<AppError>({
        code: 'background_activity_not_manually_runnable',
        status: 409,
      }),
    )
    expect(() => BackgroundActivity.requestManualRun('missing', 'activity')).toThrow(
      expect.objectContaining<AppError>({
        code: 'background_activity_not_found',
        status: 404,
      }),
    )
  })
})
