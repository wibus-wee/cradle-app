import { randomUUID } from 'node:crypto'

import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { ProviderMetadata, UIMessage, UIMessageChunk } from 'ai'

import { readObjectRecord as readRecord } from '../../../helpers/json-record'
import { aiTelemetryEnabled } from '../../../telemetry/config'
import {
  markHarnessFragmentsProjected,
  resolvePendingHarnessFragments,
} from '../../chat-runtime/harness/provider-state'
import type {
  BackgroundTerminalListResult,
  BackgroundTerminalTerminateResult,
  CancelTurnInput,
  ChatRuntime,
  ExecuteShellCommandInput,
  ExecuteShellCommandResult,
  ForkRuntimeSessionInput,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ListBackgroundTerminalsInput,
  ProviderContext,
  ProviderThread,
  ProviderThreadDeleteInput,
  ProviderThreadDeleteResult,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadSourceKind,
  ProviderThreadTurn,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  QuickQuestionInput,
  ResumeChatSessionInput,
  RollbackLastTurnInput,
  RollbackLastTurnResult,
  RuntimeBackgroundTerminal,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeSession,
  RuntimeUiSlotState,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
  TerminateBackgroundTerminalInput,
  TokenUsage,
  UpdateRuntimeSettingsInput,
  UpdateRuntimeTurnSettingsInput,
  UpdateRuntimeTurnSettingsResult,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import { readCodexLikeRuntimeSettings } from '../../chat-runtime/runtime-settings'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import { readTrustedCodexConfig } from '../../provider-contracts/provider-base'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { requestProviderToolApproval } from '../kit/permission-bridge'
import { readWorkspaceProviderStateSnapshot } from '../kit/state-snapshot'
import type {
  CodexAppServerCapabilityManifest,
  CodexAppServerInvokeInput,
  CodexAppServerInvokeResponse,
  CodexAppServerStreamInput,
} from './app-server/bridge'
import {
  buildDefaultCodexAppServerRequestResult,
  CodexAppServerBridge,
  getCodexAppServerCapabilities,
} from './app-server/bridge'
import type { CodexAppServerAuthCarrier, CodexAppServerAuthResolution, CodexChatgptAuthCredential } from './app-server/chatgpt-auth'
import {
  readCodexApiKeyAuth,
  readCodexChatgptAuth,
  resolveCodexAppServerAuth,
} from './app-server/chatgpt-auth'
import type { CodexAppServerClientOptions, CodexAppServerMessage } from './app-server/client'
import { buildCodexAppServerEnv } from './app-server/env'
import type { CodexAppServerHostLease } from './app-server/host-lease'
import { acquireCodexAppServerHostLease } from './app-server/host-lease'
import {
  isCodexAppServerToolApprovalRequest,
  isCodexAppServerUserInputRequest,
} from './app-server/server-request-methods'
import type { ReviewStartResponse } from './app-server-protocol/v2/ReviewStartResponse'
import type { Thread } from './app-server-protocol/v2/Thread'
import type { ThreadBackgroundTerminal } from './app-server-protocol/v2/ThreadBackgroundTerminal'
import type { ThreadBackgroundTerminalsListResponse } from './app-server-protocol/v2/ThreadBackgroundTerminalsListResponse'
import type { ThreadBackgroundTerminalsTerminateResponse } from './app-server-protocol/v2/ThreadBackgroundTerminalsTerminateResponse'
import type { ThreadForkParams } from './app-server-protocol/v2/ThreadForkParams'
import type { ThreadListParams } from './app-server-protocol/v2/ThreadListParams'
import type { ThreadListResponse } from './app-server-protocol/v2/ThreadListResponse'
import type { ThreadReadResponse } from './app-server-protocol/v2/ThreadReadResponse'
import type { ThreadSourceKind } from './app-server-protocol/v2/ThreadSourceKind'
import type { ThreadTurnsListResponse } from './app-server-protocol/v2/ThreadTurnsListResponse'
import type { Turn } from './app-server-protocol/v2/Turn'
import type { TurnSettingsUpdateResponse } from './app-server-protocol/v2/TurnSettingsUpdateResponse'
import type { UserInput } from './app-server-protocol/v2/UserInput'
import {
  bindCodexCradleMcpInvocation,
  buildCodexCollaborationMode,
  buildCodexConfig,
  codexConfigRequiresApiKey,
  projectCodexRuntimeAccessMode,
  resolveCodexSkillExtraRoots,
} from './config/runtime-config'
import { resolveCodexRuntimeContext } from './config/runtime-context'
import { toSandboxPolicy } from './config/sandbox-policy'
import { createCodexGoalContinuation } from './goal-continuation'
import { readLocalImageDataUrl } from './local-image-data-url'
import {
  CODEX_RUNTIME_CAPABILITIES,
  CODEX_RUNTIME_KIND as RUNTIME_KIND,
  CODEX_RUNTIME_METADATA,
} from './metadata'
import { createCodexRuntimePresentation } from './presentation'
import {
  clearCodexGoalSnapshot,
  hasActiveGoal,
  pauseCodexGoalSnapshot,
  projectCodexGoalSnapshotFromGoal,
  projectCodexProviderStateSnapshot,
  readCodexLastTokenUsage,
  readCodexProviderSnapshot,
  writeCodexGoalSnapshot,
  writeCodexThreadSnapshot,
} from './projection/state-projector'
import { projectCodexUiSlotStates, readCodexCrewState } from './projection/ui-slot-projector'
import { codexRequestError, formatUnknownError } from './provider-errors'
import { decodeCodexDurableCheckpoint } from './state/durable-checkpoint'
import type { CodexAppServerItem } from './tools/mapper'
import { buildCodexToolInput, buildCodexToolOutput, readCodexToolError, readCodexToolName } from './tools/mapper'
import { CodexActiveTurnRegistry } from './turn/active-turn-registry'
import {
  buildCodexMcpElicitationResponse,
  readCodexMcpElicitationQuestions,
  readCodexUserInputQuestions,
} from './turn/elicitation'
import {
  createCodexAppServerMapperState,
} from './turn/event-to-chunk-mapper'
import {
  describeCodexUserInput,
  projectCodexUserInput,
} from './turn/input-projector'
import { waitForCodexShellCommandCompletion } from './turn/shell-command'
import {
  createCodexEmptyStreamError,
  createCodexStreamDiagnostics,
  getNotificationTurnId,
  getTurnId,
  normalizeProviderTitle,
  readLatestThreadTitle,
  readThreadNameUpdate,
  validateCodexStreamOutput,
} from './turn/stream-diagnostics'
import {
  closeCodexMappedTurnChunks,
  continueActiveGoal,
  isCompletedGoalUpdate,
  publishProviderThreadEvent,
  streamCodexMappedTurnEvents,
} from './turn/stream-handler'
import type { CodexStreamTurnContext } from './turn/stream-turn-context'
import { resolveCodexStreamTurnContext } from './turn/stream-turn-context'
import {
  injectCodexHarnessFragments,
  injectCodexSideBoundary,
  injectCradleTranscriptHistory,
  markCodexThreadLoaded,
  readLiveSideForkThreadStart,
  requestCodexAppServerWithTimeout,
  startOrResumeThread,
  syncCodexSkillExtraRoots,
} from './turn/thread-lifecycle'
import type { CodexTitleGenerationThinkingEffort } from './turn/title-generation'
import {
  buildCodexTitleConfig,
  generateAndSetCodexThreadTitle,
  generateAndSetCodexThreadTitleOrThrow,
  setCodexThreadGoal,
  shouldGenerateCodexThreadTitle,
} from './turn/title-generation'
import type {
  ActiveCodexTurn,
  CodexAppServerClientLike,
  CodexAppServerResourceRequestHandler,
  CodexAppsListResponse,
  CodexCollaborationModeListResponse,
  CodexConfigReadResponse,
  CodexConfigRequirementsReadResponse,
  CodexListMcpServerStatusResponse,
  CodexModelListResponse,
  CodexModelProviderCapabilitiesReadResponse,
  CodexPluginListResponse,
  CodexProviderConfig,
  CodexProviderDeps,
  CodexRateLimitsResponse,
  CodexSkillsListResponse,
  CodexUiSlotHostFacts,
  CodexUiSlotThreadFacts,
  ThreadGoalGetResponse,
  ThreadResponse,
  ThreadTokenUsageUpdatedNotificationParams,
  TurnResponse,
} from './types'
import { CodexUsageEventProjector } from './usage-event-projector'

const CODEX_EPHEMERAL_REQUEST_TIMEOUT_MS = 20_000

export function createCodexProvider(ctx: ProviderContext, config: CodexProviderConfig = {}): CodexProvider {
  return new CodexProvider({ ...ctx, ...config })
}

type CodexStreamThreadStart = Awaited<ReturnType<typeof startOrResumeThread>>
type CodexStreamOutputCollector = ReturnType<typeof createBoundedTextCollector>

interface CodexStreamThreadContext {
  threadId: string
  threadStart: CodexStreamThreadStart
}

interface CodexStreamDispatchResult {
  turnId: string | null
  shouldStream: boolean
}

export class CodexProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND
  readonly usageAccounting = 'provider-events' as const
  readonly metadata = CODEX_RUNTIME_METADATA
  readonly capabilities = CODEX_RUNTIME_CAPABILITIES
  readonly goalContinuation = createCodexGoalContinuation()

  private readonly activeTurns = new CodexActiveTurnRegistry()
  private _lastUsage: TokenUsage | null = null
  private _lastModelId: string | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastModelId(): string | null {
    return this._lastModelId
  }

  constructor(private readonly deps: CodexProviderDeps) {}

  private readonly resolveSkillPaths = (workspacePath: string): string[] => {
    if (!this.deps.resolveSkillPaths) {
      throw codexRequestError('resolveSkillPaths', 'Codex provider requires resolveSkillPaths in ProviderContext')
    }
    return this.deps.resolveSkillPaths(workspacePath)
  }

  private recordObservability(input: Parameters<NonNullable<ProviderContext['recordObservability']>>[0]): void {
    if (!this.deps.recordObservability) {
      return
    }
    this.deps.recordObservability(input)
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const runtimeContext = resolveCodexRuntimeContext(input.workspacePath, input.agentId)
    const checkpoint = decodeCodexDurableCheckpoint(JSON.stringify({
      workspacePath: input.workspacePath,
      agentId: input.agentId ?? null,
      agentHome: runtimeContext.agentHome,
      models: { currentModelId: input.modelId },
    }))
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: checkpoint.serialized,
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const decoded = decodeCodexDurableCheckpoint(input.runtimeSession.providerStateSnapshot)
    const snapshot = decoded.checkpoint
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(input.workspacePath, agentId)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        agentId,
        agentHome: runtimeContext.agentHome,
        models: {
          currentModelId: input.modelId ?? snapshot.models.currentModelId,
        },
      }),
    }
  }

  async forkRuntimeSession(input: ForkRuntimeSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    if (!input.sourceRuntimeSession.providerSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.sourceRuntimeSession.chatSessionId))
    }

    const config = readTrustedCodexConfig(profile.configJson)
    const auth = this.resolveAppServerAuth(profile, config)
    if (codexConfigRequiresApiKey(config, auth)) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.sourceRuntimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, this.resolveSkillPaths)
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, effectiveModel, auth)
    const chatgptAuth = readCodexChatgptAuth(auth)
    const codexEnv = buildCodexAppServerEnv({
      chatSessionId: input.childChatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
    }, auth)
    const threadCodexConfig = bindCodexCradleMcpInvocation(codexConfig, codexEnv)
    let forkThreadId = input.sourceRuntimeSession.providerSessionId
    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: profile.providerTargetId,
      chatgptAuth,
      pinned: true,
      readThreadId: () => forkThreadId,
      options: {
        apiKey: readCodexApiKeyAuth(auth) ?? undefined,
        config: threadCodexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth,
          readSecret: this.deps.readSecret,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.client
    let leaseTransferred = false

    try {
      await syncCodexSkillExtraRoots(hostLease.resource, skillExtraRoots)
      await startOrResumeThread(client, hostLease.resource, input.sourceRuntimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: config.sandboxMode,
        config: threadCodexConfig,
      })
      const forkParams: ThreadForkParams = {
        threadId: input.sourceRuntimeSession.providerSessionId,
        path: null,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: config.sandboxMode,
        config: threadCodexConfig,
        model: effectiveModel ?? null,
        ephemeral: true,
        threadSource: 'user',
        excludeTurns: true,
      }
      const response = await client.request('thread/fork', forkParams) as ThreadResponse
      const threadId = response.thread?.id
      if (!threadId) {
        throw codexRequestError('forkRuntimeSession', 'Codex app-server did not return a forked thread id')
      }
      forkThreadId = threadId
      markCodexThreadLoaded(hostLease.resource, threadId)

      await injectCodexSideBoundary(client, threadId)

      const runtimeSession: RuntimeSession = {
        id: input.childChatSessionId,
        chatSessionId: input.childChatSessionId,
        providerTargetId: profile.providerTargetId,
        runtimeKind: RUNTIME_KIND,
        providerSessionId: threadId,
        providerRuntimeLease: hostLease,
        providerStateSnapshot: JSON.stringify({
          workspacePath,
          agentId,
          agentHome: runtimeContext.agentHome,
          models: { currentModelId: response.model ?? effectiveModel ?? null },
          codex: {
            sideConversation: {
              threadId,
              liveFork: true,
              parentThreadId: input.sourceRuntimeSession.providerSessionId,
              updatedAt: Date.now(),
            },
          },
        }),
      }
      writeCodexThreadSnapshot(runtimeSession, {
        threadId,
        modelId: response.model ?? effectiveModel ?? null,
        modelProvider: response.modelProvider ?? response.thread?.modelProvider ?? null,
        serviceTier: response.serviceTier ?? null,
        reasoningEffort: response.reasoningEffort ?? null,
        status: response.thread?.status ?? null,
      })
      leaseTransferred = true
      return runtimeSession
    }
    finally {
      if (!leaseTransferred) {
        hostLease.release()
      }
    }
  }

  async* quickQuestion(input: QuickQuestionInput): AsyncGenerator<UIMessageChunk, void, void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedCodexConfig(profile.configJson)
    const auth = this.resolveAppServerAuth(profile, config)

    if (codexConfigRequiresApiKey(config, auth)) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, snapshot.agentId ?? null)
    const effectiveModel = snapshot.models.currentModelId ?? config.model

    // Build minimal codex config for quick question. It still receives the full
    // transcript below, but it must not initialize tool or skill surfaces.
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, effectiveModel, auth)
    codexConfig.mcp = false
    codexConfig.use_bash = false
    delete codexConfig.mcp_servers

    const chatgptAuth = readCodexChatgptAuth(auth)
    const codexEnv = buildCodexAppServerEnv({
      chatSessionId: input.runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId: snapshot.agentId ?? null,
      agentHome: runtimeContext.agentHome,
    }, auth)
    const threadCodexConfig = bindCodexCradleMcpInvocation(codexConfig, codexEnv)
    let quickQuestionThreadId: string | null = null

    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: profile.providerTargetId,
      chatgptAuth,
      pinned: false,
      readThreadId: () => quickQuestionThreadId,
      options: {
        apiKey: readCodexApiKeyAuth(auth) ?? undefined,
        config: threadCodexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth,
          readSecret: this.deps.readSecret,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.client
    const abortController = new AbortController()
    const diagnostics = createCodexStreamDiagnostics()

    try {
      // Create ephemeral thread for this quick question
      let threadResponse: ThreadResponse
      try {
        threadResponse = await requestCodexAppServerWithTimeout(client, 'thread/start', {
          path: null,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: config.approvalPolicy,
          approvalsReviewer: 'user',
          sandbox: config.sandboxMode,
          config: threadCodexConfig,
          model: effectiveModel ?? null,
          ephemeral: true,
          threadSource: 'user',
        }, CODEX_EPHEMERAL_REQUEST_TIMEOUT_MS)
      }
      catch (error) {
        throw codexRequestError('thread/start', formatUnknownError(error))
      }

      const threadId = threadResponse.thread?.id
      if (!threadId) {
        throw codexRequestError('quickQuestion', 'Failed to create ephemeral thread')
      }
      quickQuestionThreadId = threadId
      markCodexThreadLoaded(hostLease.resource, threadId)

      // Inject transcript history to reuse prompt cache
      await injectCradleTranscriptHistory(client, threadId, input.transcript)

      // Submit the quick question
      const userInput = projectCodexUserInput(input.question, 'QuickQuestion')
      let turnResponse: TurnResponse
      try {
        turnResponse = await requestCodexAppServerWithTimeout(client, 'turn/start', {
          threadId,
          input: userInput,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: config.approvalPolicy,
          approvalsReviewer: 'user',
          sandboxPolicy: toSandboxPolicy(config.sandboxMode, runtimeContext.runtimeWorkspaceRoots, config.additionalDirectories),
          model: effectiveModel,
          effort: null,
        }, CODEX_EPHEMERAL_REQUEST_TIMEOUT_MS)
      }
      catch (error) {
        throw codexRequestError('turn/start', formatUnknownError(error))
      }

      const turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
      const textItemId = randomUUID()
      const mapperState = createCodexAppServerMapperState(textItemId)

      for await (const event of streamCodexMappedTurnEvents({
        client,
        threadId,
        turnId,
        signal: abortController.signal,
        mapperState,
        diagnostics,
        readGoal: () => null,
      })) {
        for (const chunk of event.chunks) {
          yield chunk
        }
      }

      for (const chunk of closeCodexMappedTurnChunks(mapperState, diagnostics)) {
        yield chunk
      }
    }
    finally {
      abortController.abort()
      hostLease.release()
    }
  }

  async getPresentation(_input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    return createCodexRuntimePresentation()
  }

  getDraftPresentation(): RuntimePresentationCapabilities {
    return createCodexRuntimePresentation()
  }

  getCodexAppServerCapabilities(): CodexAppServerCapabilityManifest {
    return getCodexAppServerCapabilities()
  }

  async getContextUsage(_input: GetContextUsageInput): Promise<RuntimeContextUsage | null> {
    return null
  }

  async invokeCodexAppServer(
    input: CodexAppServerInvokeInput,
  ): Promise<CodexAppServerInvokeResponse> {
    const response = await this.createAppServerBridge().invoke({
      ...input,
      modelId: input.modelId ?? undefined,
    })
    syncCodexAppServerSnapshot(input, response.result)
    return response
  }

  openCodexAppServerStream(input: CodexAppServerStreamInput): ReadableStream<Uint8Array> {
    return this.createAppServerBridge().openEventStream({
      ...input,
      modelId: input.modelId ?? undefined,
    })
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedCodexConfig(profile.configJson)
    const auth = this.resolveAppServerAuth(profile, config)
    if (codexConfigRequiresApiKey(config, auth)) {
      return []
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, this.resolveSkillPaths)
    const runtimeSession = input.runtimeSession.providerSessionId
      ? input.runtimeSession
      : await this.resumeChatSession({
          runtimeSession: {
            ...input.runtimeSession,
            providerSessionId: null,
          },
          profile,
          workspacePath: input.workspacePath,
          agentId: input.agentId,
          modelId: input.modelId,
        })
    if (!runtimeSession.providerSessionId) {
      return []
    }
    const chatgptAuth = readCodexChatgptAuth(auth)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId
    const codexEnv = buildCodexAppServerEnv({
      chatSessionId: input.runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
    }, auth)
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, effectiveModel, auth)
    const threadCodexConfig = bindCodexCradleMcpInvocation(codexConfig, codexEnv)
    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: profile.providerTargetId,
      chatgptAuth,
      readThreadId: () => runtimeSession.providerSessionId,
      options: {
        apiKey: readCodexApiKeyAuth(auth) ?? undefined,
        config: threadCodexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth,
          readSecret: this.deps.readSecret,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.client

    try {
      await syncCodexSkillExtraRoots(hostLease.resource, skillExtraRoots)
      await startOrResumeThread(client, hostLease.resource, runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: config.sandboxMode,
        config: threadCodexConfig,
      })
      hostLease.resource.uiSlotHostFacts ??= loadCodexUiSlotHostFacts(client, runtimeContext.cwd)
      const hostFacts = await hostLease.resource.uiSlotHostFacts
      let threadFactsPromise = hostLease.resource.uiSlotThreadFacts.get(runtimeSession.providerSessionId)
      if (!threadFactsPromise) {
        threadFactsPromise = loadCodexUiSlotThreadFacts(
          client,
          runtimeSession.providerSessionId,
          runtimeSession.providerStateSnapshot,
          hostFacts.collaborationModes,
        )
        hostLease.resource.uiSlotThreadFacts.set(runtimeSession.providerSessionId, threadFactsPromise)
      }
      const threadFacts = await threadFactsPromise
      return await projectCodexUiSlotStates({
        client,
        threadId: runtimeSession.providerSessionId,
        providerStateSnapshot: runtimeSession.providerStateSnapshot,
        goal: threadFacts.goal,
        configResponse: hostFacts.configResponse,
        providerCapabilities: hostFacts.providerCapabilities,
        modelList: hostFacts.modelList,
        mcpStatus: threadFacts.mcpStatus,
        rateLimits: hostFacts.rateLimits,
        configRequirements: hostFacts.configRequirements,
        skills: hostFacts.skills,
        plugins: hostFacts.plugins,
        apps: hostFacts.apps,
        collaborationModes: hostFacts.collaborationModes,
        backgroundTerminals: threadFacts.backgroundTerminals,
        crewState: threadFacts.crewState,
      })
    }
    catch {
      return []
    }
    finally {
      hostLease.release()
    }
  }

  async listBackgroundTerminals(input: ListBackgroundTerminalsInput): Promise<BackgroundTerminalListResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const response = await context.client.request('thread/backgroundTerminals/list', {
        threadId: context.runtimeSession.providerSessionId,
        cursor: input.cursor ?? null,
        limit: input.limit ?? 20,
      }) as ThreadBackgroundTerminalsListResponse
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        terminals: projectCodexBackgroundTerminals(response.data),
        nextCursor: response.nextCursor,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async terminateBackgroundTerminal(input: TerminateBackgroundTerminalInput): Promise<BackgroundTerminalTerminateResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const response = await context.client.request('thread/backgroundTerminals/terminate', {
        threadId: context.runtimeSession.providerSessionId,
        processId: input.processId,
      }) as ThreadBackgroundTerminalsTerminateResponse
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        processId: input.processId,
        terminated: response.terminated,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const context = await this.createProviderThreadClient(input)
    const parentThreadId = context.runtimeSession.providerSessionId
    if (!parentThreadId) {
      context.hostLease.release()
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: null,
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      }
    }

    try {
      const parent = await context.client.request('thread/read', {
        threadId: parentThreadId,
        includeTurns: false,
      }) as ThreadReadResponse
      const parentThread = parent.thread
      const params: ThreadListParams = {
        cursor: input.cursor ?? null,
        limit: input.limit ?? 50,
        sortKey: input.sortKey ?? 'updated_at',
        sortDirection: input.sortDirection ?? 'desc',
        sourceKinds: input.sourceKinds?.map(toCodexThreadSourceKind) ?? ['subAgentThreadSpawn'],
        archived: input.archived ?? false,
        cwd: context.workspacePath,
        searchTerm: input.searchTerm ?? null,
      }
      const response = await context.client.request('thread/list', params) as ThreadListResponse
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: parentThreadId,
        threads: (response.data ?? [])
          .filter(thread => codexThreadBelongsToRuntimeParent(parentThread, thread))
          .map(projectCodexThread),
        nextCursor: response.nextCursor ?? null,
        backwardsCursor: response.backwardsCursor ?? null,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const response = await context.client.request('thread/read', {
        threadId: input.threadId,
        includeTurns: input.includeTurns ?? false,
      }) as ThreadReadResponse
      await assertCodexThreadBelongsToRuntimeSession(context.client, context.runtimeSession.providerSessionId, response.thread)
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        thread: projectCodexThread(response.thread),
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async deleteProviderThread(input: ProviderThreadDeleteInput): Promise<ProviderThreadDeleteResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      if (input.threadId === context.runtimeSession.providerSessionId) {
        throw codexRequestError('thread/delete', 'Cannot delete the parent runtime thread through the provider-thread API')
      }
      const response = await context.client.request('thread/read', {
        threadId: input.threadId,
        includeTurns: false,
      }) as ThreadReadResponse
      await assertCodexThreadBelongsToRuntimeSession(context.client, context.runtimeSession.providerSessionId, response.thread)
      await context.client.request('thread/delete', { threadId: input.threadId })
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        threadId: input.threadId,
        deleted: true,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async deleteSessionStorage(input: GetCapabilitiesInput) {
    const threadId = input.runtimeSession.providerSessionId
    if (!threadId) {
      return { status: 'not_applicable' as const }
    }
    const context = await this.createProviderThreadClient(input)
    try {
      await context.client.request('thread/delete', { threadId })
      context.hostLease.resource.loadedThreadIds.delete(threadId)
      context.hostLease.resource.uiSlotThreadFacts.delete(threadId)
      return { status: 'deleted' as const }
    }
    finally {
      context.hostLease.release()
    }
  }

  async listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const threadResponse = await context.client.request('thread/read', {
        threadId: input.threadId,
        includeTurns: false,
      }) as ThreadReadResponse
      await assertCodexThreadBelongsToRuntimeSession(context.client, context.runtimeSession.providerSessionId, threadResponse.thread)
      const response = await context.client.request('thread/turns/list', {
        threadId: input.threadId,
        cursor: input.cursor ?? null,
        limit: input.limit ?? 50,
        sortDirection: input.sortDirection ?? 'asc',
        itemsView: 'full',
      }) as ThreadTurnsListResponse
      const turns = response.data ?? []
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        threadId: input.threadId,
        turns: turns.map(projectCodexTurn),
        messages: projectCodexTurnsToUiMessages(input.threadId, turns),
        nextCursor: response.nextCursor ?? null,
        backwardsCursor: response.backwardsCursor ?? null,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async rollbackLastTurn(input: RollbackLastTurnInput): Promise<RollbackLastTurnResult> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) {
      throw new ProviderRuntimeError(
        ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId),
      )
    }

    const context = await this.createProviderThreadClient(input)
    try {
      const turnsResponse = await context.client.request('thread/turns/list', {
        threadId: providerSessionId,
        cursor: null,
        limit: input.numTurns,
        sortDirection: 'desc',
        itemsView: 'summary',
      }) as ThreadTurnsListResponse
      const turns = turnsResponse.data ?? []
      const oldestTargetedTurn = turns[input.numTurns - 1]
      if (!oldestTargetedTurn) {
        throw new ProviderRuntimeError(ProviderErrors.requestFailed(
          this.runtimeKind,
          'rollbackLastTurn',
          `Codex returned ${turns.length} turn(s), fewer than the requested ${input.numTurns}`,
        ))
      }
      const response = await context.client.request('thread/revert', {
        threadId: providerSessionId,
        beforeTurnId: oldestTargetedTurn.id,
      })
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId,
        rolledBackTurns: input.numTurns,
        fileChangesReverted: false,
        providerResult: response,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  private async createProviderThreadClient(input: GetCapabilitiesInput): Promise<{
    client: CodexAppServerClientLike
    hostLease: CodexAppServerHostLease
    runtimeSession: RuntimeSession
    workspacePath: string
  }> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedCodexConfig(profile.configJson)
    const auth = this.resolveAppServerAuth(profile, config)
    if (codexConfigRequiresApiKey(config, auth)) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const runtimeSession = input.runtimeSession.providerSessionId
      ? input.runtimeSession
      : await this.resumeChatSession({
          runtimeSession: input.runtimeSession,
          profile,
          workspacePath,
          agentId,
          modelId: input.modelId,
        })

    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, effectiveModel, auth)
    const codexEnv = buildCodexAppServerEnv({
      chatSessionId: runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
    }, auth)
    const threadCodexConfig = bindCodexCradleMcpInvocation(codexConfig, codexEnv)
    const chatgptAuth = readCodexChatgptAuth(auth)
    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: profile.providerTargetId,
      chatgptAuth,
      readThreadId: () => runtimeSession.providerSessionId,
      options: {
        apiKey: readCodexApiKeyAuth(auth) ?? undefined,
        config: threadCodexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth,
          readSecret: this.deps.readSecret,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    try {
      await startOrResumeThread(hostLease.client, hostLease.resource, runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: config.sandboxMode,
        config: threadCodexConfig,
      })
      return { client: hostLease.client, hostLease, runtimeSession, workspacePath }
    }
    catch (error) {
      hostLease.release()
      throw error
    }
  }

  async executeShellCommand(input: ExecuteShellCommandInput): Promise<ExecuteShellCommandResult> {
    const command = input.command.trim()
    if (!command) {
      throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'executeShellCommand', 'Codex shell command must not be empty'))
    }

    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedCodexConfig(profile.configJson)
    const auth = this.resolveAppServerAuth(profile, config)
    if (codexConfigRequiresApiKey(config, auth)) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, this.resolveSkillPaths)
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, effectiveModel, auth)
    const chatgptAuth = readCodexChatgptAuth(auth)
    const codexEnv = buildCodexAppServerEnv({
      chatSessionId: input.runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
    }, auth)
    const threadCodexConfig = bindCodexCradleMcpInvocation(codexConfig, codexEnv)
    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: profile.providerTargetId,
      chatgptAuth,
      readThreadId: () => input.runtimeSession.providerSessionId,
      options: {
        apiKey: readCodexApiKeyAuth(auth) ?? undefined,
        config: threadCodexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth,
          readSecret: this.deps.readSecret,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.client
    const startedAt = Date.now()

    try {
      await syncCodexSkillExtraRoots(hostLease.resource, skillExtraRoots)
      const threadStart = await startOrResumeThread(client, hostLease.resource, input.runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: config.sandboxMode,
        config: threadCodexConfig,
      })
      const threadId = threadStart.threadId
      input.runtimeSession.providerSessionId = threadId
      this._lastModelId = threadStart.modelId ?? effectiveModel ?? null
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)

      await client.request('thread/shellCommand', { threadId, command })
      const result = await waitForCodexShellCommandCompletion(client, {
        threadId,
        command,
        signal: input.signal,
      })
      const output = result.item.aggregatedOutput ?? result.output ?? ''
      return {
        command: result.item.command ?? command,
        stdout: output,
        stderr: '',
        exitCode: result.item.exitCode ?? null,
        durationMs: result.item.durationMs ?? Math.max(0, Date.now() - startedAt),
        timedOut: false,
        truncated: output.endsWith('...<truncated>'),
      }
    }
    finally {
      hostLease.release()
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const context = resolveCodexStreamTurnContext(input, {
      runtimeKind: this.runtimeKind,
      resolveAppServerAuth: (profile, config) => this.resolveAppServerAuth(profile, config),
      resolveSkillPaths: this.resolveSkillPaths,
      createServerRequestHandler: (auth) => {
        const handler: CodexAppServerResourceRequestHandler = request => this.handleCodexServerRequest(input, request, {
          chatgptAuth: readCodexChatgptAuth(auth),
          readSecret: this.deps.readSecret,
          updateSecretValue: this.deps.updateSecret,
        })
        handler.readThreadId = () => input.runtimeSession.providerSessionId
        handler.ownsInteractiveRequests = true
        return handler
      },
    })
    const hostLease = await this.acquireCodexStreamTurnHost(input, context)

    yield* this.streamCodexTurnWithHost(input, context, hostLease)
  }

  private async acquireCodexStreamTurnHost(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
  ): Promise<CodexAppServerHostLease> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    return await this.acquireCodexAppServerHost({
      providerTargetId: profile.providerTargetId,
      chatgptAuth: readCodexChatgptAuth(context.auth),
      readThreadId: () => input.runtimeSession.providerSessionId,
      options: {
        apiKey: readCodexApiKeyAuth(context.auth) ?? undefined,
        config: context.codexConfig,
        env: context.codexEnv,
        serverRequestHandler: context.serverRequestHandler,
      },
    })
  }

  private async* streamCodexTurnWithHost(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
    hostLease: CodexAppServerHostLease,
  ): AsyncGenerator<UIMessageChunk, void, void> {
    const client = hostLease.client
    const abortController = new AbortController()
    const sessionId = input.runtimeSession.chatSessionId
    this._lastUsage = null
    this._lastModelId = context.effectiveModel ?? null

    const textItemId = randomUUID()
    const mapperState = createCodexAppServerMapperState(textItemId)
    const providerThreadMapperStates = new Map<string, ReturnType<typeof createCodexAppServerMapperState>>()
    const diagnostics = createCodexStreamDiagnostics()
    let activeEntry: ActiveCodexTurn | null = null

    const generation = this.startCodexStreamGeneration(input, context)
    const outputTextCollector = createBoundedTextCollector()

    try {
      const threadContext = await this.openCodexStreamThread(input, context, hostLease)
      activeEntry = this.registerActiveCodexTurn(input, context, client, hostLease, abortController, threadContext)
      const runTitleGeneration = this.createCodexThreadTitleScheduler(input, context, client, threadContext)

      await this.syncCodexHarnessContext(input, client, threadContext.threadId)
      const dispatch = await this.dispatchCodexStreamTurn(
        input,
        context,
        client,
        abortController,
        threadContext,
        runTitleGeneration,
      )
      if (dispatch.turnId) {
        this.activeTurns.markStarted(sessionId, activeEntry, dispatch.turnId)
      }

      if (!dispatch.shouldStream) {
        return
      }

      for await (const chunk of this.readCodexStreamChunks({
        input,
        context,
        client,
        abortController,
        threadContext,
        turnId: dispatch.turnId,
        mapperState,
        providerThreadMapperStates,
        diagnostics,
        activeEntry,
        generation,
        outputTextCollector,
      })) {
        yield chunk
      }

      this.finishCodexStreamGeneration(generation, outputTextCollector)
    }
    catch (error) {
      this.finishCodexStreamGeneration(generation, outputTextCollector, error)
      throw error
    }
    finally {
      if (activeEntry) {
        this.activeTurns.release(sessionId, activeEntry)
      }
      if (!activeEntry) {
        hostLease.release()
      }
    }
  }

  private async openCodexStreamThread(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
    hostLease: CodexAppServerHostLease,
  ): Promise<CodexStreamThreadContext> {
    const client = hostLease.client
    await syncCodexSkillExtraRoots(hostLease.resource, context.skillExtraRoots)
    const threadStart = context.isLiveSideFork
      ? readLiveSideForkThreadStart(input.runtimeSession, context.effectiveModel)
      : await startOrResumeThread(client, hostLease.resource, input.runtimeSession, {
          model: context.effectiveModel,
          serviceTier: readCodexLikeRuntimeSettings(context.runtimeSettings).serviceTier,
          cwd: context.runtimeContext.cwd,
          runtimeWorkspaceRoots: context.runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: context.runtimeAccess?.approvalPolicy ?? context.config.approvalPolicy,
          approvalsReviewer: context.runtimeAccess?.approvalsReviewer ?? 'user',
          sandbox: context.runtimeAccess?.sandbox ?? context.config.sandboxMode,
          config: context.codexConfig,
          developerInstructions: context.systemPrompt,
        })
    const threadId = threadStart.threadId
    input.runtimeSession.providerSessionId = threadId
    this._lastModelId = threadStart.modelId ?? context.effectiveModel ?? null
    writeCodexThreadSnapshot(input.runtimeSession, threadStart)
    if (threadStart.title) {
      input.reportSessionTitle?.(threadStart.title)
    }
    return { threadId, threadStart }
  }

  private registerActiveCodexTurn(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
    client: CodexAppServerClientLike,
    hostLease: CodexAppServerHostLease,
    abortController: AbortController,
    threadContext: CodexStreamThreadContext,
  ): ActiveCodexTurn {
    const activeEntry: ActiveCodexTurn = {
      client,
      hostLease,
      abortController,
      threadId: threadContext.threadId,
      turnId: null,
      modelId: context.effectiveModel ?? threadContext.threadStart.modelId ?? context.config.model ?? null,
      reasoningEffort: context.requestedReasoningEffort ?? null,
    }
    return this.activeTurns.register(input.runtimeSession.chatSessionId, activeEntry)
  }

  private createCodexThreadTitleScheduler(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
    client: CodexAppServerClientLike,
    threadContext: CodexStreamThreadContext,
  ): () => void {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const shouldGenerateThreadTitle = shouldGenerateCodexThreadTitle({
      isFreshProviderThread: context.isFreshProviderThread,
      existingTitle: threadContext.threadStart.title,
      promptText: context.goalCommandObjective ?? context.userPromptText,
      goalContinuationRequested: context.goalContinuationRequested,
      compactCommandRequested: context.compactCommandRequested,
    })
    return () => {
      if (!shouldGenerateThreadTitle) {
        return
      }
      const titleGeneration = this.resolveCodexThreadTitleGenerationConfig({
        currentAuth: context.auth,
        currentCodexConfig: context.codexConfig,
        workspacePath: context.workspacePath,
        fallbackModel: threadContext.threadStart.modelId ?? context.effectiveModel ?? context.config.model ?? null,
      })
      this.generateCodexThreadTitleInBackground({
        providerTargetId: profile.providerTargetId,
        apiKey: readCodexApiKeyAuth(titleGeneration.auth),
        chatgptAuth: readCodexChatgptAuth(titleGeneration.auth),
        codexConfig: titleGeneration.codexConfig,
        codexEnv: buildCodexAppServerEnv({
          chatSessionId: input.runtimeSession.chatSessionId,
          workspaceId: input.workspaceId,
          workspacePath: context.workspacePath,
          agentId: context.agentId,
          agentHome: context.runtimeContext.agentHome,
        }, titleGeneration.auth),
        mainClient: client,
        mainThreadId: threadContext.threadId,
        promptText: context.goalCommandObjective ?? context.userPromptText,
        cwd: context.runtimeContext.cwd,
        runtimeWorkspaceRoots: context.runtimeContext.runtimeWorkspaceRoots,
        modelId: titleGeneration.model,
        fallbackModel: titleGeneration.fallbackModel,
        thinkingEffort: titleGeneration.thinkingEffort,
        reportSessionTitle: input.reportSessionTitle,
      })
    }
  }

  private async syncCodexHarnessContext(
    input: StreamTurnInput,
    client: CodexAppServerClientLike,
    threadId: string,
  ): Promise<void> {
    const fragments = resolvePendingHarnessFragments(
      input.runtimeSession,
      input.harness?.fragments,
    )
    await injectCodexHarnessFragments(client, threadId, fragments)
    markHarnessFragmentsProjected(input.runtimeSession, fragments)
  }

  private async dispatchCodexStreamTurn(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
    client: CodexAppServerClientLike,
    abortController: AbortController,
    threadContext: CodexStreamThreadContext,
    runTitleGeneration: () => void,
  ): Promise<CodexStreamDispatchResult> {
    let turnId: string | null = null
    const threadId = threadContext.threadId

    if (context.goalContinuationRequested) {
      if (!hasActiveGoal(readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal)) {
        return { turnId, shouldStream: false }
      }
      if (!await continueActiveGoal(client, threadId, abortController.signal)) {
        return { turnId, shouldStream: false }
      }
      return { turnId, shouldStream: true }
    }

    if (context.goalCommandObjective) {
      const goal = await setCodexThreadGoal(client, input.runtimeSession, threadId, context.goalCommandObjective)
      if (!hasActiveGoal(goal)) {
        return { turnId, shouldStream: false }
      }
      runTitleGeneration()
      if (!await continueActiveGoal(client, threadId, abortController.signal)) {
        return { turnId, shouldStream: false }
      }
      return { turnId, shouldStream: true }
    }

    if (context.compactCommandRequested) {
      await client.request('thread/compact/start', { threadId })
      return { turnId, shouldStream: true }
    }

    if (input.reviewTarget) {
      const reviewResponse = await client.request('review/start', {
        threadId,
        target: input.reviewTarget,
        delivery: 'inline',
      }) as ReviewStartResponse
      return {
        turnId: reviewResponse.turn.id,
        shouldStream: true,
      }
    }

    const collaborationModeModel = context.effectiveModel ?? context.config.model
    const { serviceTier } = readCodexLikeRuntimeSettings(context.runtimeSettings)
    const turnResponse = await client.request('turn/start', {
      threadId,
      input: context.userInput,
      cwd: context.runtimeContext.cwd,
      runtimeWorkspaceRoots: context.runtimeContext.runtimeWorkspaceRoots,
      approvalPolicy: context.runtimeAccess?.approvalPolicy ?? context.config.approvalPolicy,
      approvalsReviewer: context.runtimeAccess?.approvalsReviewer ?? 'user',
      sandboxPolicy: context.runtimeAccess?.sandboxPolicy ?? toSandboxPolicy(
        context.config.sandboxMode,
        context.runtimeContext.runtimeWorkspaceRoots,
        context.config.additionalDirectories,
      ),
      ...(context.runtimeSettings && collaborationModeModel
        ? {
            collaborationMode: buildCodexCollaborationMode(context.runtimeSettings, {
              model: collaborationModeModel,
              effort: context.requestedReasoningEffort,
            }),
          }
        : {}),
      model: context.effectiveModel,
      ...(serviceTier ? { serviceTier } : {}),
      effort: context.requestedReasoningEffort,
    }) as TurnResponse
    turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
    runTitleGeneration()
    return { turnId, shouldStream: true }
  }

  private async* readCodexStreamChunks(input: {
    input: StreamTurnInput
    context: CodexStreamTurnContext
    client: CodexAppServerClientLike
    abortController: AbortController
    threadContext: CodexStreamThreadContext
    turnId: string | null
    mapperState: ReturnType<typeof createCodexAppServerMapperState>
    providerThreadMapperStates: Map<string, ReturnType<typeof createCodexAppServerMapperState>>
    diagnostics: ReturnType<typeof createCodexStreamDiagnostics>
    activeEntry: ActiveCodexTurn
    generation: LangfuseGeneration | null
    outputTextCollector: CodexStreamOutputCollector
  }): AsyncGenerator<UIMessageChunk, void, void> {
    const { input: turnInput, context, client, abortController, threadContext, mapperState, diagnostics } = input
    const usageEventProjector = new CodexUsageEventProjector(
      context.effectiveModel ?? threadContext.threadStart.modelId ?? context.config.model ?? null,
    )
    const notificationClient = client
    for await (const event of streamCodexMappedTurnEvents({
      client: notificationClient,
      threadId: threadContext.threadId,
      turnId: input.turnId,
      signal: abortController.signal,
      mapperState,
      diagnostics,
      readGoal: () => readCodexProviderSnapshot(turnInput.runtimeSession.providerStateSnapshot).codex?.goal ?? null,
      onProviderNotification: async (providerNotification) => {
        publishProviderThreadEvent(
          turnInput.onProviderThreadEvent,
          providerNotification,
          input.providerThreadMapperStates,
        )
        const usageEvent = usageEventProjector.project(providerNotification)
        if (usageEvent) {
          await turnInput.onUsageEvent?.(usageEvent)
        }
      },
    })) {
      const { notification } = event
      if (notification.method === 'turn/started') {
        const turnId = getTurnId(notification)
        if (turnId) {
          this.activeTurns.markStarted(turnInput.runtimeSession.chatSessionId, input.activeEntry, turnId)
        }
      }
      if (notification.method === 'turn/completed') {
        this.activeTurns.markCompleted(
          turnInput.runtimeSession.chatSessionId,
          input.activeEntry,
          getNotificationTurnId(notification),
        )
      }
      for (const chunk of event.chunks) {
        if (input.generation && chunk.type === 'text-delta' && 'delta' in chunk) {
          input.outputTextCollector.append((chunk as { delta: string }).delta)
        }
        yield chunk
      }

      if (notification.method === 'thread/name/updated') {
        const title = readThreadNameUpdate(notification, threadContext.threadId)
        if (title) {
          turnInput.reportSessionTitle?.(title)
        }
      }
      invalidateCodexUiSlotFacts(input.activeEntry.hostLease.resource, notification)
      projectCodexProviderStateSnapshot(turnInput.runtimeSession, notification, threadContext.threadId)
      this.captureLastTokenUsage(notification)
      if (isCompletedGoalUpdate(notification)) {
        await client.request('thread/goal/clear', { threadId: threadContext.threadId }).catch(() => undefined)
      }
    }

    const finalTitle = await readLatestThreadTitle(client, threadContext.threadId)
    if (finalTitle) {
      turnInput.reportSessionTitle?.(finalTitle)
    }
    if (!context.isLiveSideFork) {
      await this.deps.reconcileUsage?.({
        client,
        sessionId: turnInput.runtimeSession.chatSessionId,
        providerSessionId: threadContext.threadId,
        providerTargetId: turnInput.runtimeSession.providerTargetId ?? null,
      })
    }

    for (const chunk of closeCodexMappedTurnChunks(mapperState, diagnostics)) {
      yield chunk
    }

    this.assertCodexStreamProducedOutput(turnInput, context, diagnostics)
  }

  private assertCodexStreamProducedOutput(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
    diagnostics: ReturnType<typeof createCodexStreamDiagnostics>,
  ): void {
    const validation = validateCodexStreamOutput(diagnostics)
    if (validation.ok) {
      return
    }
    const errorText = validation.errorText ?? 'Codex app-server stream produced no timeline output events'
    this.recordObservability({
      source: 'provider',
      code: OBSERVABILITY_CODES.providerEmptyEventStream,
      severity: 'error',
      category: 'provider',
      message: errorText,
      chatSessionId: input.runtimeSession.chatSessionId,
      dedupeKey: createDedupeKey({
        code: OBSERVABILITY_CODES.providerEmptyEventStream,
        chatSessionId: input.runtimeSession.chatSessionId,
        runId: null,
      }),
      attrs: {
        runtimeKind: RUNTIME_KIND,
        diagnostics,
        model: context.effectiveModel,
        baseUrl: context.config.baseUrl,
      },
    })
    throw createCodexEmptyStreamError(errorText, diagnostics)
  }

  private startCodexStreamGeneration(
    input: StreamTurnInput,
    context: CodexStreamTurnContext,
  ): LangfuseGeneration | null {
    if (!aiTelemetryEnabled()) {
      return null
    }
    const generation = startObservation('codex-generation', {
      model: context.effectiveModel ?? 'codex',
      input: input.systemPrompt
        ? [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: describeCodexUserInput(context.userInput, context.userPromptText) },
          ]
        : [{ role: 'user', content: describeCodexUserInput(context.userInput, context.userPromptText) }],
    }, { asType: 'generation' }) as LangfuseGeneration
    const span = generation.otelSpan
    span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
    span.setAttribute('langfuse.trace.name', 'codex-chat')
    return generation
  }

  private finishCodexStreamGeneration(
    generation: LangfuseGeneration | null,
    outputTextCollector: CodexStreamOutputCollector,
    error?: unknown,
  ): void {
    if (!generation) {
      return
    }
    if (error !== undefined) {
      generation.update({
        level: 'ERROR',
        statusMessage: error instanceof Error ? error.message : String(error),
      })
      generation.end()
      return
    }
    generation.update({
      output: outputTextCollector.read(),
    })
    generation.end()
  }

  private async handleCodexServerRequest(
    input: StreamTurnInput,
    request: Parameters<NonNullable<CodexAppServerClientOptions['serverRequestHandler']>>[0],
    options: {
      chatgptAuth?: CodexChatgptAuthCredential | null
      readSecret?: (credentialRef: string) => string
      updateSecretValue?: (credentialRef: string, secret: string) => void
    },
  ): Promise<unknown> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    if (isCodexAppServerToolApprovalRequest(request.method)) {
      const requestId = String(request.id)
      const resolution = await requestProviderToolApproval({
        deps: this.deps,
        sessionId: input.runtimeSession.chatSessionId,
        runId: input.runId,
        providerRequestId: requestId,
        providerKind: profile.providerKind ?? 'universal',
        runtimeKind: RUNTIME_KIND,
        providerMethod: request.method,
        toolCallId: `server-request-${request.id}`,
        metadata: {
          params: request.params,
        },
      })
      return this.buildCodexToolApprovalResponse(request.method, request.params, resolution.approved)
    }

    if (!isCodexAppServerUserInputRequest(request.method)) {
      return await buildDefaultCodexAppServerRequestResult(request, options)
    }
    if (!this.deps.requestUserInput) {
      throw codexRequestError(request.method, 'Chat Runtime does not expose pending user input handling')
    }

    const requestId = String(request.id)
    const resolution = await this.deps.requestUserInput({
      sessionId: input.runtimeSession.chatSessionId,
      runId: input.runId,
      providerRequestId: requestId,
      providerKind: profile.providerKind ?? 'universal',
      runtimeKind: RUNTIME_KIND,
      providerMethod: request.method,
      toolCallId: `server-request-${request.id}`,
      questions: request.method === 'mcpServer/elicitation/request'
        ? readCodexMcpElicitationQuestions(request.params)
        : readCodexUserInputQuestions(request.params),
      metadata: {
        params: request.params,
      },
    })

    if (request.method === 'mcpServer/elicitation/request') {
      return buildCodexMcpElicitationResponse(request.params, resolution.answers)
    }

    return {
      answers: Object.fromEntries(
        Object.entries(resolution.answers).map(([questionId, answers]) => [questionId, { answers }]),
      ),
    }
  }

  private buildCodexToolApprovalResponse(method: string, params: unknown, approved: boolean): unknown {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return { decision: approved ? 'accept' : 'decline' }
      case 'item/permissions/requestApproval':
        return {
          permissions: approved ? readGrantedCodexPermissions(params) : {},
          scope: 'turn',
        }
      case 'applyPatchApproval':
      case 'execCommandApproval':
        return { decision: approved ? 'approved' : 'denied' }
      default:
        return { decision: approved ? 'approved' : 'denied' }
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeTurns.read(sessionId)
    if (!entry) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, sessionId))
    }
    const turnId = await this.activeTurns.waitForStartedTurn(sessionId, entry)
    if (!turnId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionClosed(this.runtimeKind, sessionId))
    }
    const userInput = projectCodexUserInput(input.message, 'Codex provider live steer')
    await entry.client.request('turn/steer', {
      threadId: entry.threadId,
      expectedTurnId: turnId,
      input: userInput,
    })
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    const entry = this.activeTurns.read(input.runtimeSession.chatSessionId)
    if (!entry) {
      return
    }
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedCodexConfig(profile.configJson)
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const runtimeContext = resolveCodexRuntimeContext(snapshot.workspacePath ?? '.', snapshot.agentId ?? null)
    const access = projectCodexRuntimeAccessMode(readCodexLikeRuntimeSettings(input.settings).accessMode, {
      writableRoots: runtimeContext.runtimeWorkspaceRoots,
      additionalDirectories: config.additionalDirectories,
    })
    const collaborationModeModel = entry.modelId ?? snapshot.models.currentModelId ?? config.model
    const { serviceTier } = readCodexLikeRuntimeSettings(input.settings)
    await entry.client.request('thread/settings/update', {
      threadId: entry.threadId,
      approvalPolicy: access.approvalPolicy,
      approvalsReviewer: access.approvalsReviewer,
      sandboxPolicy: access.sandboxPolicy,
      ...(serviceTier ? { serviceTier } : {}),
      ...(collaborationModeModel
        ? {
            collaborationMode: buildCodexCollaborationMode(input.settings, {
              model: collaborationModeModel,
              effort: entry.reasoningEffort ?? config.reasoningEffort,
            }),
          }
        : {}),
    })
    if (entry.turnId) {
      await entry.client.request('turn/settings/update', {
        threadId: entry.threadId,
        turnId: entry.turnId,
        serviceTier,
      })
    }
  }

  async updateRuntimeTurnSettings(
    input: UpdateRuntimeTurnSettingsInput,
  ): Promise<UpdateRuntimeTurnSettingsResult> {
    const entry = this.activeTurns.read(input.runtimeSession.chatSessionId)
    if (!entry?.turnId) {
      return { status: 'targetUnavailable' }
    }
    const response = await entry.client.request('turn/settings/update', {
      threadId: entry.threadId,
      turnId: entry.turnId,
      ...input.settings,
    }) as TurnSettingsUpdateResponse
    if (response.status === 'applied') {
      if (input.settings.model !== undefined && input.settings.model !== null) {
        entry.modelId = input.settings.model
      }
      if (input.settings.effort !== undefined && input.settings.effort !== null) {
        entry.reasoningEffort = input.settings.effort
      }
    }
    return { status: response.status }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeTurns.read(sessionId)
    if (!entry) {
      return
    }
    if (hasActiveGoal(readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal)) {
      await entry.client.request('thread/goal/set', {
        threadId: entry.threadId,
        status: 'paused',
      }).catch(() => undefined)
      pauseCodexGoalSnapshot(input.runtimeSession)
    }
    entry.abortController.abort()
    const { client, threadId, turnId, hostLease } = entry
    // Detach before awaiting interrupt. Product cancel releases the session claim early so
    // the next turn can start; if we stayed in the map, that streamTurn would overwrite this
    // entry and leak the host lease (or interrupt against the wrong turn).
    this.activeTurns.detach(sessionId, entry)
    try {
      if (turnId) {
        await client.request('turn/interrupt', {
          threadId,
          turnId,
        }).catch(() => undefined)
      }
    }
    finally {
      hostLease.release()
    }
  }

  private createAppServerBridge(): CodexAppServerBridge {
    return new CodexAppServerBridge({
      readSecret: credentialRef => this.deps.readSecret(credentialRef),
      readSecretValueWithMetadata: this.deps.readSecretValueWithMetadata,
      updateSecretValue: this.deps.updateSecret,
      resolveSkillPaths: this.resolveSkillPaths,
      createAppServerClient: this.deps.createAppServerClient,
      readCodexPreferences: this.deps.readCodexPreferences,
      readCodexCliCompatibleIdentity: this.deps.readCodexCliCompatibleIdentity,
    })
  }

  private resolveAppServerAuth(
    profile: CodexAppServerAuthCarrier,
    config: Parameters<typeof resolveCodexAppServerAuth>[1],
  ): CodexAppServerAuthResolution {
    return resolveCodexAppServerAuth(profile, config, 'OPENAI_API_KEY', this.deps)
  }

  private async acquireCodexAppServerHost(input: {
    providerTargetId: string
    options: CodexAppServerClientOptions
    chatgptAuth: CodexChatgptAuthCredential | null
    pinned?: boolean
    readThreadId?: () => string | null
  }): Promise<CodexAppServerHostLease> {
    const options = {
      ...input.options,
      ...(input.options.config
        ? { config: bindCodexCradleMcpInvocation(input.options.config, input.options.env ?? {}) }
        : {}),
    } satisfies CodexAppServerClientOptions
    return await acquireCodexAppServerHostLease({
      runtimeKind: this.runtimeKind,
      providerTargetId: input.providerTargetId,
      options,
      chatgptAuth: input.chatgptAuth,
      pinned: input.pinned ?? false,
      readThreadId: input.readThreadId,
      deps: {
        readSecret: this.deps.readSecret,
        createAppServerClient: this.deps.createAppServerClient,
        readCodexPreferences: this.deps.readCodexPreferences,
        readCodexCliCompatibleIdentity: this.deps.readCodexCliCompatibleIdentity,
        updateSecretValue: this.deps.updateSecret,
        mapChatgptAuthError: error => new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind), { cause: error }),
      },
    })
  }

  private resolveCodexThreadTitleGenerationConfig(input: {
    currentAuth: CodexAppServerAuthResolution
    currentCodexConfig: NonNullable<ThreadForkParams['config']>
    workspacePath: string
    fallbackModel: string | null
  }): {
      auth: CodexAppServerAuthResolution
      codexConfig: NonNullable<ThreadForkParams['config']>
      model: string | null
      fallbackModel: string | null
      thinkingEffort: CodexTitleGenerationThinkingEffort
    } {
    const preferences = this.deps.readChatPreferences?.()
    const titlePreferences = preferences?.titleGeneration
    const thinkingEffort = titlePreferences?.thinkingEffort ?? 'minimal'
    const explicitProviderTargetId = titlePreferences?.providerTargetId ?? null
    const explicitModelId = titlePreferences?.modelId ?? null

    if (!explicitProviderTargetId) {
      return {
        auth: input.currentAuth,
        codexConfig: input.currentCodexConfig,
        model: null,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const profile = this.deps.resolveProviderTargetProfile?.(explicitProviderTargetId)
    if (!profile) {
      return {
        auth: input.currentAuth,
        codexConfig: input.currentCodexConfig,
        model: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const config = readTrustedCodexConfig(profile.configJson)
    const model = explicitModelId ?? config.model ?? null
    const auth = this.resolveAppServerAuth(profile, config)
    return {
      auth,
      codexConfig: buildCodexConfig(config, input.workspacePath, this.resolveSkillPaths, model, auth),
      model,
      fallbackModel: config.model ?? input.fallbackModel,
      thinkingEffort,
    }
  }

  private generateCodexThreadTitleInBackground(input: {
    providerTargetId: string
    apiKey: string | null
    chatgptAuth: CodexChatgptAuthCredential | null
    codexConfig: NonNullable<ThreadForkParams['config']>
    codexEnv: Record<string, string>
    mainClient: CodexAppServerClientLike
    mainThreadId: string
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    reportSessionTitle?: (title: string) => void
  }): void {
    setTimeout(() => {
      const model = input.modelId ?? input.fallbackModel
      const titleCodexConfig = buildCodexTitleConfig(input.codexConfig, model)
      const abortController = new AbortController()
      void (async () => {
        let hostLease: CodexAppServerHostLease | null = null
        try {
          hostLease = await this.acquireCodexAppServerHost({
            providerTargetId: input.providerTargetId,
            chatgptAuth: input.chatgptAuth,
            options: {
              apiKey: input.apiKey ?? undefined,
              config: titleCodexConfig,
              env: input.codexEnv,
              serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
                chatgptAuth: input.chatgptAuth,
                readSecret: this.deps.readSecret,
                updateSecretValue: this.deps.updateSecret,
              }),
            },
          })
          const client = hostLease.client
          const generatedTitle = await generateAndSetCodexThreadTitle(client, input.mainClient, {
            mainThreadId: input.mainThreadId,
            promptText: input.promptText,
            cwd: input.cwd,
            runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
            modelId: input.modelId,
            fallbackModel: input.fallbackModel,
            thinkingEffort: input.thinkingEffort,
            config: titleCodexConfig,
            signal: abortController.signal,
          })
          if (generatedTitle) {
            input.reportSessionTitle?.(generatedTitle)
          }
        }
        catch {
          // Title generation is opportunistic and must not affect the active turn.
        }
        finally {
          abortController.abort()
          hostLease?.release()
        }
      })()
    }, 0)
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedCodexConfig(profile.configJson)
    const auth = this.resolveAppServerAuth(profile, config)
    if (codexConfigRequiresApiKey(config, auth)) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model ?? null
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, effectiveModel, auth)
    const chatgptAuth = readCodexChatgptAuth(auth)
    const codexEnvInput = {
      chatSessionId: input.runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
    }
    const codexEnv = buildCodexAppServerEnv(codexEnvInput, auth)
    const mainHostLease = await this.acquireCodexAppServerHost({
      providerTargetId: profile.providerTargetId,
      chatgptAuth,
      readThreadId: () => input.runtimeSession.providerSessionId,
      options: {
        apiKey: readCodexApiKeyAuth(auth) ?? undefined,
        config: codexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth,
          readSecret: this.deps.readSecret,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const abortController = new AbortController()
    let titleHostLease: CodexAppServerHostLease | null = null

    try {
      const mainClient = mainHostLease.client
      const threadStart = await startOrResumeThread(mainClient, mainHostLease.resource, input.runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: config.sandboxMode,
        config: codexConfig,
      })
      input.runtimeSession.providerSessionId = threadStart.threadId
      this._lastModelId = threadStart.modelId ?? effectiveModel
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)

      const titleGeneration = this.resolveCodexThreadTitleGenerationConfig({
        currentAuth: auth,
        currentCodexConfig: codexConfig,
        workspacePath,
        fallbackModel: threadStart.modelId ?? effectiveModel,
      })
      const titleModel = titleGeneration.model ?? titleGeneration.fallbackModel
      const titleCodexConfig = buildCodexTitleConfig(titleGeneration.codexConfig, titleModel)
      const titleChatgptAuth = readCodexChatgptAuth(titleGeneration.auth)
      titleHostLease = await this.acquireCodexAppServerHost({
        providerTargetId: profile.providerTargetId,
        chatgptAuth: titleChatgptAuth,
        options: {
          apiKey: readCodexApiKeyAuth(titleGeneration.auth) ?? undefined,
          config: titleCodexConfig,
          env: buildCodexAppServerEnv(codexEnvInput, titleGeneration.auth),
          serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
            chatgptAuth: titleChatgptAuth,
            readSecret: this.deps.readSecret,
            updateSecretValue: this.deps.updateSecret,
          }),
        },
      })

      return await generateAndSetCodexThreadTitleOrThrow(titleHostLease.client, mainClient, {
        mainThreadId: threadStart.threadId,
        promptText: input.promptText,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        modelId: titleGeneration.model,
        fallbackModel: titleGeneration.fallbackModel,
        thinkingEffort: titleGeneration.thinkingEffort,
        config: titleCodexConfig,
        signal: abortController.signal,
      })
    }
    finally {
      abortController.abort()
      titleHostLease?.release()
      mainHostLease.release()
    }
  }

  private captureLastTokenUsage(notification: CodexAppServerMessage): void {
    if (notification.method !== 'thread/tokenUsage/updated') {
      return
    }
    const params = notification.params as ThreadTokenUsageUpdatedNotificationParams | undefined
    const usage = readCodexLastTokenUsage(params?.tokenUsage)
    if (usage) {
      this._lastUsage = usage
    }
  }
}

