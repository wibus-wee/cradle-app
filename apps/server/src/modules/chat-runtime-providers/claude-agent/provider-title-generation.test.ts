import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Logger } from '../../../logging/logger'
import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { generateClaudeSessionTitle } from './provider-title-generation'
import type { ClaudeAgentProviderDeps, ClaudeTitleGenerationThinkingEffort } from './types'

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdkMocks.query,
}))

function createFakeQuery(items: unknown[]) {
  let index = 0
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (index >= items.length) {
        return { done: true as const, value: undefined }
      }
      const value = items[index]
      index += 1
      return { done: false as const, value }
    },
    close: vi.fn(),
  }
}

function createTestLogger(): Logger {
  const logger = new Logger()
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
  vi.spyOn(logger, 'info').mockImplementation(() => undefined)
  vi.spyOn(logger, 'error').mockImplementation(() => undefined)
  return logger
}

function createDeps(logger = createTestLogger()): ClaudeAgentProviderDeps {
  return {
    readSecret: () => 'sk-ant-test',
    logger,
  }
}

function createProfile(thinkingEffort: ClaudeTitleGenerationThinkingEffort = 'minimal'): RuntimeProviderTargetProfile {
  return createProfileWithConfig('profile-1', { apiKey: 'sk-ant-test', thinkingEffort })
}

function createProfileWithConfig(id: string, config: object): RuntimeProviderTargetProfile {
  return {
    id,
    name: id,
    providerKind: 'anthropic',
    enabled: true,
    configJson: JSON.stringify(config),
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: id,
  }
}

function createRuntimeSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: 'profile-1',
    runtimeKind: 'claude-agent',
    providerSessionId: null,
    providerStateSnapshot: null,
    ...overrides,
  }
}

afterEach(() => {
  sdkMocks.query.mockReset()
})

describe('generateClaudeSessionTitle', () => {
  it('extracts text from BetaMessage content blocks', async () => {
    sdkMocks.query.mockImplementation(({ options }: { prompt: string, options: Options }) => {
      expect(options.model).toBe('claude-test-model')
      expect(options.persistSession).toBe(false)
      return createFakeQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-1',
          message: {
            id: 'msg_1',
            container: null,
            content: [
              { type: 'text', text: 'Investigate ', citations: null },
              { type: 'tool_use', id: 'tool_1', name: 'Bash', input: {} },
              { type: 'text', text: 'the bug', citations: null },
            ],
            usage: { input_tokens: 10, output_tokens: 20 },
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-1',
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      ])
    })

    const logger = createTestLogger()
    const title = await generateClaudeSessionTitle({
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      promptText: 'Help me debug the login flow',
      modelId: 'claude-test-model',
      thinkingEffort: 'minimal',
      workspacePath: '/tmp/cradle-test-workspace',
      agentId: null,
      deps: createDeps(logger),
      signal: new AbortController().signal,
    })

    expect(title).toBe('Investigate the bug')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('falls back to the profile config model when modelId is null', async () => {
    sdkMocks.query.mockImplementation(({ options }: { prompt: string, options: Options }) => {
      expect(options.model).toBe('claude-config-model')
      return createFakeQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-2',
          message: {
            id: 'msg_2',
            container: null,
            content: [{ type: 'text', text: 'Untitled session', citations: null }],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-2',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ])
    })

    const profile = createProfileWithConfig('profile-2', { apiKey: 'sk-ant-test', model: 'claude-config-model' })

    const title = await generateClaudeSessionTitle({
      runtimeSession: createRuntimeSession(),
      profile,
      promptText: 'Refactor the auth middleware',
      modelId: null,
      thinkingEffort: 'minimal',
      workspacePath: '/tmp/cradle-test-workspace',
      agentId: null,
      deps: createDeps(),
      signal: new AbortController().signal,
    })

    expect(title).toBe('Untitled session')
  })

  it('warns and returns null when the SDK emits no text content', async () => {
    sdkMocks.query.mockReturnValue(createFakeQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-3',
        message: {
          id: 'msg_3',
          container: null,
          content: [{ type: 'tool_use', id: 'tool_3', name: 'Bash', input: {} }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-3',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const logger = createTestLogger()
    const title = await generateClaudeSessionTitle({
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      promptText: 'Run the build script',
      modelId: 'claude-test-model',
      thinkingEffort: 'minimal',
      workspacePath: '/tmp/cradle-test-workspace',
      agentId: null,
      deps: createDeps(logger),
      signal: new AbortController().signal,
    })

    expect(title).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      'claude session title generation produced no assistant text',
      { modelId: 'claude-test-model' },
    )
  })

  it('skips title generation when the api key is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '')
    const logger = createTestLogger()
    const title = await generateClaudeSessionTitle({
      runtimeSession: createRuntimeSession(),
      profile: createProfileWithConfig('profile-no-key', {}),
      promptText: 'Hello',
      modelId: 'claude-test-model',
      thinkingEffort: 'minimal',
      workspacePath: '/tmp/cradle-test-workspace',
      agentId: null,
      deps: {
        readSecret: () => { throw new Error('no secret') },
        logger,
      },
      signal: new AbortController().signal,
    })

    expect(title).toBeNull()
    expect(sdkMocks.query).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'claude session title generation skipped: no api key resolved',
      expect.objectContaining({ modelId: 'claude-test-model' }),
    )
    vi.unstubAllEnvs()
  })

  it('projects the provider base URL into the title query environment', async () => {
    sdkMocks.query.mockImplementation(({ options }: { prompt: string, options: Options }) => {
      expect(options.env?.ANTHROPIC_BASE_URL).toBe('https://proxy.example')
      expect(options.tools).toEqual([])
      expect(options.mcpServers).toBeUndefined()
      expect(options.skills).toBeUndefined()
      return createFakeQuery([
        {
          type: 'assistant',
          session_id: 'claude-session-4',
          message: {
            id: 'msg_4',
            container: null,
            content: [{ type: 'text', text: 'Proxy-backed title', citations: null }],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        {
          type: 'result',
          session_id: 'claude-session-4',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ])
    })

    const title = await generateClaudeSessionTitle({
      runtimeSession: createRuntimeSession(),
      profile: createProfileWithConfig('proxy-profile', {
        apiKey: 'sk-proxy-test',
        baseUrl: 'https://proxy.example',
      }),
      promptText: 'Name this session',
      modelId: 'claude-test-model',
      thinkingEffort: 'minimal',
      workspacePath: '/tmp/cradle-test-workspace',
      agentId: null,
      deps: createDeps(),
      signal: new AbortController().signal,
    })

    expect(title).toBe('Proxy-backed title')
  })
})
