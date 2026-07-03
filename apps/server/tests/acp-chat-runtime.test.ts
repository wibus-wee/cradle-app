import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { workspaces } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { readSessionTailEvents } from '../src/modules/chat-runtime/es/event-tail'
import { addHostMcpServer, removeHostMcpServer } from '../src/plugins/mcp-registry'

const acpMocks = vi.hoisted(() => {
  let client: {
    requestPermission: (params: unknown) => Promise<unknown>
    sessionUpdate: (params: unknown) => Promise<void>
    writeTextFile?: (params: { sessionId: string, path: string, content: string }) => Promise<unknown>
    readTextFile?: (params: { sessionId: string, path: string }) => Promise<{ content: string }>
  } | null = null

  return {
    initialize: vi.fn(),
    newSession: vi.fn(),
    loadSession: vi.fn(),
    resumeSession: vi.fn(),
    prompt: vi.fn(),
    cancel: vi.fn(),
    setSessionModel: vi.fn(),
    setSessionConfigOption: vi.fn(),
    spawn: vi.fn(),
    setClient(next: typeof client) {
      client = next
    },
    getClient() {
      return client
    },
  }
})

vi.mock('@agentclientprotocol/sdk', () => {
  class FakeClientSideConnection {
    closed = new Promise<void>(() => {})

    constructor(createClient: (agent: unknown) => unknown) {
      acpMocks.setClient(createClient({}) as {
        requestPermission: (params: unknown) => Promise<unknown>
        sessionUpdate: (params: unknown) => Promise<void>
        writeTextFile?: (params: { sessionId: string, path: string, content: string }) => Promise<unknown>
        readTextFile?: (params: { sessionId: string, path: string }) => Promise<{ content: string }>
      })
    }

    initialize = (...args: unknown[]) => acpMocks.initialize(...args)
    newSession = (...args: unknown[]) => acpMocks.newSession(...args)
    loadSession = (...args: unknown[]) => acpMocks.loadSession(...args)
    unstable_resumeSession = (...args: unknown[]) => acpMocks.resumeSession(...args)
    prompt = (...args: unknown[]) => acpMocks.prompt(...args)
    cancel = (...args: unknown[]) => acpMocks.cancel(...args)
    unstable_setSessionModel = (...args: unknown[]) => acpMocks.setSessionModel(...args)
    setSessionConfigOption = (...args: unknown[]) => acpMocks.setSessionConfigOption(...args)
  }

  return {
    ClientSideConnection: FakeClientSideConnection,
    PROTOCOL_VERSION: '2025-draft',
    ndJsonStream: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
  }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { PassThrough } = await import('node:stream')

  class FakeChildProcess extends PassThrough {
    readonly stdin = new PassThrough()
    readonly stdout = new PassThrough()
    readonly stderr = new PassThrough()
    readonly pid = 4242
    exitCode: number | null = null

    kill(_signal?: string): boolean {
      this.exitCode = 0
      this.emit('exit', 0, null)
      return true
    }
  }

  return {
    ...actual,
    spawn: (...args: unknown[]) => acpMocks.spawn(...args),
    ChildProcess: FakeChildProcess,
  }
})

interface ChatMessageSnapshot {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  content: string
  message: {
    parts: Array<{ type: string, text?: string, state?: string, toolCallId?: string, output?: unknown, errorText?: string }>
  }
}

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createAcpProfileAndSession(app: ElysiaApp, workspaceId: string) {
  const targetRes = await app.handle(new Request('http://localhost/provider-targets/provider-target-acp', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: 'ACP Runtime Provider',
      providerKind: 'openai-compatible',
      enabled: true,
      connectionConfig: { distributionType: 'npx', cmd: '@demo/acp-agent', args: ['--stdio'] },
      credentialRef: null,
    }),
  }))
  expect(targetRes.status).toBe(200)

  const sessionRes = await app.handle(new Request('http://localhost/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'session-acp',
      workspaceId,
      title: 'ACP Runtime Session',
      providerTargetId: 'provider-target-acp',
      runtimeKind: 'acp-chat',
    }),
  }))
  expect(sessionRes.status).toBe(200)
}