async function loadCodexUiSlotHostFacts(
  client: CodexAppServerClientLike,
  cwd: string,
): Promise<CodexUiSlotHostFacts> {
  const results = await Promise.allSettled([
    client.request('config/read', { cwd, includeLayers: false }) as Promise<CodexConfigReadResponse>,
    client.request('modelProvider/capabilities/read', {}) as Promise<CodexModelProviderCapabilitiesReadResponse>,
    client.request('model/list', { includeHidden: true, limit: 100 }) as Promise<CodexModelListResponse>,
    client.request('account/rateLimits/read', {}) as Promise<CodexRateLimitsResponse>,
    client.request('configRequirements/read', {}) as Promise<CodexConfigRequirementsReadResponse>,
    client.request('skills/list', { cwd }) as Promise<CodexSkillsListResponse>,
    client.request('plugin/list', {}) as Promise<CodexPluginListResponse>,
    client.request('app/list', { limit: 100 }) as Promise<CodexAppsListResponse>,
    client.request('collaborationMode/list', {}) as Promise<CodexCollaborationModeListResponse>,
  ] as const)
  return {
    configResponse: readSettledValue(results[0]),
    providerCapabilities: readSettledValue(results[1]),
    modelList: readSettledValue(results[2]),
    rateLimits: readSettledValue(results[3]),
    configRequirements: readSettledValue(results[4]),
    skills: readSettledValue(results[5]),
    plugins: readSettledValue(results[6]),
    apps: readSettledValue(results[7]),
    collaborationModes: readSettledValue(results[8]),
  }
}

