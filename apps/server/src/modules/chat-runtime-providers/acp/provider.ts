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
import { projectTextOnlyInput } from '../../chat-runtime/ui-message-input'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { buildAcpConnectionRecord } from './config'
import { AcpConnectionManager } from './connection-manager'
import { AcpProcessManager } from './process-manager'
import { wireAcpIntegration } from './runtime-integration'

interface AcpChatProviderDeps {
  runtime: AcpConnectionManager
}

const ACP_RUNTIME_METADATA = {
  label: 'ACP Chat',
  description: 'Cloud Agent SDK runtime',
  providerKinds: ['openai-compatible', 'anthropic', 'universal'],
  iconKey: 'custom',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 40,
} satisfies ChatRuntimeMetadata

const ACP_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: false,
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities

export function createAcpProvider(_ctx: ProviderContext, deps?: AcpChatProviderDeps): ChatRuntime {
  return new AcpChatProvider(deps ?? { runtime: createDefaultAcpRuntime() })
}

function createDefaultAcpRuntime(): AcpConnectionManager {
  const runtime = new AcpConnectionManager(new AcpProcessManager())
  wireAcpIntegration(runtime)
  return runtime
}

export class AcpChatProvider implements ChatRuntime {
  readonly runtimeKind = 'acp-chat' as const
  readonly metadata = ACP_RUNTIME_METADATA
  readonly capabilities = ACP_RUNTIME_CAPABILITIES

  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: AcpChatProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    await this.ensureConnected(profile.id, profile.configJson)
    const response = await this.deps.runtime.newSession(profile.id, input.workspacePath)

    if (input.modelId && response.sessionId) {
      try {
        await this.deps.runtime.setSessionModel(profile.id, response.sessionId, input.modelId)
      }
      catch {
        // ACP agents may reject explicit model changes and keep their default.
      }
    }

    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: this.runtimeKind,
      providerSessionId: response.sessionId,
      providerStateSnapshot: JSON.stringify({
        models: response.models ?? null,
        configOptions: response.configOptions,
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const storedSessionId = input.runtimeSession.providerSessionId
    if (!storedSessionId) {
      return this.startChatSession({
        chatSessionId: input.runtimeSession.chatSessionId,
        profile,
        workspacePath: input.workspacePath,
        modelId: input.modelId,
      })
    }

    await this.ensureConnected(profile.id, profile.configJson)

    if (this.deps.runtime.supportsResumeSession(profile.id)) {
      try {
        const response = await this.deps.runtime.resumeSession(profile.id, storedSessionId, input.workspacePath)
        return {
          ...input.runtimeSession,
          providerStateSnapshot: JSON.stringify({
            models: response.models ?? null,
            configOptions: response.configOptions,
          }),
        }
      }
      catch {
        // fall back to load/new session below
      }
    }

    if (this.deps.runtime.supportsLoadSession(profile.id)) {
      try {
        const response = await this.deps.runtime.loadSession(profile.id, storedSessionId, input.workspacePath)
        return {
          ...input.runtimeSession,
          providerStateSnapshot: JSON.stringify({
            models: response.models ?? null,
            configOptions: response.configOptions,
          }),
        }
      }
      catch {
        // fall back to new session below
      }
    }

    return this.startChatSession({
      chatSessionId: input.runtimeSession.chatSessionId,
      profile,
      workspacePath: input.workspacePath,
      modelId: input.modelId,
    })
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const acpSessionId = input.runtimeSession.providerSessionId
    if (!acpSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    await this.ensureConnected(profile.id, profile.configJson)
    this._lastUsage = null
    const userPrompt = projectTextOnlyInput(input.message, 'ACP provider')

    for await (const event of this.deps.runtime.prompt(profile.id, acpSessionId, userPrompt)) {
      yield event
    }

    this._lastUsage = this.deps.runtime.getLastUsage(profile.id, acpSessionId)
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const acpSessionId = input.runtimeSession.providerSessionId
    if (!acpSessionId) {
      return
    }

    try {
      await this.deps.runtime.cancel(profile.id, acpSessionId)
    }
    catch {
      // ACP cancel failures are non-fatal for the unified chat runtime.
    }
  }

  private async ensureConnected(agentId: string, configJson: string): Promise<void> {
    if (this.deps.runtime.isConnected(agentId)) {
      return
    }
    await this.deps.runtime.connect(agentId, buildAcpConnectionRecord(configJson))
  }
}
