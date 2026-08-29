import { afterEach, describe, expect, it } from 'vitest'

import * as BackgroundActivity from './service'

afterEach(() => BackgroundActivity.reset())

describe('background activity footer presentation', () => {
  it('publishes and clears an owner-provided footer presentation', async () => {
    let visible = true
    BackgroundActivity.register({
      ownerNamespace: 'test',
      key: 'notice',
      title: 'Test notice',
      priority: 'normal',
      trigger: 'test',
      manuallyRunnable: false,
      async run(reporter) {
        reporter.presentInFooter(visible
          ? {
              id: 'notice-1',
              title: 'Something changed',
              description: 'Review it when convenient.',
              actionLabel: null,
              actionUrl: null,
              expiresAt: null,
            }
          : null)
      },
    })

    await BackgroundActivity.requestRun('test', 'notice')
    expect(BackgroundActivity.list()[0]?.presentation.footer?.id).toBe('notice-1')

    visible = false
    await BackgroundActivity.requestRun('test', 'notice')
    expect(BackgroundActivity.list()[0]?.presentation.footer).toBeNull()
  })

  it('retains the previous presentation when a refresh fails', async () => {
    let fail = false
    BackgroundActivity.register({
      ownerNamespace: 'test',
      key: 'notice',
      title: 'Test notice',
      priority: 'normal',
      trigger: 'test',
      manuallyRunnable: false,
      async run(reporter) {
        if (fail) {
          throw new Error('offline')
        }
        reporter.presentInFooter({
          id: 'notice-1',
          title: 'Still relevant',
          description: null,
          actionLabel: null,
          actionUrl: null,
          expiresAt: null,
        })
      },
    })

    await BackgroundActivity.requestRun('test', 'notice')
    fail = true
    const failed = await BackgroundActivity.requestRun('test', 'notice')

    expect(failed.status).toBe('failed')
    expect(failed.presentation.footer?.id).toBe('notice-1')
  })

  it('omits expired presentations from snapshots', async () => {
    BackgroundActivity.register({
      ownerNamespace: 'test',
      key: 'notice',
      title: 'Test notice',
      priority: 'normal',
      trigger: 'test',
      manuallyRunnable: false,
      async run(reporter) {
        reporter.presentInFooter({
          id: 'expired',
          title: 'Expired',
          description: null,
          actionLabel: null,
          actionUrl: null,
          expiresAt: Date.now() - 1,
        })
      },
    })

    const result = await BackgroundActivity.requestRun('test', 'notice')
    expect(result.presentation.footer).toBeNull()
  })
})