async function loadCodexUiSlotThreadFacts(
  client: CodexAppServerClientLike,
  threadId: string,
  providerStateSnapshot: string | null | undefined,
  collaborationModes: CodexCollaborationModeListResponse | null,
): Promise<CodexUiSlotThreadFacts> {
  const [goalResult, mcpStatusResult, backgroundTerminalsResult, crewStateResult] = await Promise.allSettled([
    client.request('thread/goal/get', { threadId }) as Promise<ThreadGoalGetResponse>,
    client.request('mcpServerStatus/list', {
      threadId,
      limit: 100,
      detail: 'toolsAndAuthOnly',
    }) as Promise<CodexListMcpServerStatusResponse>,
    client.request('thread/backgroundTerminals/list', {
      threadId,
      limit: 20,
    }) as Promise<ThreadBackgroundTerminalsListResponse>,
    readCodexCrewState(
      client,
      threadId,
      readCodexProviderSnapshot(providerStateSnapshot),
      collaborationModes,
    ),
  ] as const)
  return {
    goal: goalResult.status === 'fulfilled' ? goalResult.value.goal : undefined,
    mcpStatus: readSettledValue(mcpStatusResult),
    backgroundTerminals: backgroundTerminalsResult.status === 'fulfilled'
      ? projectCodexBackgroundTerminals(backgroundTerminalsResult.value.data)
      : [],
    crewState: readSettledValue(crewStateResult),
  }
}

