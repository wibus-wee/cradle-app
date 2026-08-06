import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { PassThrough, Readable, Writable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCradleCodexAppServerEnv,
  CodexAppServerClient,
  isCodexAppServerUnknownMethodError,
  readCradleCodexClientVersion,
  resolveCodexAppServerHome,
  resolveCodexAppServerLaunch,
  summarizeCodexAppServerStderr,
} from './client'

const spawnMock = vi.hoisted(() => vi.fn())
const managedProcessMock = vi.hoisted(() => vi.fn())
const syncLogInsertBlockerMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../../../../infra/managed-process', () => ({
  spawnManagedProcess: managedProcessMock,
}))

vi.mock('./log-insert-blocker', () => ({
  syncCodexAppServerLogInsertBlockerFromFeatureFlag: syncLogInsertBlockerMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function createCodexVersionProcess(output: string) {
  const stdout = new PassThrough()
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = stdout
  child.kill = vi.fn()
  queueMicrotask(() => {
    stdout.write(output)
    stdout.end()
    child.emit('close', 0)
  })
  return child
}

function createAppServerProcess() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() })
  child.stdout = stdout
  child.stderr = stderr
  child.kill = vi.fn()
  return asManagedProcess(child)
}

function asManagedProcess<T extends object>(child: T): T & {
  targetPid: number | null
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  stop: ReturnType<typeof vi.fn>
} {
  return Object.assign(child, {
    targetPid: 1234,
    exitCode: null,
    signalCode: null,
    stop: vi.fn(async (signal: NodeJS.Signals = 'SIGTERM') => {
      const kill = (child as { kill?: (signal?: NodeJS.Signals) => unknown }).kill
      kill?.(signal)
    }),
  })
}

describe('resolveCodexAppServerHome', () => {
  it('uses the Cradle data directory before database path fallback', () => {
    expect(resolveCodexAppServerHome({
      env: {
        CRADLE_DATA_DIR: '/tmp/cradle-data',
        CRADLE_DB_PATH: '/tmp/other/cradle.db',
        CODEX_HOME: '/Users/test/.codex',
      },
      homeDir: '/Users/test',
    })).toBe(join('/tmp/cradle-data', 'runtimes', 'codex-app-server'))
  })

  it('uses the Cradle database directory when data directory is unavailable', () => {
    expect(resolveCodexAppServerHome({
      env: {
        CRADLE_DB_PATH: '/tmp/cradle-data/cradle.db',
        CODEX_HOME: '/Users/test/.codex',
      },
      homeDir: '/Users/test',
    })).toBe(join('/tmp/cradle-data', 'runtimes', 'codex-app-server'))
  })

  it('falls back to a Cradle-owned home instead of the user Codex home', () => {
    expect(resolveCodexAppServerHome({
      env: {
        CODEX_HOME: '/Users/test/.codex',
      },
      homeDir: '/Users/test',
    })).toBe(join('/Users/test', '.cradle', 'runtimes', 'codex-app-server'))
  })
})

describe('readCradleCodexClientVersion', () => {
  it('uses explicit Cradle version before package manager version', () => {
    expect(readCradleCodexClientVersion({
      CRADLE_VERSION: '1.2.3',
      npm_package_version: '4.5.6',
    })).toBe('1.2.3')
  })

  it('falls back to the package manager version', () => {
    expect(readCradleCodexClientVersion({
      npm_package_version: '4.5.6',
    })).toBe('4.5.6')
  })

  it('falls back to the Cradle package version', () => {
    expect(readCradleCodexClientVersion({})).toBe('0.0.1')
  })
})

