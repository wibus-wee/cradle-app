import type { SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk'
import { RequestError } from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

import type {
  CancelTurnInput,
  ChatRuntime,
  ForkRuntimeSessionInput,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ListBackgroundTerminalsInput,
  ProviderContext,
  ProviderThreadDeleteInput,
  ProviderThreadDeleteResult,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TerminateBackgroundTerminalInput,
  UpdateRuntimeModeInput,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { readDurableProviderRuntimeBinding } from '../../provider-runtime/service'
import { readAcpDraftSessionId, resolveAcpConnectionRecord } from './config'
import { AcpConnectionManager } from './connection-manager'
import { projectAcpPrompt } from './input-projector'
import {
  ACP_RUNTIME_CAPABILITIES,
  ACP_RUNTIME_KIND,
  ACP_RUNTIME_METADATA,
} from './metadata'
import { createAcpPresentation, projectAcpContextUsage, projectAcpUiSlotStates } from './presentation'
import { AcpProcessManager } from './process-manager'
import { wireAcpIntegration } from './runtime-integration'

const ACP_DRAFT_SESSION_TTL_MS = 10 * 60_000
const ACP_CONNECT_RETRY_DELAYS_MS = [0, 150, 500] as const

interface AcpChatProviderDeps {
  runtime: AcpConnectionManager
}

export function createAcpProvider(ctx: ProviderContext, deps?: AcpChatProviderDeps): ChatRuntime {
  return new AcpChatProvider(deps ?? { runtime: createDefaultAcpRuntime(ctx) })
}

function createDefaultAcpRuntime(ctx: ProviderContext): AcpConnectionManager {
  const runtime = new AcpConnectionManager(new AcpProcessManager(), {
    readSecret: ctx.readSecret,
  })
  wireAcpIntegration(runtime, { deps: ctx })
  return runtime
}

export class AcpChatProvider implements ChatRuntime {
  readonly runtimeKind = ACP_RUNTIME_KIND
  readonly metadata = ACP_RUNTIME_METADATA
  readonly capabilities = ACP_RUNTIME_CAPABILITIES

  private _lastUsage: TokenUsage | null = null
  private readonly draftSessionExpiryTimers = new Map<string, NodeJS.Timeout>()

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: AcpChatProviderDeps) {}

  async listAgentAuthMethods(agentId: string) {
    const configJson = JSON.stringify({ acpAgentId: agentId })
    const { record, connectionKey } = resolveAcpConnectionRecord(configJson, `acp:${agentId}`)
    if (!this.deps.runtime.isConnected(connectionKey)) {
      await this.deps.runtime.connect(connectionKey, {
        ...record,
        authMethodId: null,
        authSecretRefs: {},
      })
    }
    return this.deps.runtime.getAuthMethods(connectionKey)
  }

  async reconnectAgent(agentId: string): Promise<void> {
    const connectionKey = `acp:${agentId}`
    await this.deps.runtime.disconnect(connectionKey)
    await this.ensureConnected(connectionKey, JSON.stringify({ acpAgentId: agentId }))
  }

  async disconnectAgent(agentId: string): Promise<void> {
    await this.deps.runtime.disconnect(`acp:${agentId}`)
  }

  async closeDraftSession(input: { agentId: string, sessionId: string }): Promise<void> {
    this.clearDraftSessionExpiry(input.sessionId)
    const connectionKey = `acp:${input.agentId}`
    if (this.deps.runtime.isConnected(connectionKey)) {
      await this.deps.runtime.disposeNativeSession(input.sessionId)
    }
  }

  async disposeSession(chatSessionId: string): Promise<void> {
    const binding = readDurableProviderRuntimeBinding(chatSessionId)
    if (binding?.runtimeKind === this.runtimeKind && binding.backendSessionId) {
      await this.deps.runtime.disposeNativeSession(binding.backendSessionId)
    }
  }

  async openDraftSession(input: { agentId: string, workspacePath: string }): Promise<{
    sessionId: string
    models: Array<{ id: string, label: string }>
    selectedModelId: string | null
  }> {
    const profileId = `acp:${input.agentId}`
    const configJson = JSON.stringify({ acpAgentId: input.agentId })
    const connectionKey = await this.ensureConnected(profileId, configJson)
    const response = await this.deps.runtime.newSession(connectionKey, input.workspacePath)
    this.scheduleDraftSessionExpiry(response.sessionId)
    const modelOption = response.configOptions.find(isAcpModelConfigOption)
    if (!modelOption) {
      return { sessionId: response.sessionId, models: [], selectedModelId: null }
    }
    return {
      sessionId: response.sessionId,
      models: flattenModelOptions(modelOption.options),
      selectedModelId: modelOption.currentValue,
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    const draftSessionId = readAcpDraftSessionId(profile.configJson)
    if (draftSessionId) { this.clearDraftSessionExpiry(draftSessionId) }
    const response = draftSessionId
      ? await this.resumeDraftSession(connectionKey, draftSessionId, input.workspacePath, input.chatSessionId)
      : await this.deps.runtime.newSession(connectionKey, input.workspacePath, input.chatSessionId)

    await this.applyRequestedModel(connectionKey, response.sessionId, input.modelId)

    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: this.runtimeKind,
      providerSessionId: response.sessionId,
      providerStateSnapshot: JSON.stringify({
        modes: response.modes ?? null,
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
        const response = await this.deps.runtime.resumeSession(
          connectionKey,
          storedSessionId,
          input.workspacePath,
          input.runtimeSession.chatSessionId,
        )
        await this.applyRequestedModel(connectionKey, storedSessionId, input.modelId)
        return {
          ...input.runtimeSession,
          providerStateSnapshot: JSON.stringify({
            modes: response.modes ?? null,
            configOptions: response.configOptions,
          }),
        }
      }
      catch (error) {
        if (!isAcpSessionFallbackError(error)) {
          throw error
        }
      }
    }

    if (this.deps.runtime.supportsLoadSession(connectionKey)) {
      try {
        const response = await this.deps.runtime.loadSession(
          connectionKey,
          storedSessionId,
          input.workspacePath,
          input.runtimeSession.chatSessionId,
        )
        await this.applyRequestedModel(connectionKey, storedSessionId, input.modelId)
        return {
          ...input.runtimeSession,
          providerStateSnapshot: JSON.stringify({
            modes: response.modes ?? null,
            configOptions: response.configOptions,
          }),
        }
      }
      catch (error) {
        if (!isAcpSessionFallbackError(error)) {
          throw error
        }
      }
    }

    return this.startChatSession({
      chatSessionId: input.runtimeSession.chatSessionId,
      profile,
      workspacePath: input.workspacePath,
      modelId: input.modelId,
    })
  }

  async forkRuntimeSession(input: ForkRuntimeSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const sourceSessionId = input.sourceRuntimeSession.providerSessionId
    if (!sourceSessionId) {
      return await this.startChatSession({
        chatSessionId: input.childChatSessionId,
        profile,
        workspacePath: input.workspacePath,
        modelId: input.modelId,
      })
    }
    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    if (!this.deps.runtime.supportsSessionFork(connectionKey)) {
      return await this.startChatSession({
        chatSessionId: input.childChatSessionId,
        profile,
        workspacePath: input.workspacePath,
        modelId: input.modelId,
      })
    }
    const response = await this.deps.runtime.forkSession(
      connectionKey,
      sourceSessionId,
      input.workspacePath,
      input.childChatSessionId,
    )
    await this.applyRequestedModel(connectionKey, response.sessionId, input.modelId)
    return {
      id: input.childChatSessionId,
      chatSessionId: input.childChatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: this.runtimeKind,
      providerSessionId: response.sessionId,
      providerStateSnapshot: JSON.stringify(response),
    }
  }

  getDraftPresentation() {
    return createAcpPresentation()
  }

  async getPresentation(input: GetCapabilitiesInput) {
    const resolved = await this.resolveConnectedSession(input)
    return createAcpPresentation(resolved.state)
  }

  async getDynamicCapabilities(input: GetCapabilitiesInput) {
    const resolved = await this.resolveConnectedSession(input)
    return {
      ...this.capabilities,
      sessionModelSwitch: resolved.state.configOptions.some(isAcpModelConfigOption)
        ? 'in-session' as const
        : 'unsupported' as const,
    }
  }

  async getUiSlotStates(input: GetUiSlotStatesInput) {
    const resolved = await this.resolveConnectedSession(input)
    return projectAcpUiSlotStates(input.runtimeSession.chatSessionId, resolved.state)
  }

  async getContextUsage(input: GetContextUsageInput) {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) { return null }
    const resolved = await this.resolveConnectedSession(input)
    return projectAcpContextUsage(providerSessionId, resolved.state)
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    const resolved = await this.resolveConnectedSession(input)
    return resolved.state.title
  }

  async updateRuntimeMode(input: UpdateRuntimeModeInput): Promise<void> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) { throw new Error('ACP session mode requires a provider session') }
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    await this.deps.runtime.setSessionMode(connectionKey, providerSessionId, input.modeId)
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    const result = await this.deps.runtime.listSessions(connectionKey, input.workspacePath, input.cursor)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: input.runtimeSession.providerSessionId,
      threads: result.sessions.map(session => ({
        id: session.sessionId,
        providerSessionTreeId: null,
        forkedFromId: null,
        preview: session.title ?? null,
        ephemeral: false,
        modelProvider: null,
        createdAt: null,
        updatedAt: session.updatedAt ? Math.floor(Date.parse(session.updatedAt) / 1000) : null,
        status: 'idle',
        sourceKind: 'unknown',
        source: session,
        threadSource: session._meta ?? null,
        agentNickname: null,
        agentRole: null,
        name: session.title ?? null,
        cwd: session.cwd,
      })),
      nextCursor: result.nextCursor ?? null,
      backwardsCursor: null,
    }
  }

  async deleteProviderThread(input: ProviderThreadDeleteInput): Promise<ProviderThreadDeleteResult> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    await this.deps.runtime.deleteSession(connectionKey, input.threadId)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: input.runtimeSession.providerSessionId,
      threadId: input.threadId,
      deleted: true,
    }
  }

  async listBackgroundTerminals(input: ListBackgroundTerminalsInput) {
    const providerSessionId = input.runtimeSession.providerSessionId
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId,
      terminals: providerSessionId ? this.deps.runtime.listTerminals(providerSessionId) : [],
      nextCursor: null,
    }
  }

  async terminateBackgroundTerminal(input: TerminateBackgroundTerminalInput) {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (providerSessionId) { await this.deps.runtime.terminateTerminal(providerSessionId, input.processId) }
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId,
      processId: input.processId,
      terminated: !!providerSessionId,
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const acpSessionId = input.runtimeSession.providerSessionId
    if (!acpSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    this._lastUsage = null
    const userPrompt = projectAcpPrompt(input.message)

    for await (const event of this.deps.runtime.prompt(connectionKey, acpSessionId, userPrompt, {
      chatSessionId: input.runtimeSession.chatSessionId,
      runId: input.runId,
      providerKind: profile.providerKind ?? 'universal',
      runtimeKind: this.runtimeKind,
    })) {
      if (event.type === 'finish') {
        this._lastUsage = this.deps.runtime.getLastUsage(connectionKey, acpSessionId)
      }
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
      let lastError: unknown
      for (const delayMs of ACP_CONNECT_RETRY_DELAYS_MS) {
        if (delayMs > 0) { await delay(delayMs) }
        try {
          await this.deps.runtime.connect(connectionKey, record)
          lastError = null
          break
        }
        catch (error) {
          lastError = error
          if (error instanceof ProviderRuntimeError
            && (error.providerError._tag === 'auth_required' || error.providerError._tag === 'auth_failed')) {
            throw error
          }
        }
      }
      if (lastError) { throw lastError }
    }
    return connectionKey
  }

  private scheduleDraftSessionExpiry(sessionId: string): void {
    this.clearDraftSessionExpiry(sessionId)
    const timer = setTimeout(() => {
      this.draftSessionExpiryTimers.delete(sessionId)
      void this.deps.runtime.disposeNativeSession(sessionId)
    }, ACP_DRAFT_SESSION_TTL_MS)
    timer.unref()
    this.draftSessionExpiryTimers.set(sessionId, timer)
  }

  private clearDraftSessionExpiry(sessionId: string): void {
    const timer = this.draftSessionExpiryTimers.get(sessionId)
    if (timer) { clearTimeout(timer) }
    this.draftSessionExpiryTimers.delete(sessionId)
  }

  private async resolveConnectedSession(input: GetCapabilitiesInput) {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) { throw new Error('ACP provider session is unavailable') }
    const connectionKey = await this.ensureConnected(profile.id, profile.configJson)
    const state = this.deps.runtime.getSessionState(connectionKey, providerSessionId)
    if (!state) { throw new Error(`ACP session ${providerSessionId} is not loaded`) }
    return { connectionKey, providerSessionId, state }
  }

  private async resumeDraftSession(
    connectionKey: string,
    sessionId: string,
    workspacePath: string,
    chatSessionId: string,
  ): Promise<{
    sessionId: string
    modes: SessionModeState | null
    configOptions: SessionConfigOption[]
  }> {
    const state = this.deps.runtime.getSessionState(connectionKey, sessionId)
    if (state) {
      return { sessionId, ...state }
    }
    if (this.deps.runtime.supportsResumeSession(connectionKey)) {
      const response = await this.deps.runtime.resumeSession(connectionKey, sessionId, workspacePath, chatSessionId)
      return { sessionId, modes: response.modes, configOptions: response.configOptions }
    }
    if (this.deps.runtime.supportsLoadSession(connectionKey)) {
      const response = await this.deps.runtime.loadSession(connectionKey, sessionId, workspacePath, chatSessionId)
      return { sessionId, modes: response.modes, configOptions: response.configOptions }
    }
    return await this.deps.runtime.newSession(connectionKey, workspacePath, chatSessionId)
  }

  private async applyRequestedModel(connectionKey: string, sessionId: string, modelId: string | null | undefined): Promise<void> {
    if (!modelId) {
      return
    }
    await this.deps.runtime.setSessionModel(connectionKey, sessionId, modelId)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isAcpSessionFallbackError(error: unknown): boolean {
  let current: unknown = error
  while (current instanceof Error) {
    if (current instanceof RequestError) {
      return current.code === -32601 || current.code === -32002
    }
    current = current.cause
  }
  return false
}

function flattenModelOptions(options: Array<{ value: string, name: string } | { name: string, options: Array<{ value: string, name: string }> }>): Array<{ id: string, label: string }> {
  return options.flatMap(option => 'options' in option
    ? option.options.map(item => ({ id: item.value, label: item.name }))
    : [{ id: option.value, label: option.name }])
}

function isAcpModelConfigOption(option: SessionConfigOption): option is Extract<SessionConfigOption, { type: 'select' }> {
  return option.type === 'select' && option.category === 'model'
}