function readSettledValue<Value>(result: PromiseSettledResult<Value>): Value | null {
  return result.status === 'fulfilled' ? result.value : null
}

function invalidateCodexUiSlotFacts(
  resource: ActiveCodexTurn['hostLease']['resource'],
  notification: CodexAppServerMessage,
): void {
  if (notification.method === 'account/rateLimits/updated'
    || notification.method === 'config/changed'
    || notification.method === 'thread/settings/updated') {
    resource.uiSlotHostFacts = undefined
  }

  const params = readRecord(notification.params)
  const method = notification.method ?? ''
  const threadId = typeof params?.threadId === 'string' ? params.threadId : null
  if (!threadId) {
    return
  }
  const item = readRecord(params?.item)
  const changesThreadFacts = method === 'thread/goal/updated'
    || method === 'thread/goal/cleared'
    || method.startsWith('mcpServer/')
    || method.startsWith('thread/backgroundTerminals/')
    || (method === 'item/completed' && item?.type === 'collabAgentToolCall')
  if (changesThreadFacts) {
    resource.uiSlotThreadFacts.delete(threadId)
  }
}

function toCodexThreadSourceKind(kind: ProviderThreadSourceKind): ThreadSourceKind {
  switch (kind) {
    case 'cli':
    case 'vscode':
    case 'exec':
    case 'appServer':
    case 'subAgent':
    case 'subAgentReview':
    case 'subAgentCompact':
    case 'subAgentThreadSpawn':
    case 'subAgentOther':
    case 'unknown':
      return kind
    default:
      return 'unknown'
  }
}

