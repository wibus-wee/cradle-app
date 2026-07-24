import type { UIMessage, UIMessageChunk } from 'ai'

import { getRegisteredMcpServers } from '../../../plugins/mcp-registry'
import type {
  BackgroundTerminalListResult,
  CancelTurnInput,
  ChatRuntime,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ListBackgroundTerminalsInput,
  ListRuntimeModelsInput,
  ProviderContext,
  ProviderHealthStatus,
  ProviderThread,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  ResumeChatSessionInput,
  RuntimeContextUsage,
  RuntimeMcpServerSummary,
  RuntimeModelCatalog,
  RuntimeProgressItem,
  RuntimeSession,
  RuntimeSettings,
  RuntimeUiSlotState,
  RuntimeUserInputResolution,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
  SubmitRuntimeUserInputInput,
  TerminateBackgroundTerminalInput,
  UpdateRuntimeSettingsInput,
} from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError, requireRuntimeProviderTargetProfile } from '../../chat-runtime/runtime-provider-types'
import { readCodexLikeRuntimeSettings } from '../../chat-runtime/runtime-settings'
import { lookupModelRaw } from '../../model-registry/model-info-registry'
import { extractProviderInputText } from '../kit/input-projector'
import { requestProviderToolApproval } from '../kit/permission-bridge'
import { readProviderStateSnapshot } from '../kit/state-snapshot'
import { projectKimiProviderConfig, resolveKimiModelReference } from './config'
import { KimiEventToChunkMapper } from './event-to-chunk-mapper'
import type { KimiWebHostLease } from './host-lease'
import { acquireKimiWebHostLease } from './host-lease'
import { KIMI_RUNTIME_CAPABILITIES, KIMI_RUNTIME_KIND, KIMI_RUNTIME_METADATA } from './metadata'
import { createKimiRuntimePresentation } from './presentation'
import {
  closeTerminal,
  getApiV1McpServers,
  getApiV1Sessions,
  getApiV1SessionsBySessionId,
  getApiV1SessionsBySessionIdApprovals,
  getApiV1SessionsBySessionIdGoal,
  getApiV1SessionsBySessionIdMessages,
  getApiV1SessionsBySessionIdQuestions,
  getApiV1SessionsBySessionIdStatus,
  getApiV1SessionsBySessionIdTasks,
  getApiV1SessionsBySessionIdTerminals,
  listSkills,
  postApiV1Config,
  postApiV1Sessions,
  postApiV1SessionsBySessionIdApprovalsByApprovalId,
  postApiV1SessionsBySessionIdProfile,
  postApiV1SessionsBySessionIdQuestionsByTail,
  promptAction,
  steerPrompts,
  submitPrompt,
} from './protocol/rest/sdk.gen'
import type { GetApiV1SessionsBySessionIdQuestionsResponses } from './protocol/rest/types.gen'

const KIMI_COMMAND = process.env.KIMI_COMMAND || 'kimi'

export function createKimiProvider(ctx: ProviderContext): ChatRuntime {
  return new KimiProvider(ctx)
}

class KimiProvider implements ChatRuntime {
  readonly runtimeKind = KIMI_RUNTIME_KIND
  readonly metadata = KIMI_RUNTIME_METADATA
  readonly capabilities = KIMI_RUNTIME_CAPABILITIES

  constructor(private readonly deps: ProviderContext) {}

  getDraftPresentation() {
    return createKimiRuntimePresentation()
  }

