import { existsSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  AccountInfo,
  CanUseTool,
  SDKControlGetContextUsageResponse,
} from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../plugins/mcp-registry'
import { liveRuntimeSessionRegistry } from '../../chat-runtime/runtime-live-session-registry'
import type {
  ProviderSyntheticTurnEvent,
  ProviderThreadEvent,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  RuntimeToolApprovalRequest,
  RuntimeUserInputRequest,
} from '../../chat-runtime/runtime-provider-types'
import { ClaudeAgentProvider } from './provider'

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
  getSubagentMessages: vi.fn(),
  listSubagents: vi.fn(),
  renameSession: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdkMocks.query,
  getSessionInfo: sdkMocks.getSessionInfo,
  getSubagentMessages: sdkMocks.getSubagentMessages,
  listSubagents: sdkMocks.listSubagents,
  renameSession: sdkMocks.renameSession,
}))

function createAsyncQuery(
  items: unknown[],
  commands: Array<{
    name: string
    description: string
    argumentHint: string
    aliases?: string[]
  }> = [],
  account: AccountInfo = {},
) {
  let index = 0
  let done = false
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (done || index >= items.length) {
        return { done: true as const, value: undefined }
      }
      const value = items[index]
      index += 1
      return { done: false as const, value }
    },
    async return() {
      done = true
      return { done: true as const, value: undefined }
    },
    close: vi.fn(),
    interrupt: vi.fn(),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue(commands),
    getContextUsage: vi.fn().mockResolvedValue(createContextUsageResponse()),
    initializationResult: vi.fn().mockResolvedValue({
      commands,
      agents: [],
      output_style: 'default',
      available_output_styles: ['default'],
      models: [],
      account,
    }),
  }
}

function createPendingQuery(
  contextUsage: SDKControlGetContextUsageResponse = createContextUsageResponse(),
) {
  let resolveNext: (() => void) | null = null
  let closed = false
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (closed) {
        return { done: true as const, value: undefined }
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve
      })
      return { done: true as const, value: undefined }
    },
    async return() {
      closed = true
      resolveNext?.()
      return { done: true as const, value: undefined }
    },
    close: vi.fn(() => {
      closed = true
      resolveNext?.()
    }),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    getContextUsage: vi.fn().mockResolvedValue(contextUsage),
    initializationResult: vi.fn().mockResolvedValue({
      commands: [],
      agents: [],
      output_style: 'default',
      available_output_styles: ['default'],
      models: [],
      account: {},
    }),
  }
}

function createControllableQuery(
  contextUsage: SDKControlGetContextUsageResponse = createContextUsageResponse(),
) {
  const queue: unknown[] = []
  let resolveNext: ((result: IteratorResult<unknown>) => void) | null = null
  let closed = false

  const close = () => {
    closed = true
    resolveNext?.({ done: true as const, value: undefined })
    resolveNext = null
  }

  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (queue.length > 0) {
        return { done: false as const, value: queue.shift() }
      }
      if (closed) {
        return { done: true as const, value: undefined }
      }
      return await new Promise<IteratorResult<unknown>>((resolve) => {
        resolveNext = resolve
      })
    },
    async return() {
      close()
      return { done: true as const, value: undefined }
    },
    push(value: unknown) {
      if (closed) {
        return
      }
      if (resolveNext) {
        const resolve = resolveNext
        resolveNext = null
        resolve({ done: false as const, value })
        return
      }
      queue.push(value)
    },
    close: vi.fn(close),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    getContextUsage: vi.fn().mockResolvedValue(contextUsage),
    initializationResult: vi.fn().mockResolvedValue({
      commands: [],
      agents: [],
      output_style: 'default',
      available_output_styles: ['default'],
      models: [],
      account: {},
    }),
  }
}

function createPromptDrivenQuery(
  prompt: AsyncIterable<{ message: { content: unknown }, shouldQuery?: boolean }>,
  responsesByTurn: unknown[][],
  prompts: unknown[],
  inputMessages: unknown[] = [],
) {
  const promptIterator = prompt[Symbol.asyncIterator]()
  const responseQueue: unknown[] = []
  let turnIndex = 0
  let closed = false

  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (closed) {
        return { done: true as const, value: undefined }
      }
      while (responseQueue.length === 0) {
        const input = await promptIterator.next()
        if (closed || input.done) {
          return { done: true as const, value: undefined }
        }
        inputMessages.push(input.value)
        if (input.value.shouldQuery === false) {
          continue
        }
        prompts.push(input.value.message.content)
        responseQueue.push(...(responsesByTurn[turnIndex] ?? []))
        turnIndex += 1
      }
      const value = responseQueue.shift()
      if (value === undefined) {
        return { done: true as const, value: undefined }
      }
      return { done: false as const, value }
    },
    async return() {
      closed = true
      await promptIterator.return?.()
      return { done: true as const, value: undefined }
    },
    close: vi.fn(() => {
      closed = true
      void promptIterator.return?.()
    }),
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    getContextUsage: vi.fn().mockResolvedValue(createContextUsageResponse()),
    initializationResult: vi.fn().mockResolvedValue({
      commands: [],
      agents: [],
      output_style: 'default',
      available_output_styles: ['default'],
      models: [],
      account: {},
    }),
  }
}

function createContextUsageResponse(
  overrides: Partial<SDKControlGetContextUsageResponse> = {},
): SDKControlGetContextUsageResponse {
  return {
    categories: [
      { name: 'System prompt', tokens: 100, color: '#2563eb' },
      { name: 'Messages', tokens: 250, color: '#16a34a' },
      { name: 'Unclassified provider payload', tokens: 17, color: '#71717a' },
    ],
    totalTokens: 367,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 0.1835,
    gridRows: [],
    model: 'claude-sonnet-4-20250514',
    memoryFiles: [{ path: '/tmp/CLAUDE.md', type: 'project', tokens: 42 }],
    mcpTools: [{ name: 'search', serverName: 'browser', tokens: 11, isLoaded: true }],
    agents: [],
    isAutoCompactEnabled: true,
    messageBreakdown: {
      toolCallTokens: 7,
      toolResultTokens: 13,
      attachmentTokens: 0,
      assistantMessageTokens: 150,
      userMessageTokens: 100,
      redirectedContextTokens: 0,
      unattributedTokens: 5,
      toolCallsByType: [{ name: 'Read', callTokens: 3, resultTokens: 4 }],
      attachmentsByType: [],
    },
    apiUsage: {
      input_tokens: 367,
      output_tokens: 21,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...overrides,
  }
}

function readQueryOptions(callIndex: number): Record<string, unknown> {
  const call = sdkMocks.query.mock.calls[callIndex]?.[0] as
    | { options?: Record<string, unknown> }
    | undefined
  expect(call?.options).toBeDefined()
  return call!.options!
}

function requireCanUseTool(value: CanUseTool | null): CanUseTool {
  if (!value) {
    throw new Error('Claude Agent query options did not include canUseTool')
  }
  return value
}

function canUseToolOptions(
  options: Omit<Parameters<CanUseTool>[2], 'requestId' | 'signal'> & {
    signal?: AbortSignal
    requestId?: string
  },
): Parameters<CanUseTool>[2] {
  return {
    ...options,
    signal: options.signal ?? new AbortController().signal,
    requestId: options.requestId ?? `req_${options.toolUseID}`,
  }
}

async function readPromptText(callIndex: number): Promise<string> {
  const content = await readPromptContent(callIndex)
  return String(content)
}

async function readPromptContent(callIndex: number): Promise<unknown> {
  const call = sdkMocks.query.mock.calls[callIndex]?.[0] as
    | { prompt?: AsyncIterable<{ message: { content: unknown } }> }
    | undefined
  const prompt = call?.prompt
  expect(prompt).toBeDefined()
  const result = await prompt![Symbol.asyncIterator]().next()
  expect(result.done).toBe(false)
  return result.value.message.content
}

function createProfile(config: Record<string, unknown> = {}): RuntimeProviderTargetProfile {
  return {
    id: 'profile-claude',
    name: 'Claude Agent',
    providerKind: 'anthropic',
    enabled: true,
    configJson: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      permissionMode: 'bypassPermissions',
      ...config,
    }),
    credentialRef: 'credential-claude',
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: 'profile-claude',
  }
}

function createRuntimeSession(): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: 'profile-claude',
    runtimeKind: 'claude-agent',
    providerSessionId: null,
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: null },
    }),
  }
}

function createResumedRuntimeSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    ...createRuntimeSession(),
    providerSessionId: 'claude-session-1',
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: 'claude-sonnet-4-20250514' },
    }),
    ...overrides,
  }
}

function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function createBangCommandMessage(command: string): UIMessage {
  return {
    id: `bang-command-${command}`,
    role: 'user',
    parts: [{ type: 'text', text: `!${command}` }],
    metadata: {
      cradle: {
        bangCommand: { command },
      },
    },
  } as UIMessage
}

function createBangResultMessage(input: {
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  durationMs?: number
}): UIMessage {
  const text = input.stdout ?? input.stderr ?? ''
  return {
    id: `bang-result-${input.command}`,
    role: 'user',
    parts: [{ type: 'text', text }],
    metadata: {
      cradle: {
        bangResult: {
          command: input.command,
          stdout: input.stdout ?? '',
          stderr: input.stderr ?? '',
          exitCode: input.exitCode ?? 0,
          durationMs: input.durationMs ?? 1,
          timedOut: false,
          truncated: false,
        },
      },
    },
  } as UIMessage
}