function projectCodexThread(thread: Thread): ProviderThread {
  return {
    id: thread.id,
    providerSessionTreeId: thread.sessionId ?? null,
    forkedFromId: thread.forkedFromId ?? null,
    preview: normalizeProviderTitle(thread.preview) ?? null,
    ephemeral: thread.ephemeral === true,
    modelProvider: normalizeProviderTitle(thread.modelProvider) ?? null,
    createdAt: typeof thread.createdAt === 'number' ? thread.createdAt : null,
    updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt : null,
    status: readThreadStatusType(thread.status),
    sourceKind: readCodexThreadSourceKind(thread.source),
    source: thread.source,
    threadSource: thread.threadSource ?? null,
    agentNickname: normalizeProviderTitle(thread.agentNickname) ?? null,
    agentRole: normalizeProviderTitle(thread.agentRole) ?? null,
    name: normalizeProviderTitle(thread.name) ?? null,
    cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
  }
}

function projectCodexBackgroundTerminals(
  terminals: ThreadBackgroundTerminal[],
): RuntimeBackgroundTerminal[] {
  return terminals.map(terminal => ({
    itemId: terminal.itemId,
    processId: terminal.processId,
    command: terminal.command,
    cwd: terminal.cwd,
    osPid: terminal.osPid,
    cpuPercent: terminal.cpuPercent,
    rssKb: terminal.rssKb === null ? null : Number(terminal.rssKb),
  }))
}

