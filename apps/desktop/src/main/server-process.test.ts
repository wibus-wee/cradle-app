import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesktopServerBootstrapSnapshot } from '../shared/server-runtime'
import {
  applyServerBootstrapEvent,
  createDesktopServerBootstrapSnapshot,
} from '../shared/server-runtime'

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/tmp/cradle-user-data'),
    getVersion: vi.fn(() => '0.0.1-test'),
  },
  dialog: {
    showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })),
  },
}))

vi.mock('electron', () => electronMocks)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('desktop server readiness', () => {
  it.each(['database-migration', 'database-maintenance'] as const)(
    'allows %s to run beyond the former 90 second deadline',
    async (phase) => {
      vi.useFakeTimers()
      const startedAt = Date.now()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (Date.now() - startedAt >= 91_000) {
            return { ok: true }
          }
          throw new Error('not listening')
        }),
      )
      const { waitForServer } = await import('./server-process')
      let snapshot = applyServerBootstrapEvent(createDesktopServerBootstrapSnapshot(), {
        type: 'cradle-server-bootstrap',
        phase,
        kind: 'started',
        at: new Date(startedAt).toISOString(),
      })

      const ready = waitForServer('http://127.0.0.1:21423', {
        bootstrapWatchdog: {
          globalTimeoutMs: 180_000,
          phaseTimeoutMs: 120_000,
          readSnapshot: () => snapshot,
        },
      })
      await vi.advanceTimersByTimeAsync(90_800)
      snapshot = finishBootstrap(snapshot)
      await vi.advanceTimersByTimeAsync(200)

      await expect(ready).resolves.toBeUndefined()
    },
  )

  it('allows delayed persisted-run recovery before the listener becomes healthy', async () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (Date.now() - startedAt >= 91_000) {
          return { ok: true }
        }
        throw new Error('not listening')
      }),
    )
    const { waitForServer } = await import('./server-process')
    let snapshot = applyServerBootstrapEvent(createDesktopServerBootstrapSnapshot(), {
      type: 'cradle-server-bootstrap',
      phase: 'persisted-run-recovery',
      kind: 'started',
      at: new Date(startedAt).toISOString(),
    })

    const ready = waitForServer('http://127.0.0.1:21423', {
      bootstrapWatchdog: {
        globalTimeoutMs: 180_000,
        phaseTimeoutMs: 120_000,
        readSnapshot: () => snapshot,
      },
    })
    await vi.advanceTimersByTimeAsync(90_800)
    snapshot = finishBootstrap(snapshot)
    await vi.advanceTimersByTimeAsync(200)

    await expect(ready).resolves.toBeUndefined()
  })

  it('includes the stalled phase and last event in watchdog diagnostics', async () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('not listening')
      }),
    )
    const { waitForServer } = await import('./server-process')
    const snapshot = applyServerBootstrapEvent(createDesktopServerBootstrapSnapshot(), {
      type: 'cradle-server-bootstrap',
      phase: 'persisted-run-recovery',
      kind: 'started',
      at: new Date(startedAt).toISOString(),
    })

    const ready = waitForServer('http://127.0.0.1:21423', {
      bootstrapWatchdog: {
        globalTimeoutMs: 1_000,
        phaseTimeoutMs: 400,
        readSnapshot: () => snapshot,
      },
    })
    const expectation = expect(ready).rejects.toThrow(
      'Last bootstrap phase: "persisted-run-recovery". Phase duration: 400ms. Last known bootstrap event: started:persisted-run-recovery',
    )
    await vi.advanceTimersByTimeAsync(400)

    await expectation
  })

  it('keeps bounded readiness probes for located servers', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('not listening')
      }),
    )
    const { waitForServer } = await import('./server-process')

    const ready = waitForServer('http://127.0.0.1:21423', { timeoutMs: 400 })
    const expectation = expect(ready).rejects.toThrow('Server failed to start within 400ms')
    await vi.advanceTimersByTimeAsync(400)

    await expectation
  })

  it('requires the listener ready lifecycle event in addition to health', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
    const { waitForServer } = await import('./server-process')

    const ready = waitForServer('http://127.0.0.1:21423', {
      bootstrapWatchdog: {
        globalTimeoutMs: 1_000,
        phaseTimeoutMs: 400,
        readSnapshot: createDesktopServerBootstrapSnapshot,
      },
    })
    const expectation = expect(ready).rejects.toThrow('Server bootstrap global timeout after 1000ms')
    await vi.advanceTimersByTimeAsync(1_000)

    await expectation
  })

  it('accepts bootstrap events forwarded through the nested managed-process envelope', async () => {
    const { readServerBootstrapEvent } = await import('./server-process')

    expect(
      readServerBootstrapEvent({
        type: 'target-message',
        message: {
          type: 'cradle-server-bootstrap',
          phase: 'listener-establishment',
          kind: 'ready',
          at: '2026-07-24T00:00:00.000Z',
        },
      }),
    ).toEqual({
      type: 'cradle-server-bootstrap',
      phase: 'listener-establishment',
      kind: 'ready',
      at: '2026-07-24T00:00:00.000Z',
    })
  })
})

function finishBootstrap(
  snapshot: DesktopServerBootstrapSnapshot,
): DesktopServerBootstrapSnapshot {
  const at = new Date().toISOString()
  let next = snapshot
  if (next.currentPhase) {
    next = applyServerBootstrapEvent(next, {
      type: 'cradle-server-bootstrap',
      phase: next.currentPhase,
      kind: 'completed',
      at,
    })
  }
  for (const kind of ['started', 'completed', 'ready'] as const) {
    next = applyServerBootstrapEvent(next, {
      type: 'cradle-server-bootstrap',
      phase: 'listener-establishment',
      kind,
      at,
    })
  }
  return next
}

