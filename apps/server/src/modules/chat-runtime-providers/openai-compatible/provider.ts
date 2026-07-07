import type { UIMessageChunk } from 'ai'

import type {
  CancelTurnInput,
  ChatRuntime,
  ProviderContext,
  ResumeChatSessionInput,
  RuntimeSession,
  RuntimeStepUsage,
  StartChatSessionInput,
  StreamTurnInput,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { buildModelMessages, executeAiSdkTurn } from '../../chat-runtime-engine/ai-sdk-engine'
import { createLanguageModel, detectApiFormat } from '../../chat-runtime-engine/providers'
import { lookupContextWindow } from '../../model-registry/model-info-registry'
import { readTrustedOpenAICompatibleConfig, readTrustedUniversalConfig } from '../../provider-contracts/provider-base'
import { readProviderStateSnapshot } from '../kit/state-snapshot'
import {
  STANDARD_RUNTIME_CAPABILITIES,
  STANDARD_RUNTIME_KIND,
  STANDARD_RUNTIME_METADATA,
} from './metadata'

export function createStandardProvider(ctx: ProviderContext): ChatRuntime {
  return new OpenAICompatibleProvider(ctx)
}

export class OpenAICompatibleProvider implements ChatRuntime {
  readonly runtimeKind = STANDARD_RUNTIME_KIND
  readonly metadata = STANDARD_RUNTIME_METADATA
  readonly capabilities = STANDARD_RUNTIME_CAPABILITIES

  private readonly activeTurns = new Map<string, AbortController>()
  private _lastUsage: TokenUsage | null = null
  private _lastStepUsages: RuntimeStepUsage[] = []

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastStepUsages(): RuntimeStepUsage[] {
    return this._lastStepUsages
  }

  constructor(private readonly deps: ProviderContext) {}

  private releaseTurn(sessionId: string, abortController: AbortController): void {
    if (this.activeTurns.get(sessionId) === abortController) {
      this.activeTurns.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const { baseUrl, model } = resolveOpenAICompatibleEndpoint(profile)
    const currentModelId = input.modelId ?? model

    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: this.runtimeKind,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        baseUrl,
        models: { currentModelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    if (!input.modelId) {
      return input.runtimeSession
    }

    const snapshot = readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        models: { currentModelId: input.modelId },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const { runtimeSession, message, modelId: requestedModelId, providerOptions } = input
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const { baseUrl, model, apiMode } = resolveOpenAICompatibleEndpoint(profile)
    const effectiveModel = requestedModelId ?? model
    if (!baseUrl || !effectiveModel) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'streamTurn', 'OpenAI-compatible provider requires baseUrl and model'),
      )
    }

    const apiKey = profile.credentialRef
      ? this.deps.readSecret(profile.credentialRef)
      : 'no-key'

    const abortController = new AbortController()
    const sessionId = runtimeSession.chatSessionId
    this.activeTurns.set(sessionId, abortController)
    this._lastUsage = null
    this._lastStepUsages = []

    try {
      const apiFormat = detectApiFormat(baseUrl)
      const model = createLanguageModel({
        apiFormat,
        apiKey,
        baseUrl,
        modelId: effectiveModel,
        apiMode,
      })

      const { maxMessages } = resolveOpenAICompatibleEndpoint(profile)
      const messages = await buildModelMessages(
        input.history,
        message,
        maxMessages,
      )

      const contextWindow = await lookupContextWindow(effectiveModel) ?? 128_000

      yield* executeAiSdkTurn({
        model,
        messages,
        initialMessage: input.responseMessageId
          ? { id: input.responseMessageId, role: 'assistant', parts: [] }
          : undefined,
        originalMessages: input.originalMessages,
        system: input.systemPrompt,
        maxSteps: 1, // single-turn for openai-compatible (no tool execution)
        abortSignal: abortController.signal,
        providerOptions,
        onUsage: (usage) => { this._lastUsage = usage },
        onStepFinish: (step) => { this._lastStepUsages.push(step) },
        contextWindow,
        chatSessionId: runtimeSession.chatSessionId,
      })
    }
    catch (error) {
      if (isAbortError(error)) {
        throw createAbortError()
      }
      throw error
    }
    finally {
      this.releaseTurn(sessionId, abortController)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const controller = this.activeTurns.get(sessionId)
    if (controller) {
      controller.abort()
      this.releaseTurn(sessionId, controller)
    }
  }
}

interface ResolvedOpenAICompatibleEndpoint {
  baseUrl: string | null
  model: string | null
  maxMessages: number
  apiMode?: 'responses' | 'chat-completions'
}

function resolveOpenAICompatibleEndpoint(
  profile: import('../../chat-runtime/runtime-provider-types').RuntimeProviderTargetProfile,
): ResolvedOpenAICompatibleEndpoint {
  if (profile.providerKind === 'universal') {
    const config = readTrustedUniversalConfig(profile.configJson)
    return {
      baseUrl: config.openaiBaseUrl,
      model: config.model,
      maxMessages: config.maxMessages,
    }
  }
  const config = readTrustedOpenAICompatibleConfig(profile.configJson)
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    maxMessages: config.maxMessages,
    apiMode: config.apiMode,
  }
}

function createAbortError(): Error {
  const error = new Error('OpenAI-compatible turn aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Whether `error` is the `AbortError` produced by our own `abortController`
 * (created above and only ever aborted from `cancelTurn`). Checking the
 * standard `name` is sufficient because that's the contract `AbortController`
 * signals guarantee for fetch/stream consumers — matching on message
 * substrings like "abort"/"aborted" instead would also catch real provider
 * failures (e.g. "stream aborted by remote") and misreport them as a user
 * cancellation, dropping the actual error.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
  )
}