describe('resolveCodexAppServerLaunch', () => {
  it('uses the desktop-provided standalone app-server path', () => {
    expect(resolveCodexAppServerLaunch({
      env: {
        CRADLE_CODEX_APP_SERVER_PATH: '/Applications/Cradle.app/Contents/Resources/codex-app-server',
      },
    })).toEqual({
      command: '/Applications/Cradle.app/Contents/Resources/codex-app-server',
      args: ['--listen', 'stdio://', '--session-source', 'cli'],
      source: 'configured-app-server',
    })
  })

  it('falls back to the global Codex command when standalone app-server is unavailable', () => {
    expect(resolveCodexAppServerLaunch({ env: { PATH: '' } })).toEqual({
      command: 'codex',
      args: ['app-server', '--listen', 'stdio://'],
      source: 'codex-cli-fallback',
    })
  })

  it('uses a standalone app-server discovered on PATH', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cradle-codex-app-server-path-'))
    const executableName = process.platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server'
    const executablePath = join(directory, executableName)
    mkdirSync(directory, { recursive: true })
    writeFileSync(executablePath, '')

    try {
      expect(resolveCodexAppServerLaunch({
        env: { PATH: [directory, '/unrelated'].join(delimiter) },
      })).toEqual({
        command: executablePath,
        args: ['--listen', 'stdio://', '--session-source', 'cli'],
        source: 'path-app-server',
      })
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('isCodexAppServerUnknownMethodError', () => {
  it('matches Codex app-server unknown variant errors for the requested method', () => {
    expect(isCodexAppServerUnknownMethodError(
      new Error('Invalid request: unknown variant `skills/extraRoots/set`, expected one of `initialize`, `turn/start`'),
      'skills/extraRoots/set',
    )).toBe(true)
  })

  it('does not match different methods or generic failures', () => {
    expect(isCodexAppServerUnknownMethodError(
      new Error('Invalid request: unknown variant `thread/settings/update`, expected one of `initialize`, `turn/start`'),
      'skills/extraRoots/set',
    )).toBe(false)
    expect(isCodexAppServerUnknownMethodError(
      new Error('Codex app-server exited with code 1'),
      'skills/extraRoots/set',
    )).toBe(false)
  })
})

describe('codexAppServerClient', () => {
  it('summarizes repeated process diagnostics into actionable core errors', () => {
    const stderr = [
      '\u001B[2m2026-08-06T02:01:00.179537Z\u001B[0m \u001B[31mERROR\u001B[0m \u001B[2mrmcp::transport::worker\u001B[0m: worker quit with fatal: Transport channel closed, when UnexpectedServerResponse("HTTP 502: ")',
      '\u001B[2m2026-08-06T02:01:04.796556Z\u001B[0m \u001B[31mERROR\u001B[0m \u001B[2mrmcp::transport::worker\u001B[0m: worker quit with fatal: Transport channel closed, when UnexpectedServerResponse("HTTP 502: ")',
      '\u001B[2m2026-08-06T02:01:05.190902Z\u001B[0m \u001B[31mERROR\u001B[0m \u001B[2mcodex_api::endpoint::responses_websocket\u001B[0m: failed to connect to websocket: IO error: tls handshake eof, url: wss://chatgpt.com/backend-api/codex/responses',
      '\u001B[2m2026-08-06T02:08:30.440279Z\u001B[0m \u001B[31mERROR\u001B[0m \u001B[2mcodex_core::tools::router\u001B[0m: apply_patch verification failed: unrelated tool output',
    ].join('\n')

    expect(summarizeCodexAppServerStderr(stderr)).toBe(
      'worker quit with fatal: Transport channel closed, when UnexpectedServerResponse("HTTP 502: "); failed to connect to websocket: IO error: tls handshake eof',
    )
  })

  it('returns no process diagnostic suffix when stderr has no useful error lines', () => {
    expect(summarizeCodexAppServerStderr('notice: shutting down\n')).toBeNull()
  })

  it('passes Cradle context environment into the app-server process', () => {
    managedProcessMock.mockReturnValueOnce(asManagedProcess({
      stdin: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      stdout: new Readable({ read: () => undefined }),
      stderr: new EventEmitter(),
      once: vi.fn(),
      kill: vi.fn(),
    }))

    const client = new CodexAppServerClient({
      appServerPath: 'codex-app-server-test',
      env: buildCradleCodexAppServerEnv({
        chatSessionId: 'chat-session-1',
        workspaceId: 'workspace-1',
      }),
    })

    expect(managedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spawn',
        command: 'codex-app-server-test',
        args: ['--listen', 'stdio://', '--session-source', 'cli'],
        env: expect.objectContaining({
          CRADLE_CHAT_SESSION_ID: 'chat-session-1',
          CRADLE_WORKSPACE_ID: 'workspace-1',
        }),
      }),
    )
    client.close()
  })

  it('passes config overrides to the standalone app-server entrypoint', () => {
    managedProcessMock.mockReturnValueOnce(createAppServerProcess())

    const client = new CodexAppServerClient({
      appServerPath: 'codex-app-server-test',
      config: {
        model: 'gpt-5.4',
        features: { remoteControl: true },
      },
    })

    expect(managedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'codex-app-server-test',
        args: [
          '--listen',
          'stdio://',
          '--session-source',
          'cli',
          '--config',
          'model="gpt-5.4"',
          '--config',
          'features.remoteControl=true',
        ],
      }),
    )
    client.close()
  })

  it('uses the desktop-provided bundled Codex runtime when no explicit path is set', () => {
    const child = createAppServerProcess()
    managedProcessMock.mockReturnValueOnce(child)

    const client = new CodexAppServerClient({
      env: {
        CRADLE_CODEX_APP_SERVER_PATH: '/Applications/Cradle.app/Contents/Resources/codex-app-server',
      },
    })

    expect(managedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/Applications/Cradle.app/Contents/Resources/codex-app-server',
        args: ['--listen', 'stdio://', '--session-source', 'cli'],
      }),
    )
    client.close()
  })

  it('sends the Cradle client version during app-server initialization', async () => {
    const stdout = new PassThrough()
    let writtenLine = ''

    managedProcessMock.mockReturnValueOnce(asManagedProcess({
      stdin: new Writable({
        write: (chunk, _encoding, callback) => {
          writtenLine += chunk.toString('utf8')
          stdout.write(`${JSON.stringify({
            id: 1,
            result: {
              userAgent: 'cradle/1.2.3',
              codexHome: '/tmp/codex-home',
              platformFamily: 'unix',
              platformOs: 'macos',
            },
          })}\n`)
          callback()
        },
      }),
      stdout,
      stderr: new EventEmitter(),
      once: vi.fn(),
      kill: vi.fn(),
    }))

    const client = new CodexAppServerClient({
      appServerPath: 'codex-app-server-test',
      env: { CRADLE_VERSION: '1.2.3' },
    })

    await client.initialize()

    expect(syncLogInsertBlockerMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(writtenLine.trim())).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'cradle', title: 'Cradle', version: '1.2.3' },
        capabilities: { experimentalApi: true },
      },
    })
    client.close()
  })

  it('can initialize with Codex-native client info instead of Cradle client info', async () => {
    const stdout = new PassThrough()
    let writtenLine = ''

    managedProcessMock.mockReturnValueOnce(asManagedProcess({
      stdin: new Writable({
        write: (chunk, _encoding, callback) => {
          writtenLine += chunk.toString('utf8')
          stdout.write(`${JSON.stringify({
            id: 1,
            result: {
              userAgent: 'codex/0.135.0',
              codexHome: '/tmp/codex-home',
              platformFamily: 'unix',
              platformOs: 'macos',
            },
          })}\n`)
          callback()
        },
      }),
      stdout,
      stderr: new EventEmitter(),
      once: vi.fn(),
      kill: vi.fn(),
    }))
    spawnMock.mockReturnValueOnce(createCodexVersionProcess('codex-cli 0.135.0\n'))

    const client = new CodexAppServerClient({
      appServerPath: 'codex-app-server-native-test',
      env: { CRADLE_VERSION: '1.2.3' },
      userAgentMode: 'native',
    })

    await client.initialize()

    expect(JSON.parse(writtenLine.trim())).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codex', title: 'Codex', version: '0.135.0' },
        capabilities: { experimentalApi: true },
      },
    })
    client.close()
  })

  it('uses the interactive Codex CLI request identity in CLI-compatible mode', async () => {
    const stdout = new PassThrough()
    let writtenLine = ''

    managedProcessMock.mockReturnValueOnce(asManagedProcess({
      stdin: new Writable({
        write: (chunk, _encoding, callback) => {
          writtenLine += chunk.toString('utf8')
          stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`)
          callback()
        },
      }),
      stdout,
      stderr: new EventEmitter(),
      once: vi.fn(),
      kill: vi.fn(),
    }))
    spawnMock.mockReturnValueOnce(createCodexVersionProcess('codex-cli 0.144.4\n'))

    const client = new CodexAppServerClient({
      appServerPath: 'codex-app-server-cli-compatible-test',
      env: { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'cradle' },
      userAgentMode: 'cradle',
      cliCompatibleIdentity: true,
    })

    await client.initialize()

    expect(managedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--listen', 'stdio://', '--session-source', 'cli'],
        env: expect.not.objectContaining({
          CODEX_INTERNAL_ORIGINATOR_OVERRIDE: expect.anything(),
        }),
      }),
    )
    expect(JSON.parse(writtenLine.trim())).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'codex-tui',
          title: 'Codex CLI',
          version: '0.144.4',
        },
        capabilities: { experimentalApi: true },
      },
    })
    client.close()
  })

  it('rejects pending requests when the app-server process closes without an exit event', async () => {
    const child = createAppServerProcess()
    managedProcessMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ appServerPath: 'codex-app-server-test' })

    const request = client.request('config/read')
    child.emit('close', 0, null)

    await expect(request).rejects.toThrow('Codex app-server exited')
    await expect(client.request('config/read')).rejects.toThrow('Codex app-server is closed')
  })

  it('marks the client closed after process spawn errors', async () => {
    const child = createAppServerProcess()
    managedProcessMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ appServerPath: 'codex-app-server-test' })

    const request = client.request('config/read')
    child.emit('error', new Error('spawn failed'))

    await expect(request).rejects.toThrow('spawn failed')
    await expect(client.request('config/read')).rejects.toThrow('Codex app-server is closed')
  })

  it('wakes notification waiters when the app-server process terminates', async () => {
    const child = createAppServerProcess()
    managedProcessMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ appServerPath: 'codex-app-server-test' })

    const notification = client.nextNotification()
    child.stderr.write('fatal startup error')
    child.emit('close', 1, null)

    await expect(notification).resolves.toEqual({
      method: 'error',
      params: { message: 'Codex app-server exited with code 1: fatal startup error' },
    })
  })

  it('closes the client instead of throwing when a server-request response hits a broken pipe', async () => {
    const stdout = new PassThrough()
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    child.stdin = new Writable({
      write: (_chunk, _encoding, callback) => callback(new Error('write EPIPE')),
    })
    child.stdout = stdout
    child.stderr = new PassThrough()
    child.kill = vi.fn()
    managedProcessMock.mockReturnValueOnce(asManagedProcess(child))

    const client = new CodexAppServerClient({
      appServerPath: 'codex-app-server-test',
      serverRequestHandler: () => ({ ok: true }),
      exposeServerRequestsAsNotifications: false,
    })

    const notification = client.nextNotification()
    stdout.write(`${JSON.stringify({ id: 1, method: 'host/request' })}\n`)

    await expect(notification).resolves.toEqual({
      method: 'error',
      params: { message: 'write EPIPE' },
    })
    await expect(client.request('config/read')).rejects.toThrow('Codex app-server is closed')
  })

  it('keeps NDJSON frames intact when JSON strings contain U+2028 line separators', async () => {
    const child = createAppServerProcess()
    managedProcessMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ appServerPath: 'codex-app-server-test' })

    const description = [
      'Use Flight Network ChatGPT app to find and compare real-time flight options directly in your chat.',
      '\u2028\n\nSimply type @Flight Network followed by your request',
      '\u2028\n\nReal-Time Data: Access live pricing',
    ].join('')
    const notification = {
      method: 'app/list/updated',
      params: {
        data: [{ name: 'Flight Network', description }],
      },
    }

    const pending = client.nextNotification()
    child.stdout.write(`${JSON.stringify(notification)}\n`)

    await expect(pending).resolves.toEqual(notification)
    await client.close()
  })

  it('ignores plaintext stdout pollution instead of failing the turn via jsonrepair', async () => {
    const child = createAppServerProcess()
    managedProcessMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ appServerPath: 'codex-app-server-test' })

    const pending = client.nextNotification()
    child.stdout.write('\\n\\nSimply type @Flight Network followed by your request\n')
    child.stdout.write(`${JSON.stringify({ method: 'thread/status/changed', params: { status: 'idle' } })}\n`)

    await expect(pending).resolves.toEqual({
      method: 'thread/status/changed',
      params: { status: 'idle' },
    })
    await client.close()
  })
})
