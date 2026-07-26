import type {
  AccountInfo,
  SDKControlGetContextUsageResponse,
} from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage } from 'ai'
import { vi } from 'vitest'

import type {
  RuntimeProviderTargetProfile,
  RuntimeSession,
} from '../../chat-runtime/runtime-provider-types'

export function createContextUsageResponse(
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

export function createAsyncQuery(
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

export function createPendingQuery(
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

export function createProfile(
  config: Record<string, unknown> = {},
): RuntimeProviderTargetProfile {
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

export function createRuntimeSession(): RuntimeSession {
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

export function createResumedRuntimeSession(
  overrides: Partial<RuntimeSession> = {},
): RuntimeSession {
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

export function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}
