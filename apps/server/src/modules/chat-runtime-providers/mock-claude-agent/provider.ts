import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

import type {
  CancelTurnInput,
  ChatRuntime,
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  ProviderContext,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import type { RuntimeKind } from '../../provider-contracts/types'
import { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } from '../claude-agent/event-to-chunk-mapper'
import { providerChunk } from '../kit/chunk-mapper'
import { projectTextOnlyInput } from '../kit/input-projector'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'

const RUNTIME_KIND = 'claude-agent' as RuntimeKind
const TRAILING_SLASH_RE = /\/$/
const DEFAULT_MOCK_BASE_URL = process.env.CRADLE_MOCK_LLM_URL?.trim() || 'http://127.0.0.1:56344/v1'

const MOCK_CLAUDE_AGENT_RUNTIME_METADATA = {
  label: 'Claude Agent',
  description: 'Claude Agent SDK runtime',
  providerKinds: ['anthropic', 'universal'],
  iconKey: 'claude-agent',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 30,
} satisfies ChatRuntimeMetadata

const MOCK_CLAUDE_AGENT_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: false,
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'restart-session',
} satisfies ChatRuntimeCapabilities

export function createMockClaudeAgentProvider(_ctx: ProviderContext): ChatRuntime {
  return new MockClaudeAgentProvider()
}

export class MockClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND
  readonly metadata = MOCK_CLAUDE_AGENT_RUNTIME_METADATA
  readonly capabilities = MOCK_CLAUDE_AGENT_RUNTIME_CAPABILITIES

  private readonly activeAbortControllers = new Map<string, AbortController>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  private releaseTurn(sessionId: string, abortController: AbortController): void {
    if (this.activeAbortControllers.get(sessionId) === abortController) {
      this.activeAbortControllers.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        models: { currentModelId: input.modelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        models: {
          currentModelId: input.modelId ?? snapshot.models.currentModelId,
        },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readMockClaudeAgentConfig(profile.configJson)
    const { baseUrl } = config
    const userPrompt = projectTextOnlyInput(input.message, 'Mock Claude Agent provider')

    const abortController = new AbortController()
    const sessionId = input.runtimeSession.chatSessionId
    this.activeAbortControllers.set(sessionId, abortController)
    this._lastUsage = null

    const mapperState = createClaudeAgentChunkMapperState()

    try {
      const queryUrl = `${baseUrl.replace(TRAILING_SLASH_RE, '')}/v1/claude-agent/query`
      const response = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, 'streamTurn', `Mock server returned ${response.status}: ${response.statusText}`),
        )
      }

      if (!response.body) {
        throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'streamTurn', 'Mock server returned empty body'))
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) {
            continue
          }

          const jsonStr = trimmed.slice(6)
          if (jsonStr === '[DONE]') {
            continue
          }

          const message = JSON.parse(jsonStr) as SDKMessage
          const result = await mapClaudeAgentMessageToChunks(message, mapperState)
          for (const chunk of result.chunks) {
            yield chunk
          }
        }

        if (abortController.signal.aborted) {
          break
        }
      }

      if (mapperState.assistantStarted) {
        yield providerChunk.textEnd(mapperState.textItemId)
      }
    }
    finally {
      this.releaseTurn(sessionId, abortController)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const ctrl = this.activeAbortControllers.get(sessionId)
    if (ctrl) {
      ctrl.abort()
      this.releaseTurn(sessionId, ctrl)
    }
  }
}

function readMockClaudeAgentConfig(raw: string): { baseUrl: string } {
  const config = JSON.parse(raw) as { baseUrl?: string }
  const baseUrl = config.baseUrl?.trim() || DEFAULT_MOCK_BASE_URL
  return { ...config, baseUrl }
}
