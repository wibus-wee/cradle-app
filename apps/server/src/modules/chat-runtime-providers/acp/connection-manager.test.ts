import type {
  Agent,
  AuthenticateRequest,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  PromptRequest,
  PromptResponse,
  StopReason,
} from '@agentclientprotocol/sdk'
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../plugins/mcp-registry'
import { ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import type { AcpConnectionRecord } from './config'
import { AcpConnectionManager, listRegisteredAcpMcpServers } from './connection-manager'
import type { AcpProcessHost, AcpProcessSpawnOptions, ProcessEntry } from './process-manager'

interface PeerBehavior {
  initialize?: (request: InitializeRequest, spawn: AcpProcessSpawnOptions) => InitializeResponse | Promise<InitializeResponse>
  authenticate?: (request: AuthenticateRequest, spawn: AcpProcessSpawnOptions) => void | Promise<void>
  newSession?: (request: NewSessionRequest) => { sessionId: string } | Promise<{ sessionId: string }>
  prompt?: (request: PromptRequest) => PromptResponse | Promise<PromptResponse>
  cancel?: (sessionId: string) => void | Promise<void>
}

class MemoryAcpProcessHost implements AcpProcessHost {
  readonly spawns: AcpProcessSpawnOptions[] = []
  readonly stops: string[] = []
  readonly peers: AgentSideConnection[] = []

  constructor(private readonly behavior: PeerBehavior) {}

  spawn(options: AcpProcessSpawnOptions): ProcessEntry {
    this.spawns.push(options)
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
    const behavior = this.behavior

    this.peers.push(new AgentSideConnection(() => ({
      initialize: request => behavior.initialize?.(request, options) ?? {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
        authMethods: [],
      },
      authenticate: request => behavior.authenticate?.(request, options),
      newSession: request => behavior.newSession?.(request) ?? { sessionId: 'session-1' },
      loadSession: async () => ({}),
      resumeSession: async () => ({}),
      setSessionConfigOption: async () => ({ configOptions: [] }),
      prompt: request => behavior.prompt?.(request) ?? { stopReason: 'end_turn' },
      cancel: async ({ sessionId }) => behavior.cancel?.(sessionId),
    } as Agent), ndJsonStream(agentToClient.writable, clientToAgent.readable)))

    return {
      agentId: options.agentId,
      proc: {} as never,
      startedAt: Date.now(),
      stderrBuf: [],
      stdinWeb: clientToAgent.writable,
      stdoutWeb: agentToClient.readable,
    }
  }

  async stop(agentId: string): Promise<void> {
    this.stops.push(agentId)
  }

  getMetrics() {
    return []
  }
}

function connectionRecord(overrides: Partial<AcpConnectionRecord> = {}): AcpConnectionRecord {
  return {
    distributionType: 'command',
    installPath: null,
    cmd: '/fake/acp-agent',
    args: '[]',
    env: '{}',
    authMethodId: null,
    authSecretRefs: {},
    ...overrides,
  }
}

async function collectPrompt(stopReason: StopReason) {
  const host = new MemoryAcpProcessHost({
    prompt: async () => ({ stopReason }),
  })
  const runtime = new AcpConnectionManager(host)
  await runtime.connect('agent', connectionRecord())
  const chunks: UIMessageChunk[] = []
  for await (const chunk of runtime.prompt('agent', 'session-1', 'hello')) {
    chunks.push(chunk)
  }
  return chunks
}

describe('listRegisteredAcpMcpServers', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    removeHostMcpServer('nowledge-mem')
  })

  it('projects stdio MCP servers and skips streamable HTTP MCP servers', () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
      scope: 'chat-session',
    })
    addHostMcpServer({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://nowledge.example.test/mcp',
      headers: { Authorization: 'Bearer secret-token' },
    })

    expect(listRegisteredAcpMcpServers()).toEqual([])
    expect(listRegisteredAcpMcpServers('session-a')).toEqual([
      {
        name: 'browser-use',
        command: 'node',
        args: ['/plugins/browser-use/dist/mcp-server.mjs'],
        env: [
          { name: 'BROWSER_BACKEND_SOCKET', value: '/tmp/cradle-browser.sock' },
          { name: 'CRADLE_CHAT_SESSION_ID', value: 'session-a' },
        ],
      },
    ])
    expect(JSON.stringify(listRegisteredAcpMcpServers('session-a'))).not.toContain('secret-token')
  })
})