function projectCodexTurn(turn: Turn): ProviderThreadTurn {
  return {
    id: turn.id,
    status: turn.status,
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
    itemsView: turn.itemsView,
    items: turn.items,
  }
}

function projectCodexTurnsToUiMessages(threadId: string, turns: Turn[]): UIMessage[] {
  const messages: UIMessage[] = []
  for (const turn of turns) {
    let assistantParts: UIMessage['parts'] = []
    let assistantMessageIndex = 0
    const flushAssistant = () => {
      if (assistantParts.length === 0) {
        return
      }
      messages.push({
        id: `provider-thread:${threadId}:turn:${turn.id}:assistant:${assistantMessageIndex}`,
        role: 'assistant',
        parts: assistantParts,
        metadata: codexProviderThreadMessageMetadata(threadId, turn.id),
      })
      assistantParts = []
      assistantMessageIndex += 1
    }

    for (const item of turn.items) {
      switch (item.type) {
        case 'userMessage':
          flushAssistant()
          messages.push({
            id: `provider-thread:${threadId}:turn:${turn.id}:user:${item.id}`,
            role: 'user',
            parts: projectCodexUserInputsToUiParts(item.content),
            metadata: codexProviderThreadMessageMetadata(threadId, turn.id, item.id, item.type),
          })
          break
        case 'agentMessage':
          if (item.text) {
            assistantParts.push({
              type: 'text',
              text: item.text,
              state: 'done',
              providerMetadata: codexProviderThreadPartMetadata(threadId, turn.id, item.id, item.type, item),
            })
          }
          break
        case 'reasoning': {
          const text = [...(item.summary ?? []), ...(item.content ?? [])].join('\n')
          if (text) {
            assistantParts.push({
              type: 'reasoning',
              text,
              state: 'done',
              providerMetadata: codexProviderThreadPartMetadata(threadId, turn.id, item.id, item.type, item),
            })
          }
          break
        }
        case 'hookPrompt':
          break
        default: {
          assistantParts.push(projectCodexToolItemToUiPart(item as CodexAppServerItem, threadId, turn.id))
          const imagePart = projectCodexToolItemImageFilePart(item as CodexAppServerItem)
          if (imagePart) {
            assistantParts.push(imagePart)
          }
          break
        }
      }
    }
    flushAssistant()
  }
  return messages
}

