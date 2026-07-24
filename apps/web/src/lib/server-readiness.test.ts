import { afterEach, describe, expect, it, vi } from 'vitest'

import { waitForDesktopServer } from './server-readiness'

afterEach(() => {
  delete window.cradle
})

describe('desktop server readiness bridge', () => {
  it('uses the retained status snapshot when the renderer attaches after ready was emitted', async () => {
    const onStatusChanged = vi.fn(() => () => {})
    window.cradle = {
      env: { isElectron: true },
      serverRuntime: {
        getStatus: vi.fn(async () => ({
          state: 'ready' as const,
          serverUrl: 'http://127.0.0.1:21423',
          bootstrap: {
            currentPhase: null,
            phaseStartedAt: null,
            lastEvent: {
              type: 'cradle-server-bootstrap' as const,
              phase: 'listener-establishment' as const,
              kind: 'ready' as const,
              at: '2026-07-24T00:00:00.000Z',
            },
          },
        })),
        onStatusChanged,
      },
    } as unknown as typeof window.cradle

    await expect(waitForDesktopServer()).resolves.toBe('http://127.0.0.1:21423')
    expect(onStatusChanged).not.toHaveBeenCalled()
  })
})