  async getPresentation(_input: GetCapabilitiesInput) {
    return createKimiRuntimePresentation()
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const providerConfig = projectKimiProviderConfig(profile)
    const model = resolveKimiModelReference(providerConfig, input.modelId ?? providerConfig.defaultModel)
    if (!model) {
      throw new ProviderRuntimeError(ProviderErrors.requestFailed(
        this.runtimeKind,
        'session.create',
        `Provider target ${profile.name} needs a defaultModel before Kimi can start a session.`,
      ))
    }
    const lease = await this.acquire(profile)
    try {
      const modelInfo = await lookupModelRaw(input.modelId ?? providerConfig.defaultModel ?? '')
      if (!modelInfo?.limit?.context) {
        throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'config.models', `models.dev has no context window for ${input.modelId ?? providerConfig.defaultModel}.`))
      }
      await lease.resource.http.request(postApiV1Config({
        client: lease.resource.http.client,
        body: {
          default_model: model,
          models: {
            [model]: {
              provider: providerConfig.id,
              model: input.modelId ?? providerConfig.defaultModel,
              max_context_size: modelInfo.limit.context,
              max_output_size: modelInfo.limit.output,
            },
          },
        },
      }))
      const created = await lease.resource.http.request(postApiV1Sessions({
        client: lease.resource.http.client,
        body: {
          metadata: { cwd: input.workspacePath, cradle_chat_session_id: input.chatSessionId },
          agent_config: model
            ? { model }
            : undefined,
        },
      }))
      if (!created || !('id' in created)) {
        throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'session.create', 'Kimi did not return a session.'))
      }
      return {
        id: input.chatSessionId,
        chatSessionId: input.chatSessionId,
        providerTargetId: profile.providerTargetId,
        runtimeKind: this.runtimeKind,
        providerSessionId: created.id,
        providerRuntimeLease: lease,
        providerStateSnapshot: JSON.stringify({
          models: { currentModelId: input.modelId ?? created.agent_config.model },
          kimi: { providerTargetId: profile.providerTargetId, workspacePath: input.workspacePath },
        }),
      }
    }
    catch (error) {
      lease.release()
      throw error
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const snapshot = readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const lease = await this.acquire(profile)
    return {
      ...input.runtimeSession,
      providerTargetId: profile.providerTargetId,
      providerRuntimeLease: lease,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        models: { ...snapshot.models, currentModelId: input.modelId ?? snapshot.models.currentModelId },
        kimi: { providerTargetId: profile.providerTargetId, workspacePath: input.workspacePath },
      }),
    }
  }

  async listModels(_input: ListRuntimeModelsInput): Promise<RuntimeModelCatalog> {
    return { runtimeKind: this.runtimeKind, source: 'runtime-cache', fetchedAt: Date.now(), models: [] }
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'unknown', message: 'Kimi health is provider-target scoped.', lastCheckedAt: Date.now() }
  }

  async getContextUsage(input: GetContextUsageInput): Promise<RuntimeContextUsage | null> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) { return null }
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const lease = await this.acquire(profile)
    try {
      const status = await lease.resource.http.request(getApiV1SessionsBySessionIdStatus({
        client: lease.resource.http.client,
path: { session_id: providerSessionId },
      }))
      if (!status || !('context_tokens' in status)) { return null }
      return {
        runtimeKind: this.runtimeKind,
providerSessionId,
source: 'kimi.session.status',
model: status.model ?? null,
        totalTokens: status.context_tokens,
maxTokens: status.max_context_tokens,
rawMaxTokens: status.max_context_tokens,
        percentage: status.max_context_tokens ? status.context_usage : null,
        sections: [],
messageBreakdown: null,
apiUsage: null,
raw: status,
updatedAt: Date.now(),
      }
    }
    finally { lease.release() }
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) { return [] }
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const lease = await this.acquire(profile)
    try {
      const [status, goal, approvals, questions, tasks, terminals, mcp, skills] = await Promise.all([
        lease.resource.http.request(getApiV1SessionsBySessionIdStatus({ client: lease.resource.http.client, path: { session_id: providerSessionId } })),
        lease.resource.http.request(getApiV1SessionsBySessionIdGoal({ client: lease.resource.http.client, path: { session_id: providerSessionId } })),
        lease.resource.http.request(getApiV1SessionsBySessionIdApprovals({ client: lease.resource.http.client, path: { session_id: providerSessionId }, query: { status: 'pending' } })),
        lease.resource.http.request(getApiV1SessionsBySessionIdQuestions({ client: lease.resource.http.client, path: { session_id: providerSessionId }, query: { status: 'pending' } })),
        lease.resource.http.request(getApiV1SessionsBySessionIdTasks({ client: lease.resource.http.client, path: { session_id: providerSessionId } })),
        lease.resource.http.request(getApiV1SessionsBySessionIdTerminals({ client: lease.resource.http.client, path: { session_id: providerSessionId } })),
        lease.resource.http.request(getApiV1McpServers({ client: lease.resource.http.client })),
        lease.resource.http.request(listSkills({ client: lease.resource.http.client, path: { session_id: providerSessionId } })),
      ])
      const updatedAt = Date.now()
      const states: RuntimeUiSlotState[] = []
      if (status && 'busy' in status) {
        states.push({ kind: 'status', slotId: 'kimi:status', threadId: providerSessionId, status: status.busy ? 'active' : 'idle', activeFlags: [], updatedAt })
        states.push({ kind: 'model', slotId: 'kimi:model', threadId: providerSessionId, modelId: status.model ?? null, modelLabel: status.model ?? null, modelProvider: null, serviceTier: null, supportsImages: null, supportsWebSearch: null, supportsNamespaceTools: null, updatedAt })
        states.push({ kind: 'config', slotId: 'kimi:config', threadId: providerSessionId, modelId: status.model ?? null, approvalPolicy: status.permission, sandboxMode: null, allowedApprovalPolicyCount: null, allowedSandboxModeCount: null, featureRequirementCount: null, webSearchModeCount: null, updatedAt })
        if (status.plan_mode) {
          states.push({
            kind: 'plan',
slotId: 'kimi:plan',
threadId: providerSessionId,
turnId: null,
            explanation: null,
content: 'Kimi plan mode is active.',
steps: [],
currentStep: null,
            pendingCount: 0,
inProgressCount: 0,
completedCount: 0,
updatedAt,
          })
        }
      }
      if (goal && 'goalId' in goal) {
        states.push({ kind: 'goal', slotId: 'kimi:goal', threadId: providerSessionId, objective: goal.objective, status: goal.status === 'complete' ? 'complete' : goal.status, tokenBudget: goal.budget.tokenBudget, tokensUsed: goal.tokensUsed, timeUsedSeconds: Math.floor(goal.wallClockMs / 1000), createdAt: updatedAt, updatedAt })
      }
      states.push({
        kind: 'approvals',
slotId: 'kimi:approvals',
threadId: providerSessionId,
turnId: null,
        pendingCount: approvals.items.length,
approvedCount: 0,
deniedCount: 0,
        recentItems: approvals.items.map(approval => ({ id: approval.approval_id, targetItemId: approval.tool_call_id, status: 'pending', label: approval.action, riskLevel: null, rationale: approval.tool_name, startedAt: null, completedAt: null })),
        updatedAt,
      })
      for (const question of questions.items) {
        states.push({
          kind: 'userInput',
slotId: 'kimi:questions',
threadId: providerSessionId,
          runId: `kimi:${question.question_id}`,
requestId: question.question_id,
          providerMethod: 'session.question.resolve',
toolCallId: question.tool_call_id ?? question.question_id,
          questionCount: question.questions.length,
          questions: question.questions.map(item => ({
            id: item.id,
header: item.header ?? '',
question: item.question,
            isOther: item.allow_other ?? false,
isSecret: false,
multiSelect: item.multi_select ?? false,
            options: item.options.map(option => ({ label: option.label, description: option.description ?? '' })),
          })),
          createdAt: updatedAt,
updatedAt,
        })
      }
      const taskItems: RuntimeProgressItem[] = tasks.items.map(task => ({
        id: task.id,
label: task.description,
        status: task.status === 'running' ? 'inProgress' : task.status === 'completed' ? 'completed' : 'pending',
        sourceStatus: task.status,
      }))
      states.push({
        kind: 'progress',
slotId: 'kimi:tasks',
threadId: providerSessionId,
turnId: null,
source: 'kimi.tasks',
items: taskItems,
        currentItem: taskItems.find(item => item.status === 'inProgress')?.label ?? null,
        pendingCount: taskItems.filter(item => item.status === 'pending').length,
        inProgressCount: taskItems.filter(item => item.status === 'inProgress').length,
        completedCount: taskItems.filter(item => item.status === 'completed').length,
        updatedAt,
      })
      states.push({
        kind: 'terminal',
slotId: 'kimi:terminal',
threadId: providerSessionId,
turnId: null,
        activeCount: terminals.items.filter(terminal => terminal.status === 'running').length,
        completedCount: terminals.items.filter(terminal => terminal.status === 'exited').length,
        failedCount: terminals.items.filter(terminal => terminal.exit_code !== null && terminal.exit_code !== undefined && terminal.exit_code !== 0).length,
        lastCommand: terminals.items.at(-1)?.shell ?? null,
lastOutputPreview: null,
        backgroundTerminals: terminals.items.filter(terminal => terminal.status === 'running').map(terminal => ({ itemId: terminal.id, processId: terminal.id, command: terminal.shell, cwd: terminal.cwd, osPid: null, cpuPercent: null, rssKb: null })),
updatedAt,
      })
      const mcpServers: RuntimeMcpServerSummary[] = mcp.servers.map(server => ({
        name: server.name,
        status: server.status === 'connected' ? 'ready' : server.status === 'connecting' ? 'starting' : server.status === 'error' ? 'failed' : 'cancelled',
        authStatus: 'unknown' as const,
toolCount: server.tool_count,
resourceCount: 0,
error: server.last_error ?? null,
      }))
      states.push({
        kind: 'mcp',
slotId: 'kimi:mcp',
threadId: providerSessionId,
serverCount: mcpServers.length,
        readyCount: mcpServers.filter(server => server.status === 'ready').length,
        failedCount: mcpServers.filter(server => server.status === 'failed').length,
        needsLoginCount: 0,
recentProgress: null,
servers: mcpServers,
updatedAt,
      })
      states.push({
        kind: 'skills',
slotId: 'kimi:skills',
threadId: providerSessionId,
enabledCount: skills.skills.length,
        disabledCount: 0,
errorCount: 0,
roots: [...new Set(skills.skills.map(skill => skill.path))],
updatedAt,
      })
      return states
    }
    finally { lease.release() }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const sessionId = input.runtimeSession.providerSessionId
    if (!sessionId) { throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId)) }
    const lease = await this.acquire(profile)
    const mapper = new KimiEventToChunkMapper()
    const queue: KimiStreamItem[] = []
    const bridgedApprovalIds = new Set<string>()
    const bridgedQuestionIds = new Set<string>()
    let resolveNext: (() => void) | null = null
    const unsubscribe = lease.resource.events.subscribe(sessionId, (event) => {
      queue.push({ event })
      resolveNext?.()
      resolveNext = null
    })
    try {
      const snapshot = readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
      const providerConfig = projectKimiProviderConfig(profile)
      await this.applyRuntimeSettings({ lease, sessionId, settings: input.providerOptions?.runtimeSettings })
      const prompt = await lease.resource.http.request(submitPrompt({
        client: lease.resource.http.client,
        path: { session_id: sessionId },
        body: {
          content: [{ type: 'text', text: extractProviderInputText(input.message) }],
          model: resolveKimiModelReference(providerConfig, input.modelId ?? snapshot.models.currentModelId),
        },
      }))
      if (!prompt || !('prompt_id' in prompt)) { throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'prompt.submit', 'Kimi did not accept the prompt.')) }
      for (;;) {
        while (queue.length === 0) { await new Promise<void>((resolve) => { resolveNext = resolve }) }
        const item = queue.shift()!
        if ('error' in item.event) {
          throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'websocket.reconnect', item.event.error))
        }
        if (!('seq' in item.event)) {
          await this.hydrateAfterResync({ lease, sessionId, input, handledApprovalIds: bridgedApprovalIds, handledQuestionIds: bridgedQuestionIds })
          continue
        }
        if (item.event.payload.type === 'agent.status.updated' && item.event.payload.phase?.kind === 'awaiting_approval') {
          await this.resolvePendingApprovals({ lease, sessionId, runId: input.runId, profile, handledIds: bridgedApprovalIds })
        }
        if (
          (item.event.payload.type === 'agent.status.updated' && item.event.payload.phase?.kind === 'awaiting_question')
          || (item.event.payload.type === 'event.session.status_changed' && item.event.payload.status === 'awaiting_question')
        ) {
          await this.resolvePendingQuestions({ lease, sessionId, input, handledIds: bridgedQuestionIds })
        }
        const chunks = mapper.map(item.event)
        for (const chunk of chunks) { yield chunk }
        if (item.event.payload.type === 'turn.ended') { return }
      }
    }
    finally {
      unsubscribe()
      lease.release()
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const sessionId = input.runtimeSession.providerSessionId
    if (!sessionId) { throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId)) }
    const lease = await this.acquire(profile)
    try {
      const prompt = await lease.resource.http.request(submitPrompt({ client: lease.resource.http.client, path: { session_id: sessionId }, body: { content: [{ type: 'text', text: extractProviderInputText(input.message) }] } }))
      if (!prompt || !('prompt_id' in prompt)) { throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'prompt.steer.submit', 'Kimi did not accept the steering prompt.')) }
      await lease.resource.http.request(steerPrompts({ client: lease.resource.http.client, path: { session_id: sessionId }, body: { prompt_ids: [prompt.prompt_id] } }))
    }
    finally { lease.release() }
  }

  async listBackgroundTerminals(input: ListBackgroundTerminalsInput): Promise<BackgroundTerminalListResult> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const sessionId = input.runtimeSession.providerSessionId
    if (!sessionId) { return { runtimeKind: this.runtimeKind, providerSessionId: null, terminals: [], nextCursor: null } }
    const lease = await this.acquire(profile)
    try {
      const result = await lease.resource.http.request(getApiV1SessionsBySessionIdTerminals({
        client: lease.resource.http.client,
path: { session_id: sessionId },
      }))
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: sessionId,
        terminals: result.items
          .filter(terminal => terminal.status === 'running')
          .map(terminal => ({ itemId: terminal.id, processId: terminal.id, command: terminal.shell, cwd: terminal.cwd, osPid: null, cpuPercent: null, rssKb: null })),
        nextCursor: null,
      }
    }
    finally { lease.release() }
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const lease = await this.acquire(profile)
    try {
      const sessions = await lease.resource.http.request(getApiV1Sessions({
        client: lease.resource.http.client,
        query: {
          before_id: input.cursor ?? undefined,
          page_size: input.limit ?? 50,
          busy: false,
          include_archive: input.archived ?? false,
          exclude_empty: false,
          archived_only: input.archived ?? false,
        },
      }))
      const search = input.searchTerm?.trim().toLocaleLowerCase()
      const items = search
        ? sessions.items.filter(session => `${session.title}\n${session.last_prompt ?? ''}`.toLocaleLowerCase().includes(search))
        : sessions.items
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: input.runtimeSession.providerSessionId,
        threads: items.map(projectKimiProviderThread),
        nextCursor: sessions.has_more && items.at(-1) ? items.at(-1)!.id : null,
        backwardsCursor: null,
      }
    }
    finally { lease.release() }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const lease = await this.acquire(profile)
    try {
      const session = await lease.resource.http.request(getApiV1SessionsBySessionId({
        client: lease.resource.http.client,
        path: { session_id: input.threadId },
      }))
      return { runtimeKind: this.runtimeKind, providerSessionId: input.runtimeSession.providerSessionId, thread: projectKimiProviderThread(session) }
    }
    finally { lease.release() }
  }

  async listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const lease = await this.acquire(profile)
    try {
      const result = await lease.resource.http.request(getApiV1SessionsBySessionIdMessages({
        client: lease.resource.http.client,
        path: { session_id: input.threadId },
        query: { before_id: input.cursor ?? undefined, page_size: input.limit ?? 100 },
      }))
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: input.runtimeSession.providerSessionId,
        threadId: input.threadId,
        turns: result.items.map(message => ({
          id: message.id,
          status: 'complete',
          startedAt: null,
          completedAt: null,
          durationMs: null,
          itemsView: 'full',
          items: [message],
        })),
        messages: result.items.flatMap(projectKimiUiMessage),
        nextCursor: result.has_more && result.items.at(-1) ? result.items.at(-1)!.id : null,
        backwardsCursor: null,
      }
    }
    finally { lease.release() }
  }

  async terminateBackgroundTerminal(input: TerminateBackgroundTerminalInput) {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const sessionId = input.runtimeSession.providerSessionId
    if (!sessionId) { return { runtimeKind: this.runtimeKind, providerSessionId: null, processId: input.processId, terminated: false } }
    const lease = await this.acquire(profile)
    try {
      const result = await lease.resource.http.request(closeTerminal({
        client: lease.resource.http.client,
        path: { session_id: sessionId, tail: input.processId },
      }))
      return { runtimeKind: this.runtimeKind, providerSessionId: sessionId, processId: input.processId, terminated: result.closed }
    }
    finally { lease.release() }
  }

  async submitUserInput(input: SubmitRuntimeUserInputInput) {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const sessionId = input.runtimeSession.providerSessionId
    if (!sessionId) { throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId)) }
    const lease = await this.acquire(profile)
    try {
      const pending = await lease.resource.http.request(getApiV1SessionsBySessionIdQuestions({
        client: lease.resource.http.client,
        path: { session_id: sessionId },
        query: { status: 'pending' },
      }))
      const question = pending.items.find(item => item.question_id === input.requestId)
      if (!question) { return null }
      await lease.resource.http.request(postApiV1SessionsBySessionIdQuestionsByTail({
        client: lease.resource.http.client,
        path: { session_id: sessionId, tail: input.requestId },
        body: { answers: projectKimiQuestionAnswers(question, input.answers) },
      }))
      return { requestId: input.requestId, answers: input.answers }
    }
    finally { lease.release() }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const sessionId = input.runtimeSession.providerSessionId
    if (!sessionId) { return }
    const lease = await this.acquire(profile)
    try {
      await lease.resource.http.request(promptAction({ client: lease.resource.http.client, path: { session_id: sessionId, tail: 'abort' } }))
    }
    finally { lease.release() }
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    const sessionId = input.runtimeSession.providerSessionId
    if (!sessionId) { return }
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const lease = await this.acquire(profile)
    try {
      await this.applyRuntimeSettings({ lease, sessionId, settings: input.settings })
    }
    finally { lease.release() }
  }

  private async acquire(profile: NonNullable<StartChatSessionInput['profile']>): Promise<KimiWebHostLease> {
    return await acquireKimiWebHostLease({
      runtimeKind: this.runtimeKind,
      providerTargetId: profile.providerTargetId,
      options: {
        command: KIMI_COMMAND,
        providerTargetId: profile.providerTargetId,
        providerConfig: projectKimiProviderConfig(profile),
        credential: profile.credentialRef ? this.deps.readSecret(profile.credentialRef) : null,
        mcpServers: getRegisteredMcpServers(),
      },
    })
  }

  private async applyRuntimeSettings(input: {
    lease: KimiWebHostLease
    sessionId: string
    settings: RuntimeSettings | null | undefined
  }): Promise<void> {
    const settings = readCodexLikeRuntimeSettings(input.settings)
    await input.lease.resource.http.request(postApiV1SessionsBySessionIdProfile({
      client: input.lease.resource.http.client,
      path: { session_id: input.sessionId },
      body: {
        agent_config: {
          permission_mode: settings.accessMode === 'full-access' ? 'yolo' : 'manual',
          plan_mode: settings.interactionMode === 'plan',
        },
      },
    }))
  }

  private async resolvePendingApprovals(input: {
    lease: KimiWebHostLease
    sessionId: string
    runId: string
    profile: NonNullable<StartChatSessionInput['profile']>
    handledIds: Set<string>
  }): Promise<void> {
    const pending = await input.lease.resource.http.request(getApiV1SessionsBySessionIdApprovals({
      client: input.lease.resource.http.client,
      path: { session_id: input.sessionId },
      query: { status: 'pending' },
    }))
    for (const approval of pending.items) {
      if (input.handledIds.has(approval.approval_id)) { continue }
      input.handledIds.add(approval.approval_id)
      const resolution = await requestProviderToolApproval({
        deps: this.deps,
        sessionId: input.sessionId,
        runId: input.runId,
        providerRequestId: approval.approval_id,
        providerKind: input.profile.providerKind ?? 'openai-compatible',
        runtimeKind: this.runtimeKind,
        providerMethod: 'session.approval.resolve',
        toolCallId: approval.tool_call_id,
        metadata: { action: approval.action, toolName: approval.tool_name, input: approval.tool_input_display },
      })
      await input.lease.resource.http.request(postApiV1SessionsBySessionIdApprovalsByApprovalId({
        client: input.lease.resource.http.client,
        path: { session_id: input.sessionId, approval_id: approval.approval_id },
        body: { decision: resolution.approved ? 'approved' : 'rejected' },
      }))
    }
  }

  private async resolvePendingQuestions(input: {
    lease: KimiWebHostLease
    sessionId: string
    input: StreamTurnInput
    handledIds: Set<string>
  }): Promise<void> {
    if (!this.deps.requestUserInput) {
      throw new ProviderRuntimeError(ProviderErrors.requestFailed(
        this.runtimeKind,
        'session.question.resolve',
        'Chat Runtime does not expose pending user input handling for Kimi questions.',
      ))
    }
    const pending = await input.lease.resource.http.request(getApiV1SessionsBySessionIdQuestions({
      client: input.lease.resource.http.client,
      path: { session_id: input.sessionId },
      query: { status: 'pending' },
    }))
    for (const question of pending.items) {
      if (input.handledIds.has(question.question_id)) { continue }
      input.handledIds.add(question.question_id)
      const resolution = await this.deps.requestUserInput({
        sessionId: input.input.runtimeSession.chatSessionId,
        runId: input.input.runId,
        providerRequestId: question.question_id,
        providerKind: input.input.profile?.providerKind ?? 'universal',
        runtimeKind: this.runtimeKind,
        providerMethod: 'session.question.resolve',
        toolCallId: question.tool_call_id ?? question.question_id,
        questions: question.questions.map(item => ({
          id: item.id,
          header: item.header ?? '',
          question: item.question,
          isOther: item.allow_other ?? false,
          isSecret: false,
          multiSelect: item.multi_select ?? false,
          options: item.options.map(option => ({ label: option.label, description: option.description ?? '' })),
        })),
        metadata: { kimi: { sessionId: input.sessionId, questionId: question.question_id } },
      })
      await input.lease.resource.http.request(postApiV1SessionsBySessionIdQuestionsByTail({
        client: input.lease.resource.http.client,
        path: { session_id: input.sessionId, tail: question.question_id },
        body: { answers: projectKimiQuestionAnswers(question, resolution.answers) },
      }))
    }
  }

  private async hydrateAfterResync(input: {
    lease: KimiWebHostLease
    sessionId: string
    input: StreamTurnInput
    handledApprovalIds: Set<string>
    handledQuestionIds: Set<string>
  }): Promise<void> {
    const status = await input.lease.resource.http.request(getApiV1SessionsBySessionIdStatus({
      client: input.lease.resource.http.client,
      path: { session_id: input.sessionId },
    }))
    if (status.busy) {
      await this.resolvePendingApprovals({
        lease: input.lease,
        sessionId: input.sessionId,
        runId: input.input.runId,
        profile: requireRuntimeProviderTargetProfile(input.input.profile, this.runtimeKind),
        handledIds: input.handledApprovalIds,
      })
      await this.resolvePendingQuestions({
        lease: input.lease,
        sessionId: input.sessionId,
        input: input.input,
        handledIds: input.handledQuestionIds,
      })
    }
  }
}