function projectCodexUserInputsToUiParts(inputs: UserInput[]): UIMessage['parts'] {
  const parts: UIMessage['parts'] = []
  for (const input of inputs) {
    switch (input.type) {
      case 'text':
        parts.push({ type: 'text', text: input.text, state: 'done' })
        break
      case 'image':
        parts.push({ type: 'file', mediaType: 'image/*', url: input.url })
        break
      case 'localImage':
        parts.push(projectLocalImageFilePart(input.path))
        break
      case 'audio':
        parts.push({ type: 'file', mediaType: 'audio/*', url: input.url })
        break
      case 'localAudio':
        parts.push({ type: 'file', mediaType: 'audio/*', url: `file://${input.path}` })
        break
      case 'skill':
      case 'mention':
        parts.push({ type: 'text', text: `@${input.name}`, state: 'done' })
        break
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '', state: 'done' }]
}

function projectLocalImageFilePart(filePath: string): Extract<UIMessage['parts'][number], { type: 'file' }> {
  const image = readLocalImageDataUrl(filePath)
  return {
    type: 'file',
    mediaType: image?.mediaType ?? 'image/*',
    url: image?.url ?? `file://${filePath}`,
  }
}

function projectCodexToolItemImageFilePart(
  item: CodexAppServerItem,
): Extract<UIMessage['parts'][number], { type: 'file' }> | null {
  switch (item.type) {
    case 'imageGeneration': {
      const savedPath = (item as { savedPath?: string | null }).savedPath
      if (savedPath) {
        return projectLocalImageFilePart(savedPath)
      }
      const result = (item as { result?: string | null }).result
      const mediaType = readImageDataUrlMediaType(result)
      if (mediaType && result) {
        return { type: 'file', mediaType, url: result }
      }
      if (result && /^https?:\/\//i.test(result)) {
        return { type: 'file', mediaType: 'image/*', url: result }
      }
      if (result) {
        return { type: 'file', mediaType: 'image/png', url: `data:image/png;base64,${result}` }
      }
      return null
    }
    case 'imageView': {
      const path = (item as { path?: string | null }).path
      return path ? projectLocalImageFilePart(path) : null
    }
    default:
      return null
  }
}