describe('desktop server process observability env', () => {
  it('passes telemetry, exporter, and diagnostics env to the server child process', async () => {
    const { pickDesktopServerObservabilityEnv } = await import('./server-process')

    expect(
      pickDesktopServerObservabilityEnv({
        CRADLE_OTEL_ENABLED: '1',
        CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
        CRADLE_OTEL_PROMETHEUS_PORT: '9464',
        CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token',
        CRADLE_LANGFUSE_ENABLED: '1',
        LANGFUSE_PUBLIC_KEY: 'pk-test',
        LANGFUSE_SECRET_KEY: 'sk-test',
        CRADLE_POSTHOG_AI_OBSERVABILITY_ENABLED: '1',
        CRADLE_POSTHOG_AI_CAPTURE_MODE: 'full',
        CRADLE_POSTHOG_PROJECT_TOKEN: 'phc-test',
        CRADLE_POSTHOG_HOST: 'https://us.i.posthog.com',
        CRADLE_DIAGNOSTICS_TOKEN: 'local-token',
        CRADLE_HOST: '0.0.0.0',
        CRADLE_DATA_DIR: '/tmp/other-data',
        EMPTY_VALUE: '',
      }),
    ).toEqual({
      CRADLE_OTEL_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_PORT: '9464',
      CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token',
      CRADLE_LANGFUSE_ENABLED: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      CRADLE_POSTHOG_AI_OBSERVABILITY_ENABLED: '1',
      CRADLE_POSTHOG_AI_CAPTURE_MODE: 'full',
      CRADLE_POSTHOG_PROJECT_TOKEN: 'phc-test',
      CRADLE_POSTHOG_HOST: 'https://us.i.posthog.com',
      CRADLE_DIAGNOSTICS_TOKEN: 'local-token',
    })
  })

  it('ignores blank observability values', async () => {
    const { pickDesktopServerObservabilityEnv } = await import('./server-process')

    expect(
      pickDesktopServerObservabilityEnv({
        CRADLE_OTEL_ENABLED: '   ',
        CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
      }),
    ).toEqual({
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
    })
  })
})

describe('desktop server process identity', () => {
  it('recognizes Cradle development and packaged server process commands', async () => {
    const { isDesktopServerProcessCommand } = await import('./server-process')

    expect(
      isDesktopServerProcessCommand(
        '/Users/wibus/.vite-plus/js_runtime/node/24.16.0/bin/node --import tsx /Users/wibus/dev/Cradle/apps/server/src/index.ts',
      ),
    ).toBe(true)
    expect(
      isDesktopServerProcessCommand(
        '/Applications/Cradle.app/Contents/Resources/node /Applications/Cradle.app/Contents/Resources/server/dist/main.js',
      ),
    ).toBe(true)
  })

  it('rejects unrelated node processes', async () => {
    const { isDesktopServerProcessCommand } = await import('./server-process')

    expect(
      isDesktopServerProcessCommand(
        '/Users/wibus/.vite-plus/js_runtime/node/24.16.0/bin/node ./node_modules/.bin/../vite-node/dist/cli.mjs src/index.ts',
      ),
    ).toBe(false)
    expect(
      isDesktopServerProcessCommand('/Applications/Codex.app/Contents/Resources/node_repl'),
    ).toBe(false)
  })
})

describe('desktop server inbound access preferences', () => {
  it('defaults to local-only server binding', async () => {
    const { desktopServerBindHostForAccessMode, readDesktopServerAccessMode }
      = await import('./server-process')
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-desktop-server-access-'))

    try {
      expect(readDesktopServerAccessMode(dataDir)).toBe('local')
      expect(desktopServerBindHostForAccessMode('local')).toBe('127.0.0.1')
    }
 finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('reads the persisted other-device access mode before spawning the server', async () => {
    const { desktopServerBindHostForAccessMode, readDesktopServerAccessMode }
      = await import('./server-process')
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-desktop-server-access-'))

    try {
      mkdirSync(join(dataDir, 'preferences'), { recursive: true })
      writeFileSync(
        join(dataDir, 'preferences/network.json'),
        JSON.stringify({
          proxyEnabled: true,
          proxyMode: 'system',
          customProxyUrl: null,
          inbound: {
            serverAccessMode: 'network',
            managedRelayAccessMode: 'local',
            managedRelayPublicUrl: null,
          },
        }),
      )

      const accessMode = readDesktopServerAccessMode(dataDir)
      expect(accessMode).toBe('network')
      expect(desktopServerBindHostForAccessMode(accessMode)).toBe('0.0.0.0')
    }
 finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('desktop server exit classification', () => {
  it('treats desktop-marked exits as intentional', async () => {
    const { classifyDesktopServerExit } = await import('./server-process')

    expect(
      classifyDesktopServerExit({
        signal: 'SIGTERM',
        expectation: {
          pid: 123,
          source: 'desktop',
          reason: 'test shutdown',
          requestedAt: '2026-06-08T00:00:00.000Z',
          requestedSignal: 'SIGTERM',
        },
      }),
    ).toBe('desktop-requested')
  })

  it('treats unmarked signal exits as external kills', async () => {
    const { classifyDesktopServerExit } = await import('./server-process')

    expect(
      classifyDesktopServerExit({
        signal: 'SIGTERM',
        expectation: null,
      }),
    ).toBe('external-signal-or-os-kill')
  })
})
