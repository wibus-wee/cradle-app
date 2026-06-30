import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { PassThrough, Readable, Writable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCradleCodexAppServerEnv,
  CodexAppServerClient,
  isCodexAppServerUnknownMethodError,
  readCradleCodexClientVersion,
  resolveCodexAppServerHome,
  resolveCodexAppServerPath,
} from './client'

const spawnMock = vi.hoisted(() => vi.fn())
const syncLogInsertBlockerMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
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
  return child
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

describe('resolveCodexAppServerPath', () => {
  it('uses the desktop-provided bundled Codex runtime path', () => {
    expect(resolveCodexAppServerPath({
      CRADLE_CODEX_APP_SERVER_PATH: '/Applications/Cradle.app/Contents/Resources/codex',
    })).toBe('/Applications/Cradle.app/Contents/Resources/codex')
  })

  it('falls back to the global Codex command for non-desktop runtimes', () => {
    expect(resolveCodexAppServerPath({})).toBe('codex')
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
  it('passes Cradle context environment into the app-server process', () => {
    spawnMock.mockReturnValueOnce({
      stdin: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      stdout: new Readable({ read: () => undefined }),
      stderr: new EventEmitter(),
      once: vi.fn(),
      kill: vi.fn(),
    })

    const client = new CodexAppServerClient({
      codexPath: 'codex-test',
      env: buildCradleCodexAppServerEnv({
        chatSessionId: 'chat-session-1',
        workspaceId: 'workspace-1',
      }),
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'codex-test',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({
        env: expect.objectContaining({
          CRADLE_CHAT_SESSION_ID: 'chat-session-1',
          CRADLE_WORKSPACE_ID: 'workspace-1',
        }),
      }),
    )
    client.close()
  })

  it('uses the desktop-provided bundled Codex runtime when no explicit path is set', () => {
    const child = createAppServerProcess()
    spawnMock.mockReturnValueOnce(child)

    const client = new CodexAppServerClient({
      env: {
        CRADLE_CODEX_APP_SERVER_PATH: '/Applications/Cradle.app/Contents/Resources/codex',
      },
    })

    expect(spawnMock).toHaveBeenCalledWith(
      '/Applications/Cradle.app/Contents/Resources/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.any(Object),
    )
    client.close()
  })

  it('sends the Cradle client version during app-server initialization', async () => {
    const stdout = new PassThrough()
    let writtenLine = ''

    spawnMock.mockReturnValueOnce({
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
    })

    const client = new CodexAppServerClient({
      codexPath: 'codex-test',
      env: { CRADLE_VERSION: '1.2.3' },
    })

    await client.initialize()

    expect(syncLogInsertBlockerMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(writtenLine.trim())).toEqual({
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

    spawnMock
      .mockReturnValueOnce({
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
      })
      .mockReturnValueOnce(createCodexVersionProcess('codex-cli 0.135.0\n'))

    const client = new CodexAppServerClient({
      codexPath: 'codex-native-test',
      env: { CRADLE_VERSION: '1.2.3' },
      userAgentMode: 'native',
    })

    await client.initialize()

    expect(JSON.parse(writtenLine.trim())).toEqual({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codex', title: 'Codex', version: '0.135.0' },
        capabilities: { experimentalApi: true },
      },
    })
    client.close()
  })

  it('rejects pending requests when the app-server process closes without an exit event', async () => {
    const child = createAppServerProcess()
    spawnMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ codexPath: 'codex-test' })

    const request = client.request('config/read')
    child.emit('close', 0, null)

    await expect(request).rejects.toThrow('Codex app-server exited')
    await expect(client.request('config/read')).rejects.toThrow('Codex app-server is closed')
  })

  it('marks the client closed after process spawn errors', async () => {
    const child = createAppServerProcess()
    spawnMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ codexPath: 'codex-test' })

    const request = client.request('config/read')
    child.emit('error', new Error('spawn failed'))

    await expect(request).rejects.toThrow('spawn failed')
    await expect(client.request('config/read')).rejects.toThrow('Codex app-server is closed')
  })

  it('wakes notification waiters when the app-server process terminates', async () => {
    const child = createAppServerProcess()
    spawnMock.mockReturnValueOnce(child)
    const client = new CodexAppServerClient({ codexPath: 'codex-test' })

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
    spawnMock.mockReturnValueOnce(child)

    const client = new CodexAppServerClient({
      codexPath: 'codex-test',
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
})