interface KimiStreamItem { event: Parameters<KimiWebHostLease['resource']['events']['subscribe']>[1] extends (event: infer Event) => void ? Event : never }

type KimiPendingQuestion = Extract<
  GetApiV1SessionsBySessionIdQuestionsResponses[200],
  { code: 0 }
>['data']['items'][number]

function projectKimiQuestionAnswers(
  question: KimiPendingQuestion,
  answers: RuntimeUserInputResolution['answers'],
) {
  return Object.fromEntries(question.questions.map((item) => {
    const selected = answers[item.id] ?? []
    const optionIds = selected
      .map(answer => item.options.find(option => option.id === answer || option.label === answer)?.id)
      .filter((value): value is string => value !== undefined)
    const other = selected.find(answer => !item.options.some(option => option.id === answer || option.label === answer))
    if (other && optionIds.length > 0) { return [item.id, { kind: 'multi_with_other' as const, option_ids: optionIds, other_text: other }] }
    if (other) { return [item.id, { kind: 'other' as const, text: other }] }
    if (item.multi_select && optionIds.length > 0) { return [item.id, { kind: 'multi' as const, option_ids: optionIds }] }
    if (optionIds[0]) { return [item.id, { kind: 'single' as const, option_id: optionIds[0] }] }
    return [item.id, { kind: 'skipped' as const }]
  }))
}