async function waitForMessageStatus(app: ElysiaApp, sessionId: string, expectedStatus: ChatMessageSnapshot['status']): Promise<ChatMessageSnapshot[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
    if (response.status === 200) {
      const groups = await response.json() as ChatMessageSnapshot[]
      const assistant = groups.find(group => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for assistant status ${expectedStatus}`)
}

async function waitForToolApprovalRequest(sessionId: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const approvalEvent = readSessionTailEvents({ sessionId, afterVersion: 0 }).find((event) => {
      const payload = event.payload
      return event.type === 'InteractionRequested'
        && 'interactionKind' in payload
        && payload.interactionKind === 'toolApproval'
    })
    if (approvalEvent) {
      const payload = approvalEvent.payload
      if ('requestId' in payload) {
        return payload.requestId
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error('Timed out waiting for ACP tool approval request')
}

describe('acp chat runtime capability', () => {
  beforeEach(() => {
    acpMocks.setClient(null)
    acpMocks.initialize.mockReset()
    acpMocks.newSession.mockReset()
    acpMocks.loadSession.mockReset()
    acpMocks.resumeSession.mockReset()
    acpMocks.prompt.mockReset()
    acpMocks.cancel.mockReset()
    acpMocks.setSessionModel.mockReset()
    acpMocks.setSessionConfigOption.mockReset()
    acpMocks.spawn.mockReset()
    removeHostMcpServer('browser-use')
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/tmp/browser-use-mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })

    acpMocks.initialize.mockResolvedValue({
      protocolVersion: '1.0',
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
      },
    })
    acpMocks.newSession.mockResolvedValue({
      sessionId: 'acp-session-1',
      models: {
        currentModelId: 'acp-model',
        availableModels: [{ modelId: 'acp-model', name: 'ACP Model' }],
      },
      configOptions: [],
    })
    acpMocks.loadSession.mockResolvedValue({ models: null, configOptions: [] })
    acpMocks.resumeSession.mockResolvedValue({ models: null, configOptions: [] })
    acpMocks.cancel.mockResolvedValue(undefined)
    acpMocks.setSessionModel.mockResolvedValue(undefined)
    acpMocks.setSessionConfigOption.mockResolvedValue({ configOptions: [] })
    acpMocks.spawn.mockImplementation(() => {
      const proc = new PassThrough() as PassThrough & {
        stdin: PassThrough
        stdout: PassThrough
        stderr: PassThrough
        pid: number
        exitCode: number | null
        kill: (_signal?: string) => boolean
      }
      proc.stdin = new PassThrough()
      proc.stdout = new PassThrough()
      proc.stderr = new PassThrough()
      proc.pid = 4242
      proc.exitCode = null
      proc.kill = () => {
        proc.exitCode = 0
        proc.emit('exit', 0, null)
        return true
      }
      return proc
    })

    acpMocks.prompt.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
      const client = acpMocks.getClient()
      if (!client) {
        throw new Error('ACP client bridge not initialized')
      }

      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'session_info_update',
          title: 'ACP Session Renamed',
        },
      })

      await expect(client.requestPermission({
        sessionId,
        toolCall: { title: 'Write workspace file' },
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject_once', name: 'Reject once', kind: 'reject_once' },
        ],
      })).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'allow_once' },
      })

      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Thinking...' },
        },
      })
      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello from ACP runtime' },
        },
      })

      return {
        usage: {
          inputTokens: 7,
          outputTokens: 4,
          totalTokens: 11,
        },
      }
    })
  })

  afterEach(() => {
    removeHostMcpServer('browser-use')
    vi.restoreAllMocks()
  })

  it('runs an ACP turn through server chat-runtime, bridges ACP permission side channels, syncs titles, and writes usage', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-acp',
        name: 'Workspace ACP',
        path: workspaceRoot,
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
      }).run()

      await createAcpProfileAndSession(app, 'workspace-acp')

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-acp/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Explain ACP runtime ownership' }),
      }))
      expect(runRes.status).toBe(200)

      const approvalRequestId = await waitForToolApprovalRequest('session-acp')
      const approvalRes = await app.handle(new Request(`http://localhost/chat/sessions/session-acp/tool-approval/${approvalRequestId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      }))
      expect(approvalRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-acp', 'complete')
      expect(timeline).toHaveLength(2)
      const user = timeline.find(message => message.role === 'user')
      const assistant = timeline.find(message => message.role === 'assistant')
      expect(user).toEqual(expect.objectContaining({
        role: 'user',
        content: 'Explain ACP runtime ownership',
        status: 'complete',
      }))

      expect(assistant).toEqual(expect.objectContaining({ role: 'assistant', status: 'complete' }))
      expect(assistant?.content).toBe('Hello from ACP runtime')
      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', text: 'Thinking...', state: 'done' }),
        expect.objectContaining({ type: 'text', text: 'Hello from ACP runtime', state: 'done' }),
      ]))

      const sessionRes = await app.handle(new Request('http://localhost/sessions/session-acp'))
      expect(sessionRes.status).toBe(200)
      expect((await sessionRes.json()).title).toBe('ACP Session Renamed')

      const usageRes = await app.handle(new Request('http://localhost/usage/sessions/session-acp'))
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 7,
        completionTokens: 4,
        totalTokens: 11,
      }))
      expect(acpMocks.newSession).toHaveBeenCalledWith({
        cwd: workspaceRoot,
        mcpServers: expect.arrayContaining([
          expect.objectContaining({
            name: 'browser-use',
            command: 'node',
            args: ['/tmp/browser-use-mcp-server.mjs'],
            env: [{ name: 'BROWSER_BACKEND_SOCKET', value: '/tmp/cradle-browser.sock' }],
          }),
        ]),
      })
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('passes registered MCP servers when loading and resuming ACP sessions', async () => {
    const { AcpConnectionManager } = await import('../src/modules/chat-runtime-providers/acp/connection-manager')
    const manager = new AcpConnectionManager({
      spawn: () => ({
        agentId: 'profile-acp',
        proc: {} as never,
        startedAt: Date.now(),
        stderrBuf: [],
        stdinWeb: new WritableStream<Uint8Array>(),
        stdoutWeb: new ReadableStream<Uint8Array>(),
      }),
      stop: async () => {},
      getMetrics: () => [],
      disposeAll: () => {},
    } as never)

    await manager.connect('profile-acp', {
      distributionType: 'npx',
      cmd: '@demo/acp-agent',
      args: '[]',
      env: '{}',
      installPath: null,
    })

    await manager.loadSession('profile-acp', 'acp-session-load', '/tmp/workspace')
    await manager.resumeSession('profile-acp', 'acp-session-resume', '/tmp/workspace')

    const expectedMcpServers = [
      expect.objectContaining({
        name: 'browser-use',
        command: 'node',
        args: ['/tmp/browser-use-mcp-server.mjs'],
        env: [{ name: 'BROWSER_BACKEND_SOCKET', value: '/tmp/cradle-browser.sock' }],
      }),
    ]
    expect(acpMocks.loadSession).toHaveBeenCalledWith({
      sessionId: 'acp-session-load',
      cwd: '/tmp/workspace',
      mcpServers: expect.arrayContaining(expectedMcpServers),
    })
    expect(acpMocks.resumeSession).toHaveBeenCalledWith({
      sessionId: 'acp-session-resume',
      cwd: '/tmp/workspace',
      mcpServers: expect.arrayContaining(expectedMcpServers),
    })
    expect(acpMocks.initialize).toHaveBeenCalledWith(expect.objectContaining({
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    }))
  })

  it('fails closed before ACP agents write client filesystem paths', async () => {
    const { AcpConnectionManager } = await import('../src/modules/chat-runtime-providers/acp/connection-manager')
    const workspaceRoot = makeTempDir('cradle-acp-write-')
    const targetPath = join(workspaceRoot, 'notes.md')
    const manager = new AcpConnectionManager({
      spawn: () => ({
        agentId: 'profile-acp',
        proc: {} as never,
        startedAt: Date.now(),
        stderrBuf: [],
        stdinWeb: new WritableStream<Uint8Array>(),
        stdoutWeb: new ReadableStream<Uint8Array>(),
      }),
      stop: async () => {},
      getMetrics: () => [],
      disposeAll: () => {},
    } as never)

    try {
      await manager.connect('profile-acp', {
        distributionType: 'npx',
        cmd: '@demo/acp-agent',
        args: '[]',
        env: '{}',
        installPath: null,
      })

      const client = acpMocks.getClient()
      expect(client?.writeTextFile).toBeTypeOf('function')
      await expect(client?.writeTextFile?.({
        sessionId: 'acp-session-write',
        path: targetPath,
        content: 'allowed write\n',
      })).rejects.toThrow('ACP file write requires an approval handler before writing client filesystem paths')

      expect(existsSync(targetPath)).toBe(false)
    }
    finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
      await manager.disconnect('profile-acp').catch(() => {})
    }
  })

  it('does not write ACP client filesystem paths when the injected policy rejects', async () => {
    const { AcpConnectionManager } = await import('../src/modules/chat-runtime-providers/acp/connection-manager')
    const workspaceRoot = makeTempDir('cradle-acp-write-reject-')
    const targetPath = join(workspaceRoot, 'notes.md')
    const manager = new AcpConnectionManager({
      spawn: () => ({
        agentId: 'profile-acp',
        proc: {} as never,
        startedAt: Date.now(),
        stderrBuf: [],
        stdinWeb: new WritableStream<Uint8Array>(),
        stdoutWeb: new ReadableStream<Uint8Array>(),
      }),
      stop: async () => {},
      getMetrics: () => [],
      disposeAll: () => {},
    } as never)

    manager.setPermissionHandler(async () => ({ outcome: 'selected', optionId: 'reject_file_write_once' }))

    try {
      await manager.connect('profile-acp', {
        distributionType: 'npx',
        cmd: '@demo/acp-agent',
        args: '[]',
        env: '{}',
        installPath: null,
      })

      const client = acpMocks.getClient()
      await expect(client?.writeTextFile?.({
        sessionId: 'acp-session-write',
        path: targetPath,
        content: 'rejected write\n',
      })).rejects.toThrow('User denied ACP client filesystem write')

      expect(existsSync(targetPath)).toBe(false)
    }
    finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
      await manager.disconnect('profile-acp').catch(() => {})
    }
  })
})