function readImageDataUrlMediaType(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(value)
  return match?.[1] ?? null
}

function projectCodexToolItemToUiPart(
  item: CodexAppServerItem,
  threadId: string,
  turnId: string,
): UIMessage['parts'][number] {
  const errorText = readCodexToolError(item)
  const toolName = readCodexToolName(item)
  const input = buildCodexToolInput(item)
  const providerMetadata = codexProviderThreadPartMetadata(threadId, turnId, item.id, item.type, item)
  if (errorText) {
    return {
      type: 'dynamic-tool',
      toolCallId: item.id,
      toolName,
      state: 'output-error',
      input,
      errorText,
      callProviderMetadata: providerMetadata,
      resultProviderMetadata: providerMetadata,
    }
  }
  return {
    type: 'dynamic-tool',
    toolCallId: item.id,
    toolName,
    state: 'output-available',
    input,
    output: buildCodexToolOutput(item),
    callProviderMetadata: providerMetadata,
    resultProviderMetadata: providerMetadata,
  }
}

function codexProviderThreadMessageMetadata(
  threadId: string,
  turnId: string,
  itemId?: string,
  itemType?: string,
): Record<string, unknown> {
  return {
    codex: {
      threadId,
      turnId,
      ...(itemId ? { itemId } : {}),
      ...(itemType ? { itemType } : {}),
    },
  }
}

function codexProviderThreadPartMetadata(
  threadId: string,
  turnId: string,
  itemId: string,
  itemType: string,
  _item: CodexAppServerItem,
): ProviderMetadata {
  return {
    codex: {
      threadId,
      turnId,
      itemId,
      itemType,
    },
  }
}

function readThreadStatusType(status: Thread['status']): string {
  return typeof status === 'object' && status !== null && 'type' in status
    ? String(status.type)
    : 'unknown'
}

function readCodexThreadSourceKind(source: Thread['source']): ProviderThreadSourceKind {
  if (typeof source === 'string') {
    switch (source) {
      case 'cli':
      case 'vscode':
      case 'exec':
      case 'appServer':
      case 'unknown':
        return source
      default:
        return 'unknown'
    }
  }
  if (!source || typeof source !== 'object' || !('subAgent' in source)) {
    return 'unknown'
  }
  const subAgentSource = source.subAgent
  if (subAgentSource === 'review') {
    return 'subAgentReview'
  }
  if (subAgentSource === 'compact') {
    return 'subAgentCompact'
  }
  if (subAgentSource && typeof subAgentSource === 'object') {
    if ('thread_spawn' in subAgentSource) {
      return 'subAgentThreadSpawn'
    }
    if ('other' in subAgentSource) {
      return 'subAgentOther'
    }
  }
  return 'subAgent'
}

async function assertCodexThreadBelongsToRuntimeSession(
  client: CodexAppServerClientLike,
  parentThreadId: string | null,
  thread: Thread,
): Promise<void> {
  if (!parentThreadId) {
    throw codexRequestError('thread/read', 'Cannot read provider thread before the parent runtime thread exists')
  }
  const parent = await client.request('thread/read', {
    threadId: parentThreadId,
    includeTurns: false,
  }) as ThreadReadResponse
  if (!codexThreadBelongsToRuntimeParent(parent.thread, thread)) {
    throw codexRequestError('thread/read', `Provider thread ${thread.id} does not belong to runtime thread ${parentThreadId}`)
  }
}

function codexThreadBelongsToRuntimeParent(parentThread: Thread, thread: Thread): boolean {
  if (thread.parentThreadId === parentThread.id) {
    return true
  }
  return readCodexThreadSpawnParentThreadId(thread.source) === parentThread.id
}

function readCodexThreadSpawnParentThreadId(source: Thread['source']): string | null {
  if (!source || typeof source !== 'object' || !('subAgent' in source)) {
    return null
  }
  const subAgentSource = source.subAgent
  if (!subAgentSource || typeof subAgentSource !== 'object' || !('thread_spawn' in subAgentSource)) {
    return null
  }
  const spawn = subAgentSource.thread_spawn
  if (!spawn || typeof spawn !== 'object') {
    return null
  }
  const parentThreadId = (spawn as { parent_thread_id?: unknown }).parent_thread_id
  return typeof parentThreadId === 'string' && parentThreadId.length > 0 ? parentThreadId : null
}

function readGrantedCodexPermissions(params: unknown): Record<string, unknown> {
  const requestPermissions = readRecord(readRecord(params).permissions)
  const granted: Record<string, unknown> = {}
  if (requestPermissions.network !== undefined && requestPermissions.network !== null) {
    granted.network = requestPermissions.network
  }
  if (requestPermissions.fileSystem !== undefined && requestPermissions.fileSystem !== null) {
    granted.fileSystem = requestPermissions.fileSystem
  }
  return granted
}

function syncCodexAppServerSnapshot(
  input: CodexAppServerInvokeInput,
  result: unknown,
): void {
  if (input.method === 'thread/goal/clear') {
    clearCodexGoalSnapshot(input.runtimeSession)
    return
  }

  if (input.method !== 'thread/goal/set') {
    return
  }

  const response = readRecord(result) as ThreadGoalGetResponse
  const goalSnapshot = projectCodexGoalSnapshotFromGoal(response.goal ?? null)
  if (goalSnapshot) {
    writeCodexGoalSnapshot(input.runtimeSession, goalSnapshot)
  }
}
