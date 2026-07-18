import type { DefaultRuntimeConfigOptions, MessageIngressCommand, MessageIngressResult } from '@hijarvis/core'
import { defaultRuntimeConfig, executeIngressCommand } from '@hijarvis/core'
import type { UIMessageChunk } from 'ai'

import { appendHarnessFragmentsToSystemPrompt } from '../../chat-runtime/harness/projection'
import type {
  CancelTurnInput,
  ChatRuntime,
  ProviderContext,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import * as Preferences from '../../preferences/service'
import {
  readTrustedSystemAgentConfig,
} from '../../provider-contracts/provider-base'
import {
  closeSystemAgentBridgeState,
  createSystemAgentBridgeState,
  mapSystemAgentEventToChunks,
} from './event-to-chunk-mapper'
import { projectSystemAgentUserPrompt } from './input-projector'
import {
  SYSTEM_AGENT_RUNTIME_CAPABILITIES,
  SYSTEM_AGENT_RUNTIME_KIND,
  SYSTEM_AGENT_RUNTIME_METADATA,
} from './metadata'
import {
  applySystemAgentModelRegistryConfig,
  inferSystemAgentApiFromKind,
  inferSystemAgentProviderFromKind,
  resolveSystemAgentRuntimeRegistryModel,
  selectSystemAgentThinkingLevel,
} from './model-registry-bridge'
import { resolveSystemAgentRuntimeContext } from './runtime-context'
import { projectSystemAgentModelSnapshot } from './state-projector'
import type { JarvisThinkingLevel } from './types'

export function createSystemAgentProvider(ctx: ProviderContext): ChatRuntime {
  return new SystemAgentProvider(ctx)
}

export class SystemAgentProvider implements ChatRuntime {
  readonly runtimeKind = SYSTEM_AGENT_RUNTIME_KIND
  readonly metadata = SYSTEM_AGENT_RUNTIME_METADATA
  readonly capabilities = SYSTEM_AGENT_RUNTIME_CAPABILITIES

  private readonly activeTurns = new Map<string, AbortController>()
  private _lastUsage: TokenUsage | null = null
  private _lastModelId: string | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastModelId(): string | null {
    return this._lastModelId
  }

  constructor(private readonly deps: ProviderContext) {}

  private releaseTurn(sessionId: string, abortController: AbortController): void {
    if (this.activeTurns.get(sessionId) === abortController) {
      this.activeTurns.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const currentModelId = input.modelId ?? jarvisPrefs.model
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: SYSTEM_AGENT_RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const currentModelId = input.modelId ?? jarvisPrefs.model
    if (!currentModelId) {
      return input.runtimeSession
    }
    return {
      ...input.runtimeSession,
      providerStateSnapshot: projectSystemAgentModelSnapshot(input.runtimeSession.providerStateSnapshot, currentModelId),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const config = readTrustedSystemAgentConfig(profile.configJson)
    const userPrompt = projectSystemAgentUserPrompt(input.message)

    const provider = config.provider ?? inferSystemAgentProviderFromKind(profile.providerKind ?? 'universal')
    const model = jarvisPrefs.model
    const { baseUrl } = config
    if (!model) {
      throw new ProviderRuntimeError(ProviderErrors.modelNotFound(this.runtimeKind, ''))
    }

    const secretRef = profile.credentialRef
    const apiKey = secretRef
      ? this.deps.readSecret(secretRef)
      : config.apiKey

    const runtimeRegistryModel = await resolveSystemAgentRuntimeRegistryModel(model)
    const thinkingLevel = selectSystemAgentThinkingLevel(
      model,
      (jarvisPrefs.thinkingLevel ?? config.thinkingLevel) as JarvisThinkingLevel,
      runtimeRegistryModel,
    )
    const systemPrompt = appendHarnessFragmentsToSystemPrompt(input.systemPrompt, input.harness)
      ?? 'You are Jarvis, a helpful system assistant.'
    const sessionId = input.runtimeSession.chatSessionId

    const runtimeContext = resolveSystemAgentRuntimeContext()

    const runtimeConfigOptions: DefaultRuntimeConfigOptions = {
      provider,
      model,
      systemPrompt,
      sessionsRootDir: runtimeContext.sessionsRootDir,
      workspaceRoot: runtimeContext.jarvisWorkspaceRoot,
    }
    if (thinkingLevel) {
      runtimeConfigOptions.thinkingLevel = thinkingLevel as DefaultRuntimeConfigOptions['thinkingLevel']
    }
    if (apiKey) {
      runtimeConfigOptions.apiKey = apiKey
    }
    if (baseUrl) {
      runtimeConfigOptions.baseUrl = baseUrl
    }
    if (config.api) {
      runtimeConfigOptions.api = config.api as DefaultRuntimeConfigOptions['api']
    }
    else {
      // Always provide api protocol — jar-core requires it for non-builtin models
      runtimeConfigOptions.api = inferSystemAgentApiFromKind(profile.providerKind ?? 'universal') as DefaultRuntimeConfigOptions['api']
    }

    applySystemAgentModelRegistryConfig(runtimeConfigOptions, {
      model,
      registryModel: runtimeRegistryModel,
      config,
    })

    // Inject Cradle context so bash subprocesses spawned by skills can call
    // Cradle APIs with the correct identity and workspace.
    runtimeConfigOptions.extraShellEnv = {
      CRADLE_CHAT_SESSION_ID: sessionId,
      ...(input.workspaceId ? { CRADLE_WORKSPACE_ID: input.workspaceId } : {}),
    }

    const jarConfig = await defaultRuntimeConfig(runtimeConfigOptions)

    const abortController = new AbortController()
    this.activeTurns.set(sessionId, abortController)
    this._lastUsage = null
    this._lastModelId = model

    const chunks: UIMessageChunk[] = []
    let done = false
    let streamError: Error | null = null
    let resolveNext: (() => void) | null = null
    const bridgeState = createSystemAgentBridgeState()

    const command: MessageIngressCommand = {
      kind: 'message',
      source: { platform: 'cli' },
      routing: {
        platform: 'cli',
        scope: { kind: 'local_thread', threadId: sessionId },
      },
      message: { text: userPrompt },
      prompt: userPrompt,
      audit: { trigger: 'user_input' },
      execution: {
        onEvent: (event) => {
          if (abortController.signal.aborted) {
            return
          }

          if (event.type === 'message_update') {
            const ame = event.assistantMessageEvent
            const newChunks = mapSystemAgentEventToChunks(ame, bridgeState)
            if (newChunks.length > 0) {
              chunks.push(...newChunks)
              resolveNext?.()
            }
          }
 else if (event.type === 'agent_end') {
            chunks.push(...closeSystemAgentBridgeState(bridgeState))
            done = true
            resolveNext?.()
          }
        },
      },
    }

    // Resolve skill roots — use jarvis workspace root (always has a valid path)
    const skillRoots = this.resolveSkillPaths(runtimeContext.jarvisWorkspaceRoot)

    const commandPromise = executeIngressCommand({ config: jarConfig, command, pluginOverrides: { skillRoots } }).then((result) => {
      if (result.kind === 'message') {
        this.captureResultUsage(result, model)
      }
      return result
    }).catch((err) => {
      streamError = err instanceof Error ? err : new Error(String(err))
      if (!done) {
        done = true
        resolveNext?.()
      }
    })

    try {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (!done || chunks.length > 0) {
        if (abortController.signal.aborted) {
          break
        }
        if (chunks.length > 0) {
          yield chunks.shift()!
        }
 else if (!done) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve
          })
          resolveNext = null
        }
      }
    }
    finally {
      this.releaseTurn(sessionId, abortController)
    }

    if (!abortController.signal.aborted) {
      await commandPromise
    }

    if (streamError) {
      throw streamError
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

  private captureResultUsage(result: MessageIngressResult, fallbackModelId: string): void {
    this._lastModelId = result.model ?? fallbackModelId
    if (!result.usage) {
      this._lastUsage = null
      return
    }
    this._lastUsage = {
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    }
  }

  private resolveSkillPaths(workspacePath: string): string[] {
    if (!this.deps.resolveSkillPaths) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'resolveSkillPaths', 'System Agent provider requires resolveSkillPaths in ProviderContext'),
      )
    }
    return this.deps.resolveSkillPaths(workspacePath)
  }
}