describe.sequential('claudeAgentProvider MCP integration', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    removeHostMcpServer('nowledge-mem')
    sdkMocks.query.mockReset()
    sdkMocks.getSessionInfo.mockReset()
    sdkMocks.getSubagentMessages.mockReset()
    sdkMocks.listSubagents.mockReset()
    sdkMocks.renameSession.mockReset()
    liveRuntimeSessionRegistry.clear()
    vi.unstubAllEnvs()
  })

  it('passes plugin-registered browser-use MCP server config to the Claude Agent SDK', async () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-1',
          message: {
            content: [{ type: 'text', text: 'ready' }],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-1',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Open the browser'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text-delta', delta: 'ready' })]),
    )
    expect(sdkMocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.objectContaining({
          [Symbol.asyncIterator]: expect.any(Function),
        }),
        options: expect.objectContaining({
          mcpServers: expect.objectContaining({
            'browser-use': {
              type: 'stdio',
              command: 'node',
              args: ['/plugins/browser-use/dist/mcp-server.mjs'],
              env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
            },
          }),
        }),
      }),
    )
    await expect(readPromptText(0)).resolves.toBe('Open the browser')
  })

  it('passes plugin-registered streamable HTTP MCP server config to the Claude Agent SDK', async () => {
    addHostMcpServer({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://nowledge.example.test/mcp',
      headers: { Authorization: 'Bearer nowledge-secret' },
    })
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-http-mcp',
          message: {
            content: [{ type: 'text', text: 'ready' }],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-http-mcp',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-http-mcp-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Read Nowledge memory'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text-delta', delta: 'ready' })]),
    )
    expect(sdkMocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mcpServers: expect.objectContaining({
            'nowledge-mem': {
              type: 'http',
              url: 'https://nowledge.example.test/mcp',
              headers: { Authorization: 'Bearer nowledge-secret' },
            },
          }),
        }),
      }),
    )
  })

  it('defaults Claude Agent runs to bypass permissions and persists under Cradle runtime data', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-default-permissions',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-default-permissions',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ permissionMode: undefined }),
      message: createUserMessage('Use the default mode'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(
      expect.objectContaining({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: true,
        settingSources: [],
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: 'sk-ant-test',
          CLAUDE_CONFIG_DIR: join(process.env.CRADLE_DATA_DIR!, 'runtimes', 'claude-agent'),
        }),
      }),
    )
  })

  it('projects canonical Ultra to Claude SDK ultracode with xhigh effort', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-ultracode',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({ readSecret: () => 'sk-ant-test' })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-ultracode',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Use the highest orchestration mode'),
      providerOptions: { thinkingEffort: 'ultra' },
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(
      expect.objectContaining({
        effort: 'xhigh',
        settings: { effortLevel: 'xhigh', ultracode: true },
      }),
    )
  })

  it('starts restricted SDK modes from bypass permissions before syncing the desired mode', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-default-permissions',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-default-permissions',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Require approval'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'default' },
      },
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(expect.objectContaining({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    }))
    expect(activeQuery.setPermissionMode).toHaveBeenCalledWith('default')
  })

  it('passes Volcengine Anthropic credentials through ANTHROPIC_AUTH_TOKEN', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-auth-token',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'auth-token-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-auth-token',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({
        authMode: 'apiKey',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      }),
      message: createUserMessage('Use auth token mode'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    const env = readQueryOptions(0).env as Record<string, string | undefined>
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('auth-token-test')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://ark.cn-beijing.volces.com/api/coding')
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('lists Claude Agent subagent provider threads from SDK transcripts', async () => {
    sdkMocks.listSubagents.mockResolvedValue(['agent-a'])
    sdkMocks.getSubagentMessages.mockResolvedValue([
      {
        type: 'assistant',
        uuid: 'msg-subagent-1',
        session_id: 'claude-session-1',
        parent_tool_use_id: 'call_agent_1',
        timestamp: '2026-06-24T05:26:56.810Z',
        subagent_type: 'general-purpose',
        task_description: 'Inspect the runtime logs',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Subagent report' }],
        },
      },
    ])

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    await expect(
      provider.listProviderThreads({
        runtimeSession: createResumedRuntimeSession(),
        profile: createProfile(),
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/cradle-workspace',
      }),
    ).resolves.toMatchObject({
      runtimeKind: 'claude-agent',
      providerSessionId: 'claude-session-1',
      threads: [
        {
          id: 'call_agent_1',
          providerSessionTreeId: 'claude-session-1',
          forkedFromId: 'call_agent_1',
          preview: 'Subagent report',
          sourceKind: 'subAgent',
          source: expect.objectContaining({
            agentId: 'agent-a',
            parentToolUseId: 'call_agent_1',
          }),
          agentNickname: 'general-purpose',
          agentRole: 'Inspect the runtime logs',
          modelProvider: 'claude-sonnet-4-20250514',
        },
      ],
    })
    expect(sdkMocks.listSubagents).toHaveBeenCalledWith('claude-session-1', {
      dir: '/tmp/cradle-workspace',
    })
    expect(sdkMocks.getSubagentMessages).toHaveBeenCalledWith('claude-session-1', 'agent-a', {
      dir: '/tmp/cradle-workspace',
    })
  })

  it('reads Claude Agent subagent turns by parent tool-call id alias', async () => {
    sdkMocks.listSubagents.mockResolvedValue(['agent-a', 'agent-b'])
    sdkMocks.getSubagentMessages.mockImplementation(async (_sessionId: string, agentId: string) => {
      if (agentId === 'agent-a') {
        return [
          {
            type: 'assistant',
            uuid: 'msg-agent-a-1',
            session_id: 'claude-session-1',
            parent_tool_use_id: 'call_agent_1',
            timestamp: '2026-06-24T05:26:56.810Z',
            message: {
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [
                { type: 'thinking', thinking: 'Checking the trace.' },
                {
                  type: 'tool_use',
                  id: 'toolu_read_1',
                  name: 'Read',
                  input: { file_path: 'README.md' },
                },
                { type: 'text', text: 'Subagent report' },
              ],
            },
          },
          {
            type: 'user',
            uuid: 'msg-agent-a-tool-result',
            session_id: 'claude-session-1',
            parent_tool_use_id: 'call_agent_1',
            timestamp: '2026-06-24T05:27:00.810Z',
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'toolu_read_1',
                  content: 'Read complete',
                },
              ],
            },
          },
        ]
      }
      return [
        {
          type: 'assistant',
          uuid: 'msg-agent-b-1',
          session_id: 'claude-session-1',
          parent_tool_use_id: 'call_agent_2',
          timestamp: '2026-06-24T05:27:56.810Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Other report' }],
          },
        },
      ]
    })

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createResumedRuntimeSession()

    await expect(
      provider.readProviderThread({
        runtimeSession,
        profile: createProfile(),
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/cradle-workspace',
        threadId: 'call_agent_1',
      }),
    ).resolves.toMatchObject({
      runtimeKind: 'claude-agent',
      providerSessionId: 'claude-session-1',
      thread: {
        id: 'call_agent_1',
        forkedFromId: 'call_agent_1',
        preview: 'Checking the trace.\nSubagent report',
        source: expect.objectContaining({
          agentId: 'agent-a',
          parentToolUseId: 'call_agent_1',
        }),
      },
    })

    const turnsResult = await provider.listProviderThreadTurns({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
      threadId: 'call_agent_1',
      sortDirection: 'asc',
    })

    expect(turnsResult.turns).toHaveLength(1)
    expect(turnsResult.messages).toHaveLength(1)
    expect(turnsResult).toMatchObject({
      runtimeKind: 'claude-agent',
      providerSessionId: 'claude-session-1',
      threadId: 'call_agent_1',
      turns: [
        {
          id: 'msg-agent-a-1',
          status: 'completed',
          itemsView: 'full',
          items: [
            expect.objectContaining({
              message: expect.objectContaining({ uuid: 'msg-agent-a-1' }),
            }),
            expect.objectContaining({
              message: expect.objectContaining({ uuid: 'msg-agent-a-tool-result' }),
            }),
          ],
        },
      ],
      messages: [
        {
          id: 'provider-thread:call_agent_1:message:msg-agent-a-1',
          role: 'assistant',
          metadata: expect.objectContaining({
            providerThreadId: 'call_agent_1',
            agentId: 'agent-a',
            parentToolUseId: 'call_agent_1',
          }),
          parts: [
            { type: 'reasoning', text: 'Checking the trace.', state: 'done' },
            {
              type: 'tool-Read',
              toolCallId: 'toolu_read_1',
              state: 'output-available',
              input: {
                type: 'cradle.builtin-tool-call.input.v1',
                identifier: 'claude-code',
                apiName: 'Read',
                args: { file_path: 'README.md' },
              },
              output: {
                type: 'cradle.builtin-tool-call.result.v1',
                identifier: 'claude-code',
                apiName: 'Read',
                args: { file_path: 'README.md' },
                result: 'Read complete',
              },
            },
            { type: 'text', text: 'Subagent report', state: 'done' },
          ],
        },
      ],
    })
  })

  it('keeps a subagent launch prompt visible in its transcript after it starts producing output', async () => {
    // Regression test: the launch prompt (`task_description`) used to only surface via the
    // transient "[agent started]" stream announcement. Once the subagent produced its own
    // messages, that announcement scrolled away and the prompt disappeared from history.
    sdkMocks.listSubagents.mockResolvedValue(['agent-prompt'])
    sdkMocks.getSubagentMessages.mockResolvedValue([
      {
        type: 'assistant',
        uuid: 'msg-agent-prompt-1',
        session_id: 'claude-session-1',
        parent_tool_use_id: 'call_agent_prompt',
        timestamp: '2026-06-24T05:26:56.810Z',
        subagent_type: 'general-purpose',
        task_description: 'Investigate the failing build',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Build investigation report' }],
        },
      },
    ])

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const turnsResult = await provider.listProviderThreadTurns({
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
      threadId: 'call_agent_prompt',
      sortDirection: 'asc',
    })

    expect(turnsResult.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        parts: [{ type: 'text', text: 'Investigate the failing build', state: 'done' }],
        metadata: expect.objectContaining({ synthetic: 'launch-prompt' }),
      }),
      expect.objectContaining({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Build investigation report', state: 'done' }],
      }),
    ])
  })

  it('merges a tool_use and its tool_result within the same subagent session message', async () => {
    // Regression test: Claude Code session transcripts can bundle a tool_use block and its
    // matching tool_result in the very same session message (unlike raw Anthropic API turns,
    // which always split them across messages). Without an in-message merge pass, this rendered
    // as two separate blocks for the same tool call — one input-available, one output-available.
    sdkMocks.listSubagents.mockResolvedValue(['agent-dedup'])
    sdkMocks.getSubagentMessages.mockResolvedValue([
      {
        type: 'assistant',
        uuid: 'msg-agent-dedup-1',
        session_id: 'claude-session-1',
        parent_tool_use_id: 'call_agent_dedup',
        timestamp: '2026-06-24T05:26:56.810Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_dedup_1', name: 'Bash', input: { command: 'pwd' } },
            { type: 'tool_result', tool_use_id: 'toolu_dedup_1', content: '/workspace' },
            { type: 'text', text: 'Ran pwd successfully' },
          ],
        },
      },
    ])

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const turnsResult = await provider.listProviderThreadTurns({
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
      threadId: 'call_agent_dedup',
      sortDirection: 'asc',
    })

    expect(turnsResult.messages).toHaveLength(1)
    const toolParts = turnsResult.messages[0]!.parts.filter(part => part.type === 'tool-Bash')
    expect(toolParts).toHaveLength(1)
    expect(toolParts[0]).toEqual(
      expect.objectContaining({
        toolCallId: 'toolu_dedup_1',
        state: 'output-available',
      }),
    )
  })

  it('requires an API key in Claude Agent API key auth mode', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => '',
    })

    await expect(async () => {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-missing-api-key',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: createUserMessage('Use the API key mode'),
        workspaceId: 'workspace-1',
      })) {
        // Drain stream.
      }
    }).rejects.toThrow('claude-agent authentication failed')
    expect(sdkMocks.query).not.toHaveBeenCalled()
  })

  it('uses Claude.ai auth mode without requiring an Anthropic API key or inheriting Anthropic auth env', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'ambient-api-key')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'ambient-auth-token')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://ambient-anthropic.example.test')
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(process.env.CRADLE_DATA_DIR!, 'runtimes', 'claude-agent'))
    sdkMocks.query.mockReturnValue(
      createAsyncQuery(
        [
          {
            type: 'auth_status',
            isAuthenticating: false,
            output: ['Authenticated with Claude.ai'],
            uuid: '00000000-0000-4000-8000-000000000001',
            session_id: 'claude-session-official',
          },
          {
            type: 'rate_limit_event',
            rate_limit_info: {
              status: 'allowed_warning',
              rateLimitType: 'five_hour',
              utilization: 72,
              resetsAt: 1_797_000_000,
            },
            uuid: '00000000-0000-4000-8000-000000000002',
            session_id: 'claude-session-official',
          },
          {
            type: 'result',
            session_id: 'claude-session-official',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        ],
        [],
        {
          email: 'user@example.test',
          subscriptionType: 'max',
          tokenSource: 'oauth',
          apiProvider: 'firstParty',
        },
      ),
    )

    const runtimeSession = createRuntimeSession()
    const provider = new ClaudeAgentProvider({
      readSecret: () => {
        throw new Error('Claude.ai auth mode must not read API key credentials')
      },
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-official-auth',
      runtimeSession,
      profile: createProfile({
        authMode: 'claudeAi',
        apiKey: undefined,
        baseUrl: 'https://configured-anthropic.example.test',
      }),
      message: createUserMessage('Use Claude official auth'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    const options = readQueryOptions(0)
    expect(options).toEqual(
      expect.objectContaining({
        persistSession: false,
        settingSources: ['user', 'project', 'local'],
        managedSettings: expect.objectContaining({
          forceLoginMethod: 'claudeai',
        }),
      }),
    )
    const env = options.env as Record<string, string | undefined>
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')

    await vi.waitFor(() => {
      expect(runtimeSession.providerStateSnapshot).toContain('"subscriptionType":"max"')
    })
    expect(runtimeSession.providerSessionId).toBeNull()
    expect(runtimeSession.providerStateSnapshot).toContain('"authStatus"')
    expect(runtimeSession.providerStateSnapshot).toContain('"rateLimit"')

    const states = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile({ authMode: 'claudeAi' }),
      workspacePath: '/tmp/cradle-workspace',
      workspaceId: 'workspace-1',
    })
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'usage',
          slotId: 'claude-agent:usage',
          planType: 'max',
          limitName: 'five_hour',
          usedPercent: 72,
          primaryResetsAt: 1_797_000_000,
        }),
      ]),
    )
  })

  it('projects SDK permission denials into the Claude alerts UI slot', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'system',
          subtype: 'permission_denied',
          tool_name: 'Bash',
          tool_use_id: 'toolu_denied_1',
          decision_reason_type: 'mode',
          decision_reason: 'Shell commands are disabled in plan mode.',
          message: 'Permission denied.',
          uuid: '00000000-0000-4000-8000-000000000003',
          session_id: 'claude-session-denied',
        },
        {
          type: 'result',
          session_id: 'claude-session-denied',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const runtimeSession = createRuntimeSession()
    const provider = new ClaudeAgentProvider({ readSecret: () => 'sk-ant-test' })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-denied',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Run a shell command'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    const states = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
      workspaceId: 'workspace-1',
    })
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'alert',
          slotId: 'claude-agent:alerts',
          warningCount: 1,
          errorCount: 0,
          recentItems: [
            expect.objectContaining({
              id: 'permission-denied:toolu_denied_1',
              severity: 'warning',
              message: 'Shell commands are disabled in plan mode.',
              source: 'Claude Bash',
            }),
          ],
        }),
      ]),
    )
  })

  it('leaves Claude disallowed tools empty and captures ExitPlanMode through Cradle', async () => {
    const requestToolApproval = vi.fn()
    const activeQuery = createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-plan-permission',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
      requestToolApproval,
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-plan-permission',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Plan the work'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'plan' },
      },
    })) {
      // Drain stream.
    }

    const options = readQueryOptions(0)
    expect(options).toEqual(expect.objectContaining({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: false,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
    }))
    expect(activeQuery.setPermissionMode).toHaveBeenCalledWith('plan')
    expect(options.disallowedTools).toEqual([])
    expect(options.disallowedTools).not.toContain('AskUserQuestion')
    expect(options.disallowedTools).not.toContain('EnterPlanMode')
    expect(options.disallowedTools).not.toContain('ExitPlanMode')
    // ExitPlanMode is the provider-owned signal that a proposed plan is ready.
    // Cradle captures it into the plan slot and denies the native exit action so
    // Chat Runtime settings remain the interaction-mode owner.
    await expect(
      (options.canUseTool as CanUseTool)(
        'ExitPlanMode',
        { plan: '1. Inspect\n2. Patch' },
        canUseToolOptions({
          toolUseID: 'toolu_plan_1',
        }),
      ),
    ).resolves.toEqual({
      behavior: 'deny',
      message:
        'Cradle captured the proposed plan. Stop here and wait for the user to refine or implement it in a later turn.',
    })
    // Ordinary implementation tools fail closed while Cradle's interaction mode is still plan.
    await expect(
      (options.canUseTool as CanUseTool)(
        'Bash',
        { command: 'echo hi' },
        canUseToolOptions({
          toolUseID: 'toolu_bash_1',
        }),
      ),
    ).resolves.toEqual({
      behavior: 'deny',
      message:
        'Cradle is in plan mode. Submit or revise the plan before running implementation tools.',
    })
    expect(requestToolApproval).not.toHaveBeenCalled()
  })

  it('resumes the provider session in plan mode to preserve prompt cache continuity', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-plan-resume',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-plan-resume',
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Continue planning'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'plan' },
      },
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(expect.objectContaining({
      resume: 'claude-session-1',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: false,
    }))
    expect(activeQuery.setPermissionMode).toHaveBeenCalledWith('plan')
  })

  it('routes AskUserQuestion through requestUserInput regardless of plan mode', async () => {
    const requestUserInput = vi.fn(async (request: RuntimeUserInputRequest) => ({
      requestId: request.providerRequestId,
      answers: { 'question-1': ['Implement now'] },
    }))
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-plan-question',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
      requestUserInput,
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-plan-question',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Plan the work and ask before implementing'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'plan' },
      },
    })) {
      // Drain stream.
    }

    const options = readQueryOptions(0)
    // AskUserQuestion stays interactive even while ordinary implementation tools fail closed in plan mode.
    await expect(
      (options.canUseTool as CanUseTool)(
        'AskUserQuestion',
        {
          questions: [
            {
              question: 'Should I implement this plan?',
              header: 'Decision',
              options: [
                { label: 'Implement now', description: 'Start editing files.' },
                { label: 'Revise plan', description: 'Keep planning.' },
              ],
              multiSelect: false,
            },
          ],
        },
        canUseToolOptions({
          toolUseID: 'toolu_question_plan_1',
        }),
      ),
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: expect.any(Object),
    })
    expect(requestUserInput).toHaveBeenCalled()
  })

  it('returns an explicit allow decision for non-user-input permission requests', async () => {
    const requestUserInput = vi.fn()
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-default-tool-permission',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
      requestUserInput,
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-default-tool-permission',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Run a command'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'bypassPermissions' },
      },
    })) {
      // Drain stream.
    }

    const toolInput = { command: 'pwd' }
    const options = readQueryOptions(0)
    await expect(
      (options.canUseTool as CanUseTool)(
        'Bash',
        toolInput,
        canUseToolOptions({
          toolUseID: 'toolu_bash_1',
        }),
      ),
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: toolInput,
    })
    expect(requestUserInput).not.toHaveBeenCalled()
  })

  it('auto-allows ordinary Claude Agent permission requests while SDK runs in bypass mode', async () => {
    const activeQuery = createPendingQuery()
    const requestToolApproval = vi.fn()
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
      requestToolApproval,
    })
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-tool-approval',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Run a command'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'bypassPermissions' },
      },
    })
    const pendingNext = stream.next()
    void pendingNext.catch(() => undefined)

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    const toolInput = { command: 'rm -rf build' }
    const options = readQueryOptions(0)
    await expect(
      (options.canUseTool as CanUseTool)(
        'Bash',
        toolInput,
        canUseToolOptions({
          toolUseID: 'toolu_bash_approval',
          title: 'Claude wants to run rm -rf build',
          displayName: 'Run command',
          description: 'Claude will run a shell command in the workspace.',
        }),
      ),
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: toolInput,
    })
    expect(requestToolApproval).not.toHaveBeenCalled()

    activeQuery.close()
    await expect(pendingNext).resolves.toEqual({
      done: true,
      value: undefined,
    })
  })

  it('updates active bridge runtime settings and syncs SDK plan permission mode', async () => {
    const activeQuery = createPendingQuery()
    const permissionError = new Error('Cannot set permission mode to bypassPermissions')
    activeQuery.setPermissionMode.mockImplementation(async (mode: string) => {
      if (mode === 'bypassPermissions') {
        throw permissionError
      }
    })
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-permission-update-failure',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Implement the change'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'bypassPermissions' },
      },
    })
    const pendingNext = stream.next()
    void pendingNext.catch(() => undefined)

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    const options = readQueryOptions(0)

    await expect(
      provider.updateRuntimeSettings({
        runtimeSession,
        profile: createProfile(),
        settings: { permissionMode: 'plan' },
      }),
    ).resolves.toBeUndefined()
    expect(activeQuery.setPermissionMode).toHaveBeenCalledWith('plan')

    await expect(
      (options.canUseTool as CanUseTool)(
        'Bash',
        { command: 'echo should wait' },
        canUseToolOptions({
          toolUseID: 'toolu_bridge_plan_1',
        }),
      ),
    ).resolves.toEqual({
      behavior: 'deny',
      message:
        'Cradle is in plan mode. Submit or revise the plan before running implementation tools.',
    })

    activeQuery.close()
    await pendingNext
  })

  it('registers active queries for idle runtime settings propagation', async () => {
    const activeQuery = createPendingQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-live-registry',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Keep query alive'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'plan' },
      },
    })
    const pendingNext = stream.next()

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    const liveRuntimeSession = liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)
    expect(liveRuntimeSession).toBeDefined()
    expect(liveRuntimeSession?.readRuntimeSession()).toBe(runtimeSession)

    await liveRuntimeSession!.updateRuntimeSettings({
      permissionMode: 'bypassPermissions',
    })

    expect(activeQuery.setPermissionMode).toHaveBeenCalledWith('bypassPermissions')

    activeQuery.close()
    await pendingNext
    expect(liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)).toBeUndefined()
  })

  it('resyncs reused canUseTool callback when approval mode changes on a live query', async () => {
    const prompts: unknown[] = []
    let activeQuery: ReturnType<typeof createPromptDrivenQuery> | null = null
    sdkMocks.query.mockImplementation(
      (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
        expect(call.prompt).toBeDefined()
        activeQuery = createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'result',
                session_id: 'claude-session-reused-permissions',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
            [
              {
                type: 'result',
                session_id: 'claude-session-reused-permissions',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
          ],
          prompts,
        )
        return activeQuery
      },
    )
    const readActiveQuery = (): ReturnType<typeof createPromptDrivenQuery> => {
      expect(activeQuery).not.toBeNull()
      return activeQuery!
    }

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()

    try {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-reused-plan',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Start in plan mode'),
        workspaceId: 'workspace-1',
        providerOptions: {
          runtimeSettings: { permissionMode: 'plan' },
        },
      })) {
        // Drain stream.
      }

      expect(readQueryOptions(0)).toEqual(expect.objectContaining({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: false,
      }))
      const originalCanUseTool = readQueryOptions(0).canUseTool as CanUseTool
      expect(readActiveQuery().setPermissionMode).toHaveBeenCalledWith('plan')

      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-reused-default',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Implement now'),
        workspaceId: 'workspace-1',
        providerOptions: {
          runtimeSettings: { permissionMode: 'bypassPermissions' },
        },
      })) {
        // Drain stream.
      }

      expect(sdkMocks.query).toHaveBeenCalledOnce()
      expect(readActiveQuery().setPermissionMode).toHaveBeenCalledWith('bypassPermissions')
      await expect(
        originalCanUseTool(
          'Bash',
          { command: 'echo now allowed' },
          canUseToolOptions({
            toolUseID: 'toolu_reused_now_allowed',
          }),
        ),
      ).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { command: 'echo now allowed' },
      })
      expect(prompts).toEqual(['Start in plan mode', 'Implement now'])
    }
 finally {
      await provider.dispose()
    }
  })

  it('appends Work harness context once as a synthetic non-query message', async () => {
    const prompts: unknown[] = []
    const inputMessages: Array<{
      isSynthetic?: boolean
      shouldQuery?: boolean
      message: { content: unknown }
    }> = []
    sdkMocks.query.mockImplementation(
      (call: {
        prompt?: AsyncIterable<{
          isSynthetic?: boolean
          shouldQuery?: boolean
          message: { content: unknown }
        }>
      }) => {
        expect(call.prompt).toBeDefined()
        return createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'result',
                session_id: 'claude-session-harness',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
            [
              {
                type: 'result',
                session_id: 'claude-session-harness',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
          ],
          prompts,
          inputMessages,
        )
      },
    )

    const provider = new ClaudeAgentProvider({ readSecret: () => 'sk-ant-test' })
    const runtimeSession = createRuntimeSession()
    const harness = {
      fragments: [
        {
          key: 'cradle-work',
          revision: 'cradle-work:work-1:primary:v1',
          content:
            '<cradle_work_state>\nwork_id: work-1\nthread_role: primary\n</cradle_work_state>',
        },
      ],
    }

    try {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-harness-1',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Implement the Work objective'),
        harness,
        workspaceId: 'workspace-1',
      })) {
        // Drain stream.
      }

      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-harness-2',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Continue'),
        harness,
        workspaceId: 'workspace-1',
      })) {
        // Drain stream.
      }

      expect(inputMessages).toHaveLength(3)
      expect(inputMessages[0]).toEqual(
        expect.objectContaining({
          isSynthetic: true,
          shouldQuery: false,
          message: expect.objectContaining({
            content:
              '<cradle_work_state>\nwork_id: work-1\nthread_role: primary\n</cradle_work_state>',
          }),
        }),
      )
      expect(prompts).toEqual(['Implement the Work objective', 'Continue'])
      expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
        harness: {
          providerSessionId: 'claude-session-harness',
          revisions: { 'cradle-work': 'cradle-work:work-1:primary:v1' },
        },
      })
    }
 finally {
      await provider.dispose()
    }
  })

  it('reinjects Work harness context after a Claude compact boundary', async () => {
    const prompts: unknown[] = []
    const inputMessages: Array<{
      isSynthetic?: boolean
      shouldQuery?: boolean
      message: { content: unknown }
    }> = []
    sdkMocks.query.mockImplementation(
      (call: {
        prompt?: AsyncIterable<{
          isSynthetic?: boolean
          shouldQuery?: boolean
          message: { content: unknown }
        }>
      }) => {
        expect(call.prompt).toBeDefined()
        return createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'system',
                subtype: 'compact_boundary',
                compact_metadata: {
                  trigger: 'auto',
                  pre_tokens: 180_000,
                  post_tokens: 24_000,
                },
                uuid: 'compact-boundary-1',
                session_id: 'claude-session-harness-compact',
              },
              {
                type: 'result',
                session_id: 'claude-session-harness-compact',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
            [
              {
                type: 'result',
                session_id: 'claude-session-harness-compact',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
          ],
          prompts,
          inputMessages,
        )
      },
    )

    const provider = new ClaudeAgentProvider({ readSecret: () => 'sk-ant-test' })
    const runtimeSession = createRuntimeSession()
    const harness = {
      fragments: [
        {
          key: 'cradle-work',
          revision: 'cradle-work:work-1:primary:v1',
          content:
            '<cradle_work_state>\nwork_id: work-1\nthread_role: primary\n</cradle_work_state>',
        },
      ],
    }

    try {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-harness-before-compact',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Implement the Work objective'),
        harness,
        workspaceId: 'workspace-1',
      })) {
        // Drain stream.
      }

      expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
        harness: {
          providerSessionId: 'claude-session-harness-compact',
          revisions: {},
        },
      })

      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-harness-after-compact',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Continue after compaction'),
        harness,
        workspaceId: 'workspace-1',
      })) {
        // Drain stream.
      }

      expect(inputMessages).toHaveLength(4)
      expect(inputMessages[0]).toEqual(
        expect.objectContaining({
          isSynthetic: true,
          shouldQuery: false,
        }),
      )
      expect(inputMessages[2]).toEqual(
        expect.objectContaining({
          isSynthetic: true,
          shouldQuery: false,
          message: inputMessages[0]?.message,
        }),
      )
      expect(prompts).toEqual(['Implement the Work objective', 'Continue after compaction'])
      expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
        harness: {
          providerSessionId: 'claude-session-harness-compact',
          revisions: { 'cradle-work': 'cradle-work:work-1:primary:v1' },
        },
      })
    }
 finally {
      await provider.dispose()
    }
  })

  it('clears Claude SDK ultracode when a live session leaves Ultra', async () => {
    const prompts: unknown[] = []
    let activeQuery: ReturnType<typeof createPromptDrivenQuery> | null = null
    sdkMocks.query.mockImplementation(
      (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
        expect(call.prompt).toBeDefined()
        activeQuery = createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'result',
                session_id: 'claude-session-ultracode-live',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
            [
              {
                type: 'result',
                session_id: 'claude-session-ultracode-live',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
          ],
          prompts,
        )
        return activeQuery
      },
    )
    const provider = new ClaudeAgentProvider({ readSecret: () => 'sk-ant-test' })
    const runtimeSession = createRuntimeSession()
    const readActiveQuery = (): ReturnType<typeof createPromptDrivenQuery> => {
      expect(activeQuery).not.toBeNull()
      return activeQuery!
    }

    try {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-ultracode-live',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Start in Ultra'),
        providerOptions: { thinkingEffort: 'ultra' },
        workspaceId: 'workspace-1',
      })) {
        // Drain stream.
      }

      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-standard-live',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Return to standard reasoning'),
        providerOptions: { thinkingEffort: 'high' },
        workspaceId: 'workspace-1',
      })) {
        // Drain stream.
      }

      expect(sdkMocks.query).toHaveBeenCalledOnce()
      expect(readActiveQuery().applyFlagSettings).toHaveBeenCalledWith({
        effortLevel: null,
        ultracode: false,
      })
      expect(prompts).toEqual(['Start in Ultra', 'Return to standard reasoning'])
    }
 finally {
      await provider.dispose()
    }
  })

  it('routes approval-required tools through Cradle when permission mode changes on a live query', async () => {
    const prompts: unknown[] = []
    let activeQuery: ReturnType<typeof createPromptDrivenQuery> | null = null
    sdkMocks.query.mockImplementation(
      (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
        expect(call.prompt).toBeDefined()
        activeQuery = createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'result',
                session_id: 'claude-session-reused-approval',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
            [
              {
                type: 'result',
                session_id: 'claude-session-reused-approval',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
          ],
          prompts,
        )
        return activeQuery
      },
    )
    const readActiveQuery = (): ReturnType<typeof createPromptDrivenQuery> => {
      expect(activeQuery).not.toBeNull()
      return activeQuery!
    }
    const requestToolApproval = vi.fn(async (request: RuntimeToolApprovalRequest) => ({
      requestId: request.providerRequestId,
      approved: true,
    }))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
      requestToolApproval,
    })
    const runtimeSession = createRuntimeSession()

    try {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-reused-bypass',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Start with full access'),
        workspaceId: 'workspace-1',
        providerOptions: {
          runtimeSettings: { permissionMode: 'bypassPermissions' },
        },
      })) {
        // Drain stream.
      }

      expect(readQueryOptions(0)).toEqual(
        expect.objectContaining({
          permissionMode: 'bypassPermissions',
        }),
      )
      const originalCanUseTool = readQueryOptions(0).canUseTool as CanUseTool

      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-reused-approval',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Now require approval'),
        workspaceId: 'workspace-1',
        providerOptions: {
          runtimeSettings: { permissionMode: 'default' },
        },
      })) {
        // Drain stream.
      }

      expect(sdkMocks.query).toHaveBeenCalledOnce()
      expect(readActiveQuery().setPermissionMode).toHaveBeenCalledWith('default')
      await expect(
        originalCanUseTool(
          'Bash',
          { command: 'pwd' },
          canUseToolOptions({
            toolUseID: 'toolu_reused_requires_approval',
          }),
        ),
      ).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { command: 'pwd' },
      })
      expect(requestToolApproval).toHaveBeenCalledOnce()
      expect(prompts).toEqual(['Start with full access', 'Now require approval'])
    }
 finally {
      await provider.dispose()
    }
  })

  it('projects captured ExitPlanMode plans into composer UI slot state', async () => {
    const plan = '1. Inspect\n2. Patch\n3. Verify'
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-plan-slot',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_plan_1',
                name: 'ExitPlanMode',
                input: { plan },
              },
            ],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-plan-slot',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-plan-slot',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Plan the work'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { permissionMode: 'plan' },
      },
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([
        {
          type: 'tool-approval-request',
          toolCallId: 'implement-plan:toolu_plan_1',
          approvalId: 'implement-plan:toolu_plan_1',
        },
      ]),
    )
    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent.plan).toEqual(
      expect.objectContaining({
        threadId: 'chat-session-1',
        turnId: 'toolu_plan_1',
        content: plan,
        steps: [
          { step: '1. Inspect', status: 'pending' },
          { step: '2. Patch', status: 'pending' },
          { step: '3. Verify', status: 'pending' },
        ],
        updatedAt: expect.any(Number),
      }),
    )

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(slotStates).toEqual([
      expect.objectContaining({
        kind: 'plan',
        slotId: 'claude-agent:plan',
        threadId: 'chat-session-1',
        turnId: 'toolu_plan_1',
        content: plan,
        currentStep: '1. Inspect',
        pendingCount: 3,
        inProgressCount: 0,
        completedCount: 0,
      }),
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
      }),
    ])
  })

  it('writes Cradle interaction mode when Claude requests EnterPlanMode', async () => {
    const activeQuery = createControllableQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const updateSessionRuntimeSettings = vi.fn().mockResolvedValue(undefined)
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
      updateSessionRuntimeSettings,
    })

    const stream = provider.streamTurn({
      runId: 'run-claude-agent-enter-plan',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Plan first'),
      workspaceId: 'workspace-1',
    })
    const pendingNext = stream.next()
    void pendingNext.catch(() => undefined)

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    activeQuery.push({
      type: 'assistant',
      session_id: 'claude-session-enter-plan',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_enter_plan_1',
            name: 'EnterPlanMode',
          },
        ],
      },
    })
    activeQuery.push({
      type: 'result',
      session_id: 'claude-session-enter-plan',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    activeQuery.close()
    for await (const _chunk of stream) {
      // Drain stream.
    }

    expect(updateSessionRuntimeSettings).toHaveBeenCalledWith({
      sessionId: 'chat-session-1',
      patch: { permissionMode: 'plan' },
    })
    expect(activeQuery.setPermissionMode).toHaveBeenCalledWith('plan')
  })

  it('projects captured TodoWrite state into progress UI slot state', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-progress-slot',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_todo_1',
                name: 'TodoWrite',
                input: {
                  todos: [
                    { id: 'todo-1', content: 'Inspect', status: 'pending' },
                    {
                      id: 'todo-2',
                      content: 'Patch',
                      activeForm: 'Patching',
                      status: 'in_progress',
                    },
                    { id: 'todo-3', content: 'Verify', status: 'completed' },
                  ],
                },
              },
            ],
          },
        },
        {
          type: 'user',
          session_id: 'claude-session-progress-slot',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_todo_1',
                content: { ok: true },
              },
            ],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-progress-slot',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-progress-slot',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Work through todos'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent.progress).toEqual(
      expect.objectContaining({
        threadId: 'chat-session-1',
        turnId: 'toolu_todo_1',
        source: 'TodoWrite',
        items: [
          { id: 'todo-1', content: 'Inspect', status: 'todo', sourceStatus: 'pending' },
          { id: 'todo-2', content: 'Patching', status: 'processing', sourceStatus: 'in_progress' },
          { id: 'todo-3', content: 'Verify', status: 'completed', sourceStatus: 'completed' },
        ],
        updatedAt: expect.any(Number),
      }),
    )

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(slotStates).toEqual([
      expect.objectContaining({
        kind: 'progress',
        slotId: 'claude-agent:progress',
        threadId: 'chat-session-1',
        turnId: 'toolu_todo_1',
        source: 'TodoWrite',
        currentItem: 'Patching',
        pendingCount: 1,
        inProgressCount: 1,
        completedCount: 1,
        items: [
          { id: 'todo-1', label: 'Inspect', status: 'pending', sourceStatus: 'pending' },
          { id: 'todo-2', label: 'Patching', status: 'inProgress', sourceStatus: 'in_progress' },
          { id: 'todo-3', label: 'Verify', status: 'completed', sourceStatus: 'completed' },
        ],
      }),
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
      }),
    ])
  })

  it('projects Claude Agent tool description and subagent type into crew UI slot state', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-crew-slot',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_agent_1',
                name: 'Agent',
                input: {
                  description: 'Explore landing page changelog',
                  prompt: 'Read four files and report the structure.',
                  subagent_type: 'Explore',
                  model: 'sonnet',
                },
              },
            ],
          },
        },
        {
          type: 'user',
          session_id: 'claude-session-crew-slot',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_agent_1',
                content: 'Report complete',
              },
            ],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-crew-slot',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-crew-slot',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Use a subagent'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent.crewCalls).toEqual([
      expect.objectContaining({
        id: 'toolu_agent_1',
        tool: 'Agent',
        prompt: 'Read four files and report the structure.',
        description: 'Explore landing page changelog',
        subagentType: 'Explore',
        model: 'sonnet',
        status: 'completed',
        completedAt: expect.any(Number),
      }),
    ])

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'crew',
          activeCount: 0,
          completedCount: 1,
          failedCount: 0,
          agents: [
            expect.objectContaining({
              threadId: 'toolu_agent_1',
              status: 'completed',
              agentNickname: 'Explore',
              agentRole: 'Explore landing page changelog',
            }),
          ],
          calls: [
            expect.objectContaining({
              id: 'toolu_agent_1',
              prompt: 'Explore landing page changelog',
              model: 'sonnet',
              receiverThreadIds: ['toolu_agent_1'],
              agents: [
                expect.objectContaining({
                  threadId: 'toolu_agent_1',
                  status: 'completed',
                }),
              ],
            }),
          ],
        }),
      ]),
    )
  })

  it('keeps Workflow task ids out of provider-thread crew projections', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'system',
          subtype: 'task_started',
          session_id: 'claude-session-workflow-slot',
          uuid: 'workflow-task-started-1',
          task_id: 'wciccg1br',
          tool_use_id: 'toolu_workflow_1',
          task_type: 'local_workflow',
          workflow_name: 'Run workflow',
          description: 'Run release workflow',
          prompt: 'Execute workflow.py',
        },
        {
          type: 'system',
          subtype: 'task_notification',
          session_id: 'claude-session-workflow-slot',
          uuid: 'workflow-task-notification-1',
          task_id: 'wciccg1br',
          status: 'completed',
          summary: 'Workflow complete',
        },
        {
          type: 'result',
          session_id: 'claude-session-workflow-slot',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-workflow-slot',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Run workflow'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'crew',
          activeCount: 0,
          completedCount: 1,
          failedCount: 0,
          agents: [],
          calls: [
            expect.objectContaining({
              id: 'toolu_workflow_1',
              tool: 'Workflow',
              status: 'completed',
              receiverThreadIds: [],
              agents: [],
            }),
          ],
        }),
      ]),
    )
  })

  it('projects structured Task state into progress UI slot state', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-task-progress',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_task_create_1',
                name: 'TaskCreate',
                input: {
                  subject: 'Map modules',
                  description: 'List user-facing modules',
                  activeForm: 'Mapping modules',
                },
              },
            ],
          },
        },
        {
          type: 'user',
          session_id: 'claude-session-task-progress',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_task_create_1',
                content: 'Task #1 created successfully: Map modules',
              },
            ],
          },
          tool_use_result: {
            task: { id: '1', subject: 'Map modules' },
          },
        },
        {
          type: 'assistant',
          session_id: 'claude-session-task-progress',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_task_update_1',
                name: 'TaskUpdate',
                input: {
                  taskId: '1',
                  status: 'in_progress',
                },
              },
            ],
          },
        },
        {
          type: 'user',
          session_id: 'claude-session-task-progress',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_task_update_1',
                content: 'Updated task #1 status',
              },
            ],
          },
          tool_use_result: {
            success: true,
            taskId: '1',
            updatedFields: ['status'],
            statusChange: { from: 'pending', to: 'in_progress' },
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-task-progress',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-task-progress',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Work through task progress'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent.progress).toEqual(
      expect.objectContaining({
        threadId: 'chat-session-1',
        turnId: 'toolu_task_update_1',
        source: 'Task',
        items: [
          { id: '1', content: 'Mapping modules', status: 'processing', sourceStatus: 'in_progress' },
        ],
        updatedAt: expect.any(Number),
      }),
    )

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(slotStates).toEqual([
      expect.objectContaining({
        kind: 'progress',
        slotId: 'claude-agent:progress',
        threadId: 'chat-session-1',
        turnId: 'toolu_task_update_1',
        source: 'Task',
        currentItem: 'Mapping modules',
        pendingCount: 0,
        inProgressCount: 1,
        completedCount: 0,
        items: [
          { id: '1', label: 'Mapping modules', status: 'inProgress', sourceStatus: 'in_progress' },
        ],
      }),
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
      }),
    ])
  })

  it('runs agent-scoped Claude Agent sessions from the agent home while keeping workspace context explicit', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'cradle-claude-agent-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = homeDir
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-agent-home',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    try {
      const provider = new ClaudeAgentProvider({
        readSecret: () => 'sk-ant-test',
      })
      const runtimeSession = createRuntimeSession()
      runtimeSession.providerStateSnapshot = JSON.stringify({
        workspacePath: '/tmp/cradle-workspace',
        agentId: 'agent-007',
        models: { currentModelId: null },
      })

      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-home',
        runtimeSession,
        profile: createProfile({ additionalDirectories: ['/tmp/extra-directory'] }),
        message: createUserMessage('Use agent home'),
        workspaceId: 'workspace-1',
        agentId: 'agent-007',
      })) {
        // Drain stream.
      }

      const agentHome = join(homeDir, '.cradle', 'agents', 'agent-007')
      expect(readQueryOptions(0)).toEqual(
        expect.objectContaining({
          cwd: agentHome,
          additionalDirectories: ['/tmp/cradle-workspace', '/tmp/extra-directory'],
          env: expect.objectContaining({
            CRADLE_CHAT_SESSION_ID: 'chat-session-1',
            CRADLE_WORKSPACE_ID: 'workspace-1',
            CRADLE_WORKSPACE_PATH: '/tmp/cradle-workspace',
            CRADLE_AGENT_ID: 'agent-007',
            CRADLE_AGENT_HOME: agentHome,
          }),
        }),
      )
      expect(existsSync(join(agentHome, 'skills'))).toBe(true)
      expect(readlinkSync(join(agentHome, '.agents', 'skills'))).toBe('../skills')
      expect(readlinkSync(join(agentHome, '.claude', 'skills'))).toBe('../skills')
    }
 finally {
      rmSync(homeDir, { recursive: true, force: true })
      if (previousHome === undefined) {
        delete process.env.HOME
      }
 else {
        process.env.HOME = previousHome
      }
    }
  })

  it('does not ask the Claude Agent SDK to globally discover skills unless configured', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-no-skills',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-no-skills',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Do not scan skills by default'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).not.toHaveProperty('skills')
  })

  it('forwards explicitly configured Claude Agent skills', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-configured-skills',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-configured-skills',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ skills: ['review'] }),
      message: createUserMessage('Use configured skills'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(
      expect.objectContaining({
        skills: ['review'],
      }),
    )
  })

  it('normalizes removed Claude Agent permission modes to bypass permissions', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-legacy-permissions',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-legacy-permissions',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ permissionMode: 'acceptEdits' }),
      message: createUserMessage('Use a legacy mode'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(
      expect.objectContaining({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    )
  })

  it('discovers SDK slash commands and forwards slash prompt text unchanged', async () => {
    const capabilitiesQuery = createAsyncQuery(
      [],
      [
        { name: 'compact', description: 'Compact the conversation', argumentHint: '' },
        {
          name: 'review',
          description: 'Review a target file',
          argumentHint: '<file>',
          aliases: ['code-review'],
        },
      ],
    )
    const slashRunQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-2',
        message: {
          content: [{ type: 'text', text: 'reviewed' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-2',
        usage: { input_tokens: 2, output_tokens: 1 },
      },
    ])
    sdkMocks.query.mockReturnValueOnce(capabilitiesQuery).mockReturnValueOnce(slashRunQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const profile = createProfile()

    await expect(
      provider.getPresentation({
        runtimeSession,
        profile,
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/cradle-workspace',
      }),
    ).resolves.toEqual({
      runtimeKind: 'claude-agent',
      slashCommands: [
        {
          name: 'compact',
          description: 'Compact the conversation',
          argumentHint: '',
          aliases: undefined,
        },
        {
          name: 'review',
          description: 'Review a target file',
          argumentHint: '<file>',
          aliases: ['code-review'],
        },
      ],
      uiSlots: [
        {
          id: 'claude-agent:compact',
          name: 'compact',
          label: 'Compact',
          description: 'Compact this conversation context.',
          argumentHint: '',
          aliases: ['summarize'],
          iconKey: 'compact',
          commandText: '/compact ',
          surfaces: ['runtimePanel'],
        },
        {
          id: 'claude-agent:quick-question',
          name: 'btw',
          label: 'Quick question',
          description: 'Ask a quick question without saving it to history.',
          argumentHint: '[question]',
          aliases: ['quick-question'],
          iconKey: 'quick-question',
          commandText: '/btw ',
          surfaces: ['slashCommand', 'composerState'],
        },
        {
          id: 'claude-agent:plan',
          name: 'plan',
          label: 'Plan',
          description: 'Show the current execution plan.',
          argumentHint: '',
          iconKey: 'plan',
          commandText: '/plan ',
          surfaces: ['composerState', 'runtimePanel'],
        },
        {
          id: 'claude-agent:progress',
          name: 'progress',
          label: 'Progress',
          description: 'Show the current task progress.',
          argumentHint: '',
          iconKey: 'progress',
          surfaces: ['composerState', 'runtimePanel'],
        },
        {
          id: 'claude-agent:user-input',
          name: 'ask-user',
          label: 'Ask user',
          description: 'Show pending runtime questions for the user.',
          argumentHint: '',
          iconKey: 'user-input',
          surfaces: ['composerState', 'runtimePanel', 'streamEvidence'],
        },
        {
          id: 'claude-agent:crew',
          name: 'crew',
          label: 'Crew',
          description: 'Show active sub-agents and crew status.',
          argumentHint: '',
          iconKey: 'crew',
          surfaces: ['runtimePanel'],
        },
        {
          id: 'claude-agent:tool-activity',
          name: 'tools',
          label: 'Tool activity',
          description: 'Show recent Claude tool activity.',
          argumentHint: '',
          aliases: ['activity'],
          iconKey: 'tool-activity',
          commandText: '/tools ',
          surfaces: ['runtimePanel'],
        },
        {
          id: 'claude-agent:alerts',
          name: 'alerts',
          label: 'Alerts',
          description: 'Show recent Claude permission denials and runtime warnings.',
          argumentHint: '',
          aliases: ['warnings'],
          iconKey: 'alert',
          commandText: '/alerts ',
          surfaces: ['runtimePanel'],
        },
        {
          id: 'claude-agent:usage',
          name: 'usage',
          label: 'Usage',
          description: 'Show current Claude usage and rate limit state.',
          argumentHint: '',
          iconKey: 'usage',
          commandText: '/usage ',
          commandAction: {
            kind: 'uiAction',
            actionId: 'cradle.runtime.usage',
          },
          requiresSession: true,
          surfaces: ['slashCommand', 'runtimePanel'],
        },
      ],
      skills: [],
    })

    expect(capabilitiesQuery.supportedCommands).toHaveBeenCalledOnce()
    expect(capabilitiesQuery.close).toHaveBeenCalledOnce()
    const capabilitiesCall = sdkMocks.query.mock.calls[0]?.[0] as { prompt?: unknown } | undefined
    expect(typeof capabilitiesCall?.prompt).toBe('object')
    expect(
      typeof (capabilitiesCall?.prompt as AsyncIterable<unknown> | undefined)?.[
        Symbol.asyncIterator
      ],
    ).toBe('function')

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession,
      profile,
      message: createUserMessage('/review src/app.ts'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text-delta', delta: 'reviewed' })]),
    )
    expect(sdkMocks.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.objectContaining({
          [Symbol.asyncIterator]: expect.any(Function),
        }),
      }),
    )
    await expect(readPromptText(1)).resolves.toBe('/review src/app.ts')
  })

  it('handles AskUserQuestion via canUseTool callback with runtime pending user input', async () => {
    const questionInput = {
      questions: [
        {
          question: 'Which library should we use?',
          header: 'Library',
          options: [
            { label: 'Zod', description: 'Use the existing schema library.' },
            { label: 'TypeBox', description: 'Use the server schema library.' },
          ],
          multiSelect: false,
        },
      ],
    }
    const requestUserInput = vi.fn(async (request: RuntimeUserInputRequest) => ({
      requestId: request.providerRequestId,
      answers: { 'question-1': ['Zod'] },
    }))
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'result',
          session_id: 'claude-session-ask-user',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
      requestUserInput,
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-ask-user',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Choose a validation library'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    const options = readQueryOptions(0)
    expect(options.canUseTool).toBeDefined()

    const result = await (options.canUseTool as CanUseTool)(
      'AskUserQuestion',
      questionInput,
      canUseToolOptions({ toolUseID: 'toolu_question_1' }),
    )

    expect(requestUserInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'chat-session-1',
        runId: 'run-claude-agent-ask-user',
        providerRequestId: 'toolu_question_1',
        providerMethod: 'askUserQuestion',
        toolCallId: 'toolu_question_1',
        questions: [
          {
            id: 'question-1',
            header: 'Library',
            question: 'Which library should we use?',
            isOther: true,
            isSecret: false,
            multiSelect: false,
            options: [
              { label: 'Zod', description: 'Use the existing schema library.' },
              { label: 'TypeBox', description: 'Use the server schema library.' },
            ],
          },
        ],
      }),
    )
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: questionInput.questions,
        answers: { 'Which library should we use?': 'Zod' },
      },
    })
  })

  it('streams quick questions without persisting SDK sessions or loading tools', async () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-quick-question-session',
          message: {
            content: [{ type: 'text', text: 'Use the exported helper.' }],
          },
        },
        {
          type: 'result',
          session_id: 'claude-quick-question-session',
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.quickQuestion({
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ skills: ['review'], tools: ['Read'] }),
      question: 'Which helper should I use?',
      transcript: [
        createUserMessage('How should this module expose helpers?'),
        {
          id: 'assistant-context',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The module exports named helpers.' }],
        },
      ],
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'Use the exported helper.' }),
      ]),
    )
    expect(readQueryOptions(0)).toEqual(
      expect.objectContaining({
        persistSession: false,
        tools: [],
        model: 'claude-sonnet-4-20250514',
      }),
    )
    expect(readQueryOptions(0)).not.toHaveProperty('mcpServers')
    expect(readQueryOptions(0)).not.toHaveProperty('skills')
    const promptText = await readPromptText(0)
    expect(promptText).toContain('Previous messages in this Cradle chat session:')
    expect(promptText).toContain('User: How should this module expose helpers?')
    expect(promptText).toContain('Assistant: The module exports named helpers.')
    expect(promptText).toContain('Current user message:\nWhich helper should I use?')
  })

  it('resumes a stored Claude Agent SDK session and applies a pending model switch', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-2',
        message: {
          content: [{ type: 'text', text: 'Context preserved' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-2',
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = await provider.resumeChatSession({
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
      modelId: 'claude-opus-4-20250514',
    })
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-model-switch',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Continue with the same context'),
      modelId: 'claude-opus-4-20250514',
      workspaceId: 'workspace-1',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })
    expect(activeQuery.setModel).toHaveBeenCalledWith('claude-opus-4-20250514')

    const call = sdkMocks.query.mock.calls[0]?.[0] as
      | {
          options?: { model?: string, resume?: string }
          prompt?: AsyncIterable<{ message: { content: unknown } }>
        }
        | undefined
    expect(call?.options).toEqual(
      expect.objectContaining({
        model: 'claude-opus-4-20250514',
        persistSession: true,
        resume: 'claude-session-1',
      }),
    )

    await expect(call!.prompt![Symbol.asyncIterator]().next()).resolves.toEqual(
      expect.objectContaining({
        done: false,
        value: expect.objectContaining({
          message: { role: 'user', content: 'Continue with the same context' },
        }),
      }),
    )
    await expect(firstChunk).resolves.toEqual(
      expect.objectContaining({
        done: false,
        value: expect.objectContaining({ type: 'text-start' }),
      }),
    )

    const remainingChunks: UIMessageChunk[] = []
    for await (const chunk of stream) {
      remainingChunks.push(chunk)
    }

    expect(remainingChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'Context preserved' }),
      ]),
    )
    expect(runtimeSession.providerSessionId).toBe('claude-session-2')
    expect(
      JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent?.pendingModelSwitchId,
    ).toBeUndefined()
  })

  it('does not call setModel when a resumed turn repeats the snapshot model override', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-1',
        message: {
          content: [{ type: 'text', text: 'Same model continued' }],
        },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = await provider.resumeChatSession({
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
      modelId: 'claude-sonnet-4-20250514',
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-same-model',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Continue on the same model'),
      modelId: 'claude-sonnet-4-20250514',
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(activeQuery.setModel).not.toHaveBeenCalled()
    expect(readQueryOptions(0)).toEqual(
      expect.objectContaining({
        persistSession: true,
        resume: 'claude-session-1',
      }),
    )
    expect(
      JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent?.pendingModelSwitchId,
    ).toBeUndefined()
  })

  it('projects Claude session titles from SDK session metadata into the Cradle session title callback', async () => {
    sdkMocks.getSessionInfo.mockResolvedValue({
      sessionId: 'claude-session-title',
      summary: 'Claude SDK summary',
      customTitle: '  Claude custom title  ',
      lastModified: 1,
    })
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-title',
          message: {
            content: [{ type: 'text', text: 'ready' }],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-title',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const reportSessionTitle = vi.fn()
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-title-projection',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Continue the session'),
      workspaceId: 'workspace-1',
      reportSessionTitle,
    })) {
      // Drain stream.
    }

    expect(reportSessionTitle).toHaveBeenCalledWith('Claude custom title')
    expect(sdkMocks.getSessionInfo).toHaveBeenCalledWith('claude-session-title', {
      dir: '/tmp/cradle-workspace',
    })
  })

  it('keeps the Claude Agent SDK query alive across normal turn results', async () => {
    const prompts: unknown[] = []
    const activeQueries: Array<ReturnType<typeof createPromptDrivenQuery>> = []
    sdkMocks.query.mockImplementation(
      (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
        expect(call.prompt).toBeDefined()
        const activeQuery = createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'assistant',
                session_id: 'claude-session-live',
                message: {
                  content: [{ type: 'text', text: 'First response' }],
                },
              },
              {
                type: 'result',
                session_id: 'claude-session-live',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
            [
              {
                type: 'assistant',
                session_id: 'claude-session-live',
                message: {
                  content: [{ type: 'text', text: 'Second response' }],
                },
              },
              {
                type: 'result',
                session_id: 'claude-session-live',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
          ],
          prompts,
        )
        activeQueries.push(activeQuery)
        return activeQuery
      },
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()

    const firstChunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-live-1',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('First task'),
      workspaceId: 'workspace-1',
    })) {
      firstChunks.push(chunk)
    }

    expect(firstChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'First response' }),
      ]),
    )
    expect(sdkMocks.query).toHaveBeenCalledOnce()
    expect(activeQueries[0]?.close).not.toHaveBeenCalled()

    const secondChunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-live-2',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Second task'),
      workspaceId: 'workspace-1',
    })) {
      secondChunks.push(chunk)
    }

    expect(secondChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'Second response' }),
      ]),
    )
    expect(sdkMocks.query).toHaveBeenCalledOnce()
    expect(prompts).toEqual(['First task', 'Second task'])
    expect(activeQueries[0]?.close).not.toHaveBeenCalled()

    await provider.dispose()
    expect(activeQueries[0]?.close).toHaveBeenCalledOnce()
  })

  it.sequential(
    'routes active parent-tool child messages to provider-thread events instead of parent chunks',
    async () => {
      const prompts: unknown[] = []
      sdkMocks.query.mockImplementation(
        (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
          expect(call.prompt).toBeDefined()
          return createPromptDrivenQuery(
            call.prompt!,
            [
              [
                {
                  type: 'assistant',
                  session_id: 'claude-session-active-subagent',
                  message: {
                    content: [{ type: 'text', text: 'Parent response' }],
                  },
                },
                {
                  type: 'stream_event',
                  session_id: 'claude-session-active-subagent',
                  parent_tool_use_id: 'toolu_agent_active',
                  event: {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: 'Active child report' },
                  },
                },
                {
                  type: 'result',
                  session_id: 'claude-session-active-subagent',
                  parent_tool_use_id: 'toolu_agent_active',
                  usage: { input_tokens: 2, output_tokens: 3 },
                },
                {
                  type: 'result',
                  session_id: 'claude-session-active-subagent',
                  usage: { input_tokens: 1, output_tokens: 1 },
                },
              ],
            ],
            prompts,
          )
        },
      )

      const provider = new ClaudeAgentProvider({
        readSecret: () => 'sk-ant-test',
      })
      const providerThreadEvents: ProviderThreadEvent[] = []
      const chunks: UIMessageChunk[] = []
      for await (const chunk of provider.streamTurn({
        runId: 'run-claude-agent-active-subagent-parent',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: createUserMessage('Launch active child work'),
        workspaceId: 'workspace-1',
        onProviderThreadEvent: (event) => {
          providerThreadEvents.push(event)
        },
      })) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text-delta', delta: 'Parent response' }),
        ]),
      )
      expect(chunks).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text-delta', delta: 'Active child report' }),
        ]),
      )
      expect(providerThreadEvents.flatMap(event => event.chunks)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text-delta', delta: 'Active child report' }),
          expect.objectContaining({ type: 'finish', finishReason: 'stop' }),
        ]),
      )
      expect(new Set(providerThreadEvents.map(event => event.providerTurnId)).size).toBe(1)
      expect(
        providerThreadEvents.every(event => event.providerThreadId === 'toolu_agent_active'),
      ).toBe(true)

      await provider.dispose()
    },
  )

  it.sequential(
    'emits parent Agent tool output when an active child provider thread completes',
    async () => {
      const prompts: unknown[] = []
      sdkMocks.query.mockImplementation(
        (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
          expect(call.prompt).toBeDefined()
          return createPromptDrivenQuery(
            call.prompt!,
            [
              [
                {
                  type: 'assistant',
                  session_id: 'claude-session-active-subagent-output',
                  message: {
                    content: [
                      {
                        type: 'tool_use',
                        id: 'toolu_agent_active_output',
                        name: 'Agent',
                        input: {
                          description: 'Audit runtime',
                          prompt: 'Inspect provider-thread completion handling.',
                          subagent_type: 'Explore',
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'assistant',
                  session_id: 'claude-session-active-subagent-output',
                  parent_tool_use_id: 'toolu_agent_active_output',
                  message: {
                    content: [{ type: 'text', text: 'Active child report' }],
                  },
                },
                {
                  type: 'result',
                  session_id: 'claude-session-active-subagent-output',
                  parent_tool_use_id: 'toolu_agent_active_output',
                  usage: { input_tokens: 2, output_tokens: 3 },
                },
                {
                  type: 'result',
                  session_id: 'claude-session-active-subagent-output',
                  usage: { input_tokens: 1, output_tokens: 1 },
                },
              ],
            ],
            prompts,
          )
        },
      )

      const provider = new ClaudeAgentProvider({
        readSecret: () => 'sk-ant-test',
      })
      const providerThreadEvents: ProviderThreadEvent[] = []
      const chunks: UIMessageChunk[] = []
      for await (const chunk of provider.streamTurn({
        runId: 'run-claude-agent-active-subagent-output',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: createUserMessage('Launch active child work'),
        workspaceId: 'workspace-1',
        onProviderThreadEvent: (event) => {
          providerThreadEvents.push(event)
        },
      })) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool-output-available',
            toolCallId: 'toolu_agent_active_output',
          }),
        ]),
      )
      expect(providerThreadEvents.flatMap(event => event.chunks)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text-delta', delta: 'Active child report' }),
          expect.objectContaining({ type: 'finish', finishReason: 'stop' }),
        ]),
      )

      await provider.dispose()
    },
  )

  it.sequential(
    'auto-allows active subagent tool requests while SDK runs in bypass mode',
    async () => {
      const activeQuery = createControllableQuery()
      const requestToolApproval = vi.fn()
      let canUseTool: CanUseTool | null = null
      sdkMocks.query.mockImplementation((call: { options?: { canUseTool?: unknown } }) => {
        canUseTool
          = typeof call.options?.canUseTool === 'function'
            ? (call.options.canUseTool as CanUseTool)
            : null
        return activeQuery
      })

      const provider = new ClaudeAgentProvider({
        readSecret: () => 'sk-ant-test',
        requestToolApproval,
      })
      const providerThreadEvents: ProviderThreadEvent[] = []
      const stream = provider.streamTurn({
        runId: 'run-claude-agent-subagent-tool-approval',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: createUserMessage('Launch child work needing approval'),
        workspaceId: 'workspace-1',
        providerOptions: {
          runtimeSettings: { permissionMode: 'bypassPermissions' },
        },
        onProviderThreadEvent: (event) => {
          providerThreadEvents.push(event)
        },
      })
      const pendingNext = stream.next()
      void pendingNext.catch(() => undefined)

      await vi.waitFor(() => {
        expect(typeof canUseTool).toBe('function')
      })
      const capturedCanUseTool = requireCanUseTool(canUseTool)

      activeQuery.push({
        type: 'system',
        subtype: 'task_started',
        session_id: 'claude-session-subagent-tool-approval',
        uuid: 'task-started-subagent-tool-approval',
        task_id: 'agent-child-approval',
        tool_use_id: 'toolu_agent_child_approval',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Investigate with shell access',
        prompt: 'Investigate with shell access',
      })

      await vi.waitFor(() => {
        expect(providerThreadEvents.flatMap(event => event.chunks)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'text-delta', delta: '[researcher started]' }),
          ]),
        )
      })

      const toolInput = { command: 'pwd' }
      const permissionResult = capturedCanUseTool(
        'Bash',
        toolInput,
        canUseToolOptions({
          toolUseID: 'toolu_child_bash_approval',
          agentID: 'agent-child-approval',
        }),
      )

      await expect(permissionResult).resolves.toEqual({
        behavior: 'allow',
        updatedInput: toolInput,
      })
      expect(requestToolApproval).not.toHaveBeenCalled()
      expect(providerThreadEvents.flatMap(event => event.chunks)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toolCallId: 'toolu_child_bash_approval' }),
        ]),
      )

      activeQuery.close()
      await provider.dispose()
    },
  )

  it.sequential(
    'auto-allows unresolved agent tool requests without parent approval chunks',
    async () => {
      const activeQuery = createControllableQuery()
      const requestToolApproval = vi.fn()
      let canUseTool: CanUseTool | null = null
      sdkMocks.query.mockImplementation((call: { options?: { canUseTool?: unknown } }) => {
        canUseTool
          = typeof call.options?.canUseTool === 'function'
            ? (call.options.canUseTool as CanUseTool)
            : null
        return activeQuery
      })

      const provider = new ClaudeAgentProvider({
        readSecret: () => 'sk-ant-test',
        requestToolApproval,
      })
      const providerThreadEvents: ProviderThreadEvent[] = []
      const stream = provider.streamTurn({
        runId: 'run-claude-agent-unresolved-tool-approval',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: createUserMessage('Launch child work with unresolved approval'),
        workspaceId: 'workspace-1',
        providerOptions: {
          runtimeSettings: { permissionMode: 'bypassPermissions' },
        },
        onProviderThreadEvent: (event) => {
          providerThreadEvents.push(event)
        },
      })
      const drainStream = (async () => {
        for await (const _chunk of stream) {
          // Drain parent stream while this test inspects provider-thread events.
        }
      })()
      void drainStream.catch(() => undefined)

      await vi.waitFor(() => {
        expect(typeof canUseTool).toBe('function')
      })
      const capturedCanUseTool = requireCanUseTool(canUseTool)

      activeQuery.push({
        type: 'assistant',
        session_id: 'claude-session-unresolved-tool-approval',
        parent_tool_use_id: 'toolu_agent_unresolved_approval',
        message: {
          content: [{ type: 'text', text: 'Child work started' }],
        },
      })

      await vi.waitFor(() => {
        expect(providerThreadEvents.flatMap(event => event.chunks)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'text-delta', delta: 'Child work started' }),
          ]),
        )
      })

      const permissionResult = capturedCanUseTool(
        'Bash',
        { command: 'pwd' },
        canUseToolOptions({
          toolUseID: 'toolu_unresolved_bash_approval',
          agentID: 'agent-not-in-crew-state',
        }),
      )

      expect(providerThreadEvents.flatMap(event => event.chunks)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toolCallId: 'toolu_unresolved_bash_approval' }),
        ]),
      )
      await expect(permissionResult).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { command: 'pwd' },
      })
      expect(requestToolApproval).not.toHaveBeenCalled()

      activeQuery.close()
      await drainStream
      await provider.dispose()
    },
  )

  it('routes background Claude messages after a parent result into provider synthetic turn events', async () => {
    const prompts: unknown[] = []
    sdkMocks.query.mockImplementation(
      (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
        expect(call.prompt).toBeDefined()
        return createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'assistant',
                session_id: 'claude-session-background',
                message: {
                  content: [{ type: 'text', text: 'Parent response' }],
                },
              },
              {
                type: 'result',
                session_id: 'claude-session-background',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
              {
                type: 'assistant',
                session_id: 'claude-session-background',
                parent_tool_use_id: 'toolu_agent_background',
                message: {
                  content: [{ type: 'text', text: 'Background report' }],
                },
              },
              {
                type: 'result',
                session_id: 'claude-session-background',
                parent_tool_use_id: 'toolu_agent_background',
                usage: { input_tokens: 2, output_tokens: 3 },
              },
            ],
          ],
          prompts,
        )
      },
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const syntheticEvents: ProviderSyntheticTurnEvent[] = []
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-background-parent',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Launch background work'),
      workspaceId: 'workspace-1',
      onProviderSyntheticTurnEvent: (event) => {
        syntheticEvents.push(event)
      },
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'Parent response' }),
      ]),
    )
    expect(chunks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'Background report' }),
      ]),
    )

    await vi.waitFor(() => {
      expect(syntheticEvents.flatMap(event => event.chunks)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text-delta', delta: 'Background report' }),
          expect.objectContaining({ type: 'finish', finishReason: 'stop' }),
        ]),
      )
    })
    expect(new Set(syntheticEvents.map(event => event.providerTurnId)).size).toBe(1)
    expect(
      syntheticEvents.every(event => event.providerThreadId === 'toolu_agent_background'),
    ).toBe(true)

    await provider.dispose()
  })

  it('keeps task notifications out of the main turn and persists the following top-level reply', async () => {
    const prompts: unknown[] = []
    sdkMocks.query.mockImplementation(
      (call: { prompt?: AsyncIterable<{ message: { content: unknown } }> }) => {
        expect(call.prompt).toBeDefined()
        return createPromptDrivenQuery(
          call.prompt!,
          [
            [
              {
                type: 'assistant',
                session_id: 'claude-session-task-notification',
                message: {
                  content: [{ type: 'text', text: 'Parent response' }],
                },
              },
              {
                type: 'result',
                session_id: 'claude-session-task-notification',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
              {
                type: 'system',
                subtype: 'task_notification',
                session_id: 'claude-session-task-notification',
                uuid: 'task-notification-background',
                task_id: 'agent-background-task',
                status: 'completed',
                output_file: '/tmp/background-task.json',
                summary: 'Background task finished',
              },
              {
                type: 'assistant',
                session_id: 'claude-session-task-notification',
                message: {
                  content: [
                    { type: 'text', text: 'Background analysis complete. Want me to change it?' },
                  ],
                },
              },
              {
                type: 'result',
                session_id: 'claude-session-task-notification',
                usage: { input_tokens: 2, output_tokens: 3 },
              },
            ],
            [
              {
                type: 'assistant',
                session_id: 'claude-session-task-notification',
                message: {
                  content: [{ type: 'text', text: 'Next parent response' }],
                },
              },
              {
                type: 'result',
                session_id: 'claude-session-task-notification',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            ],
          ],
          prompts,
        )
      },
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const syntheticEvents: ProviderSyntheticTurnEvent[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-background-notification-parent',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Launch background work'),
      workspaceId: 'workspace-1',
      onProviderSyntheticTurnEvent: (event) => {
        syntheticEvents.push(event)
      },
    })) {
      expect(chunk.type).toBeDefined()
    }

    await vi.waitFor(() => {
      expect(syntheticEvents.flatMap(event => event.chunks)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text-delta',
            delta: 'Background analysis complete. Want me to change it?',
          }),
          expect.objectContaining({ type: 'finish', finishReason: 'stop' }),
        ]),
      )
    })
    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
      workspaceId: 'workspace-1',
    })
    // This `task_notification` never linked to a real Agent/Workflow tool_use — no prior
    // `task_started`/`tool_use`/`tool_result` established a task_id → tool link — so it's a
    // generic background task, not a subagent delegation. It must land in the `toolActivity`
    // slot, not fabricate a phantom crew entry.
    expect(slotStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'toolActivity',
          activeCount: 0,
          completedCount: 1,
          failedCount: 0,
          recentItems: [
            expect.objectContaining({
              id: 'agent-background-task',
              status: 'completed',
              label: 'Background task finished',
            }),
          ],
        }),
      ]),
    )
    expect(syntheticEvents.flatMap(event => event.chunks)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'Background task finished' }),
      ]),
    )
    expect(new Set(syntheticEvents.map(event => event.providerTurnId)).size).toBe(1)
    expect(syntheticEvents.every(event => event.providerThreadId === null)).toBe(true)

    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-background-notification-next',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Next task'),
      workspaceId: 'workspace-1',
      onProviderSyntheticTurnEvent: (event) => {
        syntheticEvents.push(event)
      },
    })) {
      expect(chunk.type).toBeDefined()
    }

    expect(prompts).toEqual(['Launch background work', 'Next task'])

    await provider.dispose()
  })

  it('uses the runtime session model snapshot when a resumed Claude Agent turn has no explicit model override', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-snapshot-model',
        message: {
          content: [{ type: 'text', text: 'Snapshot model used' }],
        },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createResumedRuntimeSession({
      providerStateSnapshot: JSON.stringify({
        workspacePath: '/tmp/cradle-workspace',
        models: { currentModelId: 'mimo-v2.5-pro' },
      }),
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-snapshot-model',
      runtimeSession,
      profile: createProfile({ model: 'claude-sonnet-4-20250514' }),
      message: createUserMessage('Continue without a per-turn model override'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    const call = sdkMocks.query.mock.calls[0]?.[0] as
      | {
          options?: { model?: string, env?: Record<string, string | undefined> }
        }
        | undefined
    expect(activeQuery.setModel).not.toHaveBeenCalled()
    expect(call?.options?.model).toBe('mimo-v2.5-pro')
    expect(call?.options?.env?.ANTHROPIC_MODEL).toBeUndefined()
  })

  it('includes Cradle chat history when a provider-target switch starts a new Claude Agent SDK session', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-new-target',
          message: {
            content: [{ type: 'text', text: 'You said hello earlier.' }],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-new-target',
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-target-switch',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('What did I say earlier?'),
      history: [
        createUserMessage('Hello earlier'),
        {
          id: 'assistant-earlier',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Internal chain should not be replayed' },
            { type: 'text', text: 'Hi, I remember that.' },
          ],
        },
      ],
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'You said hello earlier.' }),
      ]),
    )
    await expect(readPromptText(0)).resolves.toBe(
      [
        'Previous messages in this Cradle chat session:',
        'User: Hello earlier',
        '',
        'Assistant: Hi, I remember that.',
        '',
        'Current user message:',
        'What did I say earlier?',
      ].join('\n'),
    )
  })

  it('replays recent Cradle local history when resuming a stored Claude Agent SDK session', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-1',
          message: {
            content: [{ type: 'text', text: 'The command counted the workspace.' }],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-1',
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-resumed-bang-history',
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Can you see the local command output?'),
      history: [
        createUserMessage('Normal previous chat already lives in the SDK session'),
        {
          id: 'assistant-earlier',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The SDK transcript has this message.' }],
        },
        createBangCommandMessage('scc'),
        createBangResultMessage({
          command: 'scc',
          stdout: 'TypeScript 1911 files\nTotal 3978 files\n',
          exitCode: 0,
          durationMs: 171,
        }),
      ],
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    await expect(readPromptText(0)).resolves.toBe(
      [
        'Previous messages in this Cradle chat session:',
        'User ran local shell command: $ scc',
        '',
        'Local shell command result for `$ scc` (exit code 0, 171ms):',
        'TypeScript 1911 files',
        'Total 3978 files',
        '',
        'Current user message:',
        'Can you see the local command output?',
      ].join('\n'),
    )
  })

  it('enqueues native follow-ups into the live SDK input stream without interrupt', async () => {
    const activeQuery = createPendingQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Initial task'),
      workspaceId: 'workspace-1',
    })
    const pendingNext = stream.next()

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    await expect(readPromptText(0)).resolves.toBe('Initial task')

    const live = liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)
    expect(live?.enqueueNativeFollowUp).toBeTypeOf('function')
    await live!.enqueueNativeFollowUp!({
      queueItemId: 'queue-native-1',
      message: createUserMessage('Follow up while busy'),
    })

    expect(activeQuery.interrupt).not.toHaveBeenCalled()
    await expect(readPromptText(0)).resolves.toBe('Follow up while busy')

    activeQuery.close()
    await pendingNext
  })

  it('adopts a native follow-up on the next streamTurn without double-push', async () => {
    const activeQuery = createControllableQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createResumedRuntimeSession({
      providerSessionId: 'claude-session-native-adopt',
    })

    const firstStream = provider.streamTurn({
      runId: 'run-claude-agent-native-1',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('First turn'),
      workspaceId: 'workspace-1',
    })
    const firstPending = firstStream.next()
    void firstPending.catch(() => undefined)

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })
    await expect(readPromptText(0)).resolves.toBe('First turn')

    const live = liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)
    await live!.enqueueNativeFollowUp!({
      queueItemId: 'queue-adopt-1',
      message: createUserMessage('Queued next'),
    })
    await expect(readPromptText(0)).resolves.toBe('Queued next')

    activeQuery.push({
      type: 'assistant',
      session_id: 'claude-session-native-adopt',
      message: { content: [{ type: 'text', text: 'done first' }] },
    })
    activeQuery.push({
      type: 'result',
      session_id: 'claude-session-native-adopt',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    for await (const _chunk of firstStream) {
      // drain first turn
    }

    // SDK already started the follow-up before Cradle adopts.
    activeQuery.push({
      type: 'assistant',
      session_id: 'claude-session-native-adopt',
      message: { content: [{ type: 'text', text: 'from queue' }] },
    })
    activeQuery.push({
      type: 'result',
      session_id: 'claude-session-native-adopt',
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const secondChunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-native-2',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Queued next'),
      queueItemId: 'queue-adopt-1',
      workspaceId: 'workspace-1',
    })) {
      secondChunks.push(chunk)
    }

    expect(secondChunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text-delta', delta: 'from queue' })]),
    )
    expect(live!.claimNativeFollowUp!('queue-adopt-1')).toBe(false)

    activeQuery.close()
    await provider.dispose()
  })

  it('fails native enqueue when the live query pump is dead', async () => {
    const activeQuery = createPendingQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-dead-pump',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Initial task'),
      workspaceId: 'workspace-1',
    })
    const pendingNext = stream.next()
    void pendingNext.catch(() => undefined)

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    const live = liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)
    activeQuery.close()
    await vi.waitFor(() => {
      expect(liveRuntimeSessionRegistry.read(runtimeSession.chatSessionId)).toBeUndefined()
    })

    await expect(
      live!.enqueueNativeFollowUp!({
        queueItemId: 'queue-dead-1',
        message: createUserMessage('Should fail'),
      }),
    ).rejects.toThrow(/no live query/i)

    await provider.dispose()
  })

  it('passes configured Claude Agent SDK model aliases through the query environment', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-model-aliases',
          message: {
            content: [{ type: 'text', text: 'ready' }],
          },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const profile = createProfile({
      claudeAgent: {
        modelAliases: {
          haiku: ' claude-haiku-4-5 ',
          sonnet: 'claude-sonnet-4-5',
          opus: 'claude-opus-4-5',
        },
      },
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile,
      message: createUserMessage('Use aliases'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    expect(sdkMocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          env: expect.objectContaining({
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5',
          }),
        }),
      }),
    )
  })

  it('uses the effective model fallback when Claude Agent model aliases are empty', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-empty-aliases',
          message: {
            content: [{ type: 'text', text: 'ready' }],
          },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const profile = createProfile({
      claudeAgent: {
        modelAliases: {
          haiku: '',
          sonnet: '   ',
        },
      },
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile,
      message: createUserMessage('Use defaults'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    const call = sdkMocks.query.mock.calls[0]?.[0] as
      | {
          options?: { env?: Record<string, string> }
        }
        | undefined
    expect(call?.options?.env).toMatchObject({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-20250514',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-20250514',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet-4-20250514',
      CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-4-20250514',
    })
  })

  it('emits separate text segments around tool calls inside one assistant message', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-segmented',
          message: {
            content: [
              { type: 'text', text: 'First text.' },
              { type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'pwd' } },
              { type: 'text', text: 'Second text.' },
              { type: 'tool_use', id: 'tool-2', name: 'read_file', input: { path: 'README.md' } },
              { type: 'text', text: 'Final text.' },
            ],
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-segmented',
          usage: { input_tokens: 4, output_tokens: 4 },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Run segmented tools'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'First text.' },
      { type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'bash' },
      {
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'bash',
        input: expect.objectContaining({
          identifier: 'claude-code',
          apiName: 'Bash',
          args: { command: 'pwd' },
        }),
      },
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'Second text.' },
      { type: 'tool-input-start', toolCallId: 'tool-2', toolName: 'read_file' },
      {
        type: 'tool-input-available',
        toolCallId: 'tool-2',
        toolName: 'read_file',
        input: expect.objectContaining({
          identifier: 'claude-code',
          apiName: 'Read',
          args: { path: 'README.md' },
        }),
      },
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'Final text.' },
      { type: 'text-end', id: expect.any(String) },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('projects image file attachments into Claude Agent SDK image content blocks', async () => {
    sdkMocks.query.mockReturnValue(
      createAsyncQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-image-input',
          message: {
            content: [{ type: 'text', text: 'I can see it.' }],
          },
        },
      ]),
    )

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: {
        id: 'user-with-image',
        role: 'user',
        parts: [
          { type: 'text', text: 'Read this image' },
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'diagram.png',
            url: 'data:image/png;base64,test',
          },
        ],
      },
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: 'I can see it.' }),
      ]),
    )
    await expect(readPromptContent(0)).resolves.toEqual([
      { type: 'text', text: 'Read this image' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'test',
        },
      },
    ])
  })

  it('rejects non-image file attachments at the provider boundary', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    await expect(async () => {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-test',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: {
          id: 'user-with-file',
          role: 'user',
          parts: [
            { type: 'text', text: 'Read this image' },
            {
              type: 'file',
              mediaType: 'application/pdf',
              filename: 'brief.pdf',
              url: 'data:application/pdf;base64,test',
            },
          ],
        },
        workspaceId: 'workspace-1',
      })) {
        // Drain stream to force prompt projection.
      }
    }).rejects.toThrow(
      'Claude Agent provider only supports text, image, skill, and plugin mention input; unsupported parts: file (brief.pdf) (application/pdf)',
    )

    expect(sdkMocks.query).not.toHaveBeenCalled()
  })

  it('reads active Claude Agent SDK context usage with open category fallback', async () => {
    const activeQuery = createPendingQuery(createContextUsageResponse())
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createResumedRuntimeSession({
      providerSessionId: 'claude-session-context',
    })
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-context-usage',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Inspect context usage'),
      workspaceId: 'workspace-1',
    })
    const pendingNext = stream.next()

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    const usage = await provider.getContextUsage({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
    expect(usage).toEqual(
      expect.objectContaining({
        runtimeKind: 'claude-agent',
        providerSessionId: 'claude-session-context',
        source: 'claude-agent-sdk.getContextUsage',
        model: 'claude-sonnet-4-20250514',
        totalTokens: 367,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 0.1835,
      }),
    )

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
    expect(slotStates).toEqual([
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
        threadId: 'chat-session-1',
        total: expect.objectContaining({
          totalTokens: 367,
          inputTokens: 367,
        }),
        modelContextWindow: 200_000,
        usagePercent: 0.1835,
      }),
    ])

    const sections = new Map(usage!.sections.map(section => [section.kind, section]))
    expect(sections.get('system-prompt')).toEqual(
      expect.objectContaining({
        label: 'System prompt',
        tokenCount: 100,
        color: '#2563eb',
      }),
    )
    expect(sections.get('messages')).toEqual(
      expect.objectContaining({
        label: 'Messages',
        tokenCount: 250,
      }),
    )
    expect(sections.get('messages')?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'assistant-message-tokens', tokenCount: 150 }),
        expect.objectContaining({ kind: 'user-message-tokens', tokenCount: 100 }),
      ]),
    )
    expect(sections.get('others')).toEqual(
      expect.objectContaining({
        label: 'Unclassified provider payload',
        tokenCount: 17,
      }),
    )
    expect(sections.get('memory-files')).toEqual(
      expect.objectContaining({
        tokenCount: 42,
      }),
    )
    expect(sections.get('memory-files')?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'memory-file', label: '/tmp/CLAUDE.md', tokenCount: 42 }),
      ]),
    )
    expect(sections.get('tools')).toEqual(
      expect.objectContaining({
        tokenCount: 7,
      }),
    )
    expect(sections.get('tools')?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'tool-call-tokens', tokenCount: 7 }),
        expect.objectContaining({ kind: 'tool-call-type', label: 'Read', tokenCount: 7 }),
      ]),
    )

    activeQuery.close()
    await pendingNext
  })

  it('reuses cached compact slot state when Claude Agent context usage refresh fails', async () => {
    vi.useFakeTimers()
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const activeQuery = createPendingQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const runtimeSession = createResumedRuntimeSession({
      providerSessionId: 'claude-session-context-cache',
    })
    try {
      const pendingStream = (async () => {
        for await (const _chunk of provider.streamTurn({
          runId: 'run-claude-agent-context-cache',
          runtimeSession,
          profile: createProfile(),
          message: createUserMessage('Keep running'),
          workspaceId: 'workspace-1',
        })) {
          // Keep stream active until the query closes.
        }
      })()

      await provider.getContextUsage({
        runtimeSession,
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      })
      await provider.getUiSlotStates({
        runtimeSession,
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      })

      vi.setSystemTime(Date.now() + 20_000)
      activeQuery.getContextUsage.mockRejectedValueOnce(
        new Error('Query closed before response received'),
      )

      await expect(
        provider.getUiSlotStates({
          runtimeSession,
          profile: createProfile(),
          workspacePath: '/tmp/cradle-workspace',
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          kind: 'compact',
          slotId: 'claude-agent:compact',
        }),
      ])

      activeQuery.close()
      await pendingStream
    }
 finally {
      vi.useRealTimers()
    }
  })

  it('returns null context usage when no Claude Agent query is active', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    await expect(
      provider.getContextUsage({
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      }),
    ).resolves.toBeNull()
  })

  it('keeps context usage and compact slot state available after a fast Claude Agent stream ends', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const activeQuery = createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-fast',
        usage: { input_tokens: 30, output_tokens: 12 },
      },
    ])

    sdkMocks.query.mockReturnValue(activeQuery)

    const runtimeSession = createResumedRuntimeSession({
      providerSessionId: 'claude-session-fast',
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-fast-context',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Fast answer'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
    await expect(
      provider.getContextUsage({
        runtimeSession,
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        runtimeKind: 'claude-agent',
        providerSessionId: 'claude-session-fast',
        totalTokens: 367,
        source: 'claude-agent-sdk.getContextUsage',
      }),
    )
    await expect(
      provider.getUiSlotStates({
        runtimeSession,
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
        modelContextWindow: 200_000,
        total: expect.objectContaining({ totalTokens: 367 }),
      }),
    ])
    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
  })

  it('accumulates usage across multiple streaming messages', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const activeQuery = createAsyncQuery([
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        session_id: 'claude-session-1',
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        },
        session_id: 'claude-session-1',
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          usage: { input_tokens: 0, output_tokens: 25 },
        },
        session_id: 'claude-session-1',
      },
      {
        type: 'result',
        usage: { input_tokens: 0, output_tokens: 10 },
        session_id: 'claude-session-1',
      },
    ])

    sdkMocks.query.mockReturnValue(activeQuery)

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Test' }],
      },
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    // lastUsage should be the most recent usage
    expect(provider.lastUsage).toEqual({
      promptTokens: 0,
      completionTokens: 10,
      totalTokens: 10,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    })

    // totalUsage should be the sum of all usage
    expect(provider.totalUsage).toEqual({
      promptTokens: 100,
      completionTokens: 85, // 50 + 25 + 10
      totalTokens: 185,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    })
  })
})