function projectKimiProviderThread(session: {
  id: string
  title: string
  last_prompt?: string
  archived?: boolean
  busy: boolean
  agent_config: { model: string }
  metadata: { cwd: string }
}): ProviderThread {
  return {
    id: session.id,
    providerSessionTreeId: null,
    forkedFromId: null,
    preview: session.last_prompt ?? null,
    ephemeral: false,
    modelProvider: null,
    createdAt: null,
    updatedAt: null,
    status: session.archived ? 'archived' : session.busy ? 'active' : 'idle',
    sourceKind: 'unknown',
    source: { runtime: 'kimi' },
    threadSource: { runtime: 'kimi' },
    agentNickname: null,
    agentRole: null,
    name: session.title,
    cwd: session.metadata.cwd,
  }
}

function projectKimiUiMessage(message: {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: Array<
    | { type: 'text', text: string }
    | { type: 'thinking', thinking: string }
    | { type: 'tool_use', tool_call_id: string, tool_name: string, input: unknown }
    | { type: 'tool_result', tool_call_id: string, output: unknown, is_error?: boolean }
    | { type: 'image', source: unknown }
    | { type: 'video', source: unknown }
    | { type: 'file', file_id: string, media_type: string, name: string, size: number }
  >
}): UIMessage[] {
  if (message.role === 'tool') { return [] }
  const parts: UIMessage['parts'] = []
  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        parts.push({ type: 'text', text: part.text })
        break
      case 'thinking':
        parts.push({ type: 'reasoning', text: part.thinking })
        break
      default:
        break
    }
  }
  if (parts.length === 0) { return [] }
  return [{ id: message.id, role: message.role, parts }]
}