describe('acpConnectionManager', () => {
  it('discovers env auth without secrets, respawns once with resolved values, then authenticates', async () => {
    const authenticate = vi.fn()
    const initialize = vi.fn((_request: InitializeRequest) => ({
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{
        id: 'api-key',
        name: 'API key',
        type: 'env_var' as const,
        vars: [{ name: 'ACP_API_KEY' }],
      }],
    }))
    const host = new MemoryAcpProcessHost({ initialize, authenticate })
    const runtime = new AcpConnectionManager(host, {
      readSecret: ref => ref === 'credential-1' ? 'resolved-secret' : '',
    })

    await runtime.connect('agent', connectionRecord({
      env: JSON.stringify({ ACP_API_KEY: 'stale-launch-value' }),
      authMethodId: 'api-key',
      authSecretRefs: { ACP_API_KEY: 'credential-1' },
    }))

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(host.spawns).toHaveLength(2)
    expect(host.spawns[0]?.env).toEqual({})
    expect(host.spawns[1]?.env).toEqual({ ACP_API_KEY: 'resolved-secret' })
    expect(authenticate).toHaveBeenCalledWith(
      { methodId: 'api-key' },
      expect.objectContaining({ env: { ACP_API_KEY: 'resolved-secret' } }),
    )
    expect(JSON.stringify(runtime.getAuthMethods('agent'))).not.toContain('resolved-secret')
  })

  it('rejects a protocol version mismatch and cleans up the unpublished process', async () => {
    const host = new MemoryAcpProcessHost({
      initialize: async () => ({ protocolVersion: 999 as never }),
    })
    const runtime = new AcpConnectionManager(host)

    await expect(runtime.connect('agent', connectionRecord())).rejects.toThrow('protocol version mismatch')
    expect(runtime.isConnected('agent')).toBe(false)
    expect(host.stops).toContain('agent')
  })

  it('maps exact auth-required responses without matching error text', async () => {
    const host = new MemoryAcpProcessHost({
      initialize: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        authMethods: [{ id: 'login', name: 'Login' }],
      }),
      newSession: async () => {
        throw new RequestError(-32000, 'opaque')
      },
    })
    const runtime = new AcpConnectionManager(host)
    await runtime.connect('agent', connectionRecord())

    await expect(runtime.newSession('agent', '/workspace')).rejects.toMatchObject({
      providerError: {
        _tag: 'auth_required',
        methods: [expect.objectContaining({ id: 'login', kind: 'agent' })],
      },
    })
  })

  it('invalidates a connection when a prompt ignores cooperative cancellation', async () => {
    const cancel = vi.fn()
    const host = new MemoryAcpProcessHost({
      prompt: () => new Promise<PromptResponse>(() => {}),
      cancel,
    })
    const runtime = new AcpConnectionManager(host, {
      requestTimeouts: { promptMs: 20 },
    })
    await runtime.connect('agent', connectionRecord())

    const stream = runtime.prompt('agent', 'session-1', 'hang')
    await expect(stream.next()).rejects.toThrow('timed out after 20ms')
    expect(runtime.isConnected('agent')).toBe(false)
    expect(host.stops).toContain('agent')
    expect(cancel).toHaveBeenCalledWith('session-1')
  })

  it('rejects an overlapping prompt without replacing the active channel', async () => {
    const host = new MemoryAcpProcessHost({
      prompt: () => new Promise<PromptResponse>(() => {}),
    })
    const runtime = new AcpConnectionManager(host)
    await runtime.connect('agent', connectionRecord())

    const first = runtime.prompt('agent', 'session-1', 'first')
    const firstResult = first.next()
    const second = runtime.prompt('agent', 'session-1', 'second')
    await expect(second.next()).rejects.toBeInstanceOf(ProviderRuntimeError)
    await runtime.cancel('agent', 'session-1')
    await expect(firstResult).resolves.toMatchObject({ done: true })
  })

  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'length'],
    ['max_turn_requests', 'other'],
    ['refusal', 'content-filter'],
    ['cancelled', 'other'],
  ] as const)('maps %s to one %s finish chunk', async (stopReason, finishReason) => {
    const chunks = await collectPrompt(stopReason)
    expect(chunks.filter(chunk => chunk.type === 'finish')).toEqual([
      { type: 'finish', finishReason },
    ])
  })
})
