import { describe, expect, it, vi } from 'vitest'

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

describe('desktop server process observability env', () => {
  it('passes telemetry, exporter, and diagnostics env to the server child process', async () => {
    const { pickDesktopServerObservabilityEnv } = await import('./server-process')

    expect(pickDesktopServerObservabilityEnv({
      CRADLE_OTEL_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_PORT: '9464',
      CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token',
      CRADLE_LANGFUSE_ENABLED: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      CRADLE_DIAGNOSTICS_TOKEN: 'local-token',
      CRADLE_HOST: '0.0.0.0',
      CRADLE_DATA_DIR: '/tmp/other-data',
      EMPTY_VALUE: '',
    })).toEqual({
      CRADLE_OTEL_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
      CRADLE_OTEL_PROMETHEUS_PORT: '9464',
      CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token',
      CRADLE_LANGFUSE_ENABLED: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      CRADLE_DIAGNOSTICS_TOKEN: 'local-token',
    })
  })

  it('ignores blank observability values', async () => {
    const { pickDesktopServerObservabilityEnv } = await import('./server-process')

    expect(pickDesktopServerObservabilityEnv({
      CRADLE_OTEL_ENABLED: '   ',
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
    })).toEqual({
      CRADLE_OTEL_PROMETHEUS_ENABLED: '1',
    })
  })
})

describe('desktop server process identity', () => {
  it('recognizes Cradle development and packaged server process commands', async () => {
    const { isDesktopServerProcessCommand } = await import('./server-process')

    expect(isDesktopServerProcessCommand(
      '/Users/wibus/.vite-plus/js_runtime/node/24.16.0/bin/node --import tsx /Users/wibus/dev/Cradle/apps/server/src/index.ts',
    )).toBe(true)
    expect(isDesktopServerProcessCommand(
      '/Applications/Cradle.app/Contents/Resources/node /Applications/Cradle.app/Contents/Resources/server/dist/main.js',
    )).toBe(true)
  })

  it('rejects unrelated node processes', async () => {
    const { isDesktopServerProcessCommand } = await import('./server-process')

    expect(isDesktopServerProcessCommand(
      '/Users/wibus/.vite-plus/js_runtime/node/24.16.0/bin/node ./node_modules/.bin/../vite-node/dist/cli.mjs src/index.ts',
    )).toBe(false)
    expect(isDesktopServerProcessCommand(
      '/Applications/Codex.app/Contents/Resources/node_repl',
    )).toBe(false)
  })
})

describe('desktop server exit classification', () => {
  it('treats desktop-marked exits as intentional', async () => {
    const { classifyDesktopServerExit } = await import('./server-process')

    expect(classifyDesktopServerExit({
      signal: 'SIGTERM',
      expectation: {
        pid: 123,
        source: 'desktop',
        reason: 'test shutdown',
        requestedAt: '2026-06-08T00:00:00.000Z',
        requestedSignal: 'SIGTERM',
      },
    })).toBe('desktop-requested')
  })

  it('treats unmarked signal exits as external kills', async () => {
    const { classifyDesktopServerExit } = await import('./server-process')

    expect(classifyDesktopServerExit({
      signal: 'SIGTERM',
      expectation: null,
    })).toBe('external-signal-or-os-kill')
  })
})
