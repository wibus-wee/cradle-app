import type { UIMessageChunk } from 'ai'

import type {
  CancelTurnInput,
  ChatRuntime,
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
import { projectTextOnlyInput } from '../kit/input-projector'
import { resolveAcpConnectionRecord } from './config'
import { AcpConnectionManager } from './connection-manager'
import {
  ACP_RUNTIME_CAPABILITIES,
  ACP_RUNTIME_KIND,
  ACP_RUNTIME_METADATA,
} from './metadata'
import { AcpProcessManager } from './process-manager'
import { wireAcpIntegration } from './runtime-integration'

interface AcpChatProviderDeps {
  runtime: AcpConnectionManager
}

export function createAcpProvider(ctx: ProviderContext, deps?: AcpChatProviderDeps): ChatRuntime {
  return new AcpChatProvider(deps ?? { runtime: createDefaultAcpRuntime(ctx) })
}

function createDefaultAcpRuntime(ctx: ProviderContext): AcpConnectionManager {
  const runtime = new AcpConnectionManager(new AcpProcessManager())
  wireAcpIntegration(runtime, { deps: ctx })
  return runtime
}

export class AcpChatProvider implements ChatRuntime {
  readonly runtimeKind = ACP_RUNTIME_KIND
  readonly metadata = ACP_RUNTIME_METADATA
  readonly capabilities = ACP_RUNTIME_CAPABILITIES

  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: AcpChatProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    const response = await this.deps.runtime.newSession(connectionKey, input.workspacePath)

    if (input.modelId && response.sessionId) {
      try {
        await this.deps.runtime.setSessionModel(connectionKey, response.sessionId, input.modelId)
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

    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)

    if (this.deps.runtime.supportsResumeSession(connectionKey)) {
      try {
        const response = await this.deps.runtime.resumeSession(connectionKey, storedSessionId, input.workspacePath)
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

    if (this.deps.runtime.supportsLoadSession(connectionKey)) {
      try {
        const response = await this.deps.runtime.loadSession(connectionKey, storedSessionId, input.workspacePath)
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

    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    this._lastUsage = null
    const userPrompt = projectTextOnlyInput(input.message, 'ACP provider')

    for await (const event of this.deps.runtime.prompt(connectionKey, acpSessionId, userPrompt, {
      chatSessionId: input.runtimeSession.chatSessionId,
      runId: input.runId,
      providerKind: profile.providerKind ?? 'universal',
      runtimeKind: this.runtimeKind,
    })) {
      yield event
    }

    this._lastUsage = this.deps.runtime.getLastUsage(connectionKey, acpSessionId)
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const acpSessionId = input.runtimeSession.providerSessionId
    if (!acpSessionId) {
      return
    }

    try {
      const { connectionKey } = resolveAcpConnectionRecord(profile.configJson, profile.id)
      await this.deps.runtime.cancel(connectionKey, acpSessionId)
    }
    catch {
      // ACP cancel failures are non-fatal for the unified chat runtime.
    }
  }

  private async ensureConnected(profileId: string, configJson: string): Promise<string> {
    const { record, connectionKey } = resolveAcpConnectionRecord(configJson, profileId)
    if (!this.deps.runtime.isConnected(connectionKey)) {
      await this.deps.runtime.connect(connectionKey, record)
    }
    return connectionKey
  }
}
