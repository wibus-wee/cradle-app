import type {
  Agent as OpencodeAgent,
  AssistantMessage as OpencodeAssistantMessage,
  Config,
  Event as OpencodeEvent,
  File as OpencodeFile,
  McpStatus as OpencodeMcpStatus,
  Message as OpencodeMessage,
  Part as OpencodePart,
  Permission as OpencodePermission,
  Session as OpencodeSession,
  SessionStatus as OpencodeSessionStatus,
  Todo as OpencodeTodo,
} from '@opencode-ai/sdk'
import type { UIMessage, UIMessageChunk } from 'ai'

import type {
  CancelTurnInput,
  ChatRuntime,
  ExecuteShellCommandInput,
  ExecuteShellCommandResult,
  ForkRuntimeSessionInput,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetUiSlotStatesInput,
  ListRuntimeModelsInput,
  ProviderContext,
  ProviderThread,
  ProviderThreadDeleteInput,
  ProviderThreadDeleteResult,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadTurn,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  QuickQuestionInput,
  ResumeChatSessionInput,
  RollbackLastTurnInput,
  RollbackLastTurnResult,
  RuntimeLiveResourceLease,
  RuntimeModelCatalog,
  RuntimePresentationCapabilities,
  RuntimeSession,
  RuntimeUiSlotState,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
  UpdateRuntimeSettingsInput,
} from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'
import { providerChunk } from '../kit/chunk-mapper'
import { requestProviderToolApproval } from '../kit/permission-bridge'
import { readProviderStateSnapshot } from '../provider-state-snapshot'
import { resolveOpencodeConfig } from './config'
import { OpencodeEventStreamProjector, readOpencodeTerminalAssistantForTurn } from './event-stream'
import {
  projectOpencodePromptParts,
  projectOpencodeQuickQuestionParts,
  readOpencodeSlashCommandInvocation,
} from './input-projector'
import {
  OPENCODE_RUNTIME_CAPABILITIES,
  OPENCODE_RUNTIME_KIND,
  OPENCODE_RUNTIME_METADATA,
} from './metadata'
import { listOpencodeRuntimeModels, OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID } from './model-inventory'
import { OPENCODE_RUNTIME_OWNED_PROVIDER_TARGETS } from './owned-provider-targets'
import { createOpencodeRuntimePresentation } from './presentation'
import type { OpencodeRuntimeResource } from './runtime-context'
import { acquireOpencodeRuntimeResource } from './runtime-context'
import { buildOpencodePermissionInput, buildOpencodePermissionOutput } from './tools/mapper'

interface OpencodeTurnResult {
  data: {
    info: OpencodeAssistantMessage
    parts: OpencodePart[]
  } | undefined
  error: unknown | undefined
}

interface OpencodePermissionApprovalRecord {
  id: string
  targetItemId: string | null
  status: 'pending' | 'approved' | 'denied'
  label: string
  riskLevel: string | null
  rationale: string | null
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

export function createOpencodeProvider(ctx: ProviderContext): ChatRuntime {
  return new OpencodeProvider(ctx)
}

export class OpencodeProvider implements ChatRuntime {
  readonly runtimeKind = OPENCODE_RUNTIME_KIND
  readonly metadata = OPENCODE_RUNTIME_METADATA
  readonly capabilities = OPENCODE_RUNTIME_CAPABILITIES
  readonly ownedProviderTargets = OPENCODE_RUNTIME_OWNED_PROVIDER_TARGETS

  private _lastUsage: TokenUsage | null = null
  private _lastModelId: string | null = null
  private readonly activePermissionIds = new Set<string>()
  private readonly permissionApprovalsByChatSessionId = new Map<string, OpencodePermissionApprovalRecord[]>()

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastModelId(): string | null {
    return this._lastModelId
  }

  constructor(private readonly deps: ProviderContext) {}

  async listModels(input: ListRuntimeModelsInput): Promise<RuntimeModelCatalog> {
    return await listOpencodeRuntimeModels({
      runtimeKind: this.runtimeKind,
      workspacePath: input.workspacePath,
    })
  }

  getDraftPresentation(): RuntimePresentationCapabilities {
    return createOpencodeRuntimePresentation()
  }

  async getPresentation(input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const result = await handle.client.command.list({
      query: { directory: input.workspacePath },
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'command.list', formatOpencodeError(result.error)),
      )
    }
    return createOpencodeRuntimePresentation(result.data)
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) {
      return []
    }

    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const snapshot = readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const modelId = input.modelId ?? snapshot.models.currentModelId ?? null
    const providerModel = parseOpenCodeModelRef(modelId)
    const updatedAt = Date.now()
    const [status, todos, diff, mcpStatus, fileStatus, agents] = await Promise.all([
      readOpencodeSessionStatus(handle, input.workspacePath, providerSessionId),
      readOpencodeSessionTodo(handle, input.workspacePath, providerSessionId),
      readOpencodeSessionDiff(handle, input.workspacePath, providerSessionId),
      readOpencodeMcpStatus(handle, input.workspacePath),
      readOpencodeFileStatus(handle, input.workspacePath),
      readOpencodeAgents(handle, input.workspacePath),
    ])
    const approvalRecords = this.permissionApprovalsByChatSessionId.get(input.runtimeSession.chatSessionId) ?? []
    const states: RuntimeUiSlotState[] = [
      {
        kind: 'status',
        slotId: 'opencode:status',
        threadId: providerSessionId,
        status: projectOpencodeRuntimeThreadStatus(status),
        activeFlags: status?.type === 'retry' ? [`retry:${status.attempt}`] : [],
        updatedAt,
      },
      {
        kind: 'model',
        slotId: 'opencode:model',
        threadId: providerSessionId,
        modelId,
        modelLabel: providerModel?.modelID ?? modelId,
        modelProvider: providerModel?.providerID ?? null,
        serviceTier: null,
        supportsImages: null,
        supportsWebSearch: null,
        supportsNamespaceTools: null,
        updatedAt,
      },
    ]
    if (todos.length > 0) {
      states.push(projectOpencodeProgressState(providerSessionId, todos, updatedAt))
    }
    if (diff.length > 0) {
      states.push({
        kind: 'diff',
        slotId: 'opencode:diff',
        threadId: providerSessionId,
        turnId: null,
        fileCount: diff.length,
        addedLines: diff.reduce((sum, file) => sum + file.additions, 0),
        removedLines: diff.reduce((sum, file) => sum + file.deletions, 0),
        hasDiff: diff.length > 0,
        updatedAt,
      })
    }
    if (approvalRecords.length > 0) {
      states.push({
        kind: 'approvals',
        slotId: 'opencode:approvals',
        threadId: providerSessionId,
        turnId: null,
        pendingCount: approvalRecords.filter(record => record.status === 'pending').length,
        approvedCount: approvalRecords.filter(record => record.status === 'approved').length,
        deniedCount: approvalRecords.filter(record => record.status === 'denied').length,
        recentItems: approvalRecords.map(record => ({
          id: toOpencodePermissionToolCallId(record.id),
          targetItemId: record.targetItemId,
          status: record.status,
          label: record.label,
          riskLevel: record.riskLevel,
          rationale: record.rationale,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
        })),
        updatedAt,
      })
    }
    if (mcpStatus.size > 0) {
      states.push(projectOpencodeMcpState(providerSessionId, mcpStatus, updatedAt))
    }
    if (fileStatus.length > 0) {
      states.push(projectOpencodeFilesystemState(providerSessionId, fileStatus, updatedAt))
    }
    if (agents.length > 0) {
      states.push(projectOpencodeCrewState(providerSessionId, agents, updatedAt))
    }
    return states
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: input.modelId,
    })
    const lease = await acquireOpencodeRuntimeResource({
      runtimeKind: this.runtimeKind,
      providerTargetId: resolved.hostProviderTargetId,
      chatSessionId: input.chatSessionId,
      config: resolved.config,
      directory: input.workspacePath,
    })

    let leaseTransferred = false
    try {
      const session = await this.createNativeSession(lease.resource, input.workspacePath, input.chatSessionId)
      leaseTransferred = true
      return {
        id: input.chatSessionId,
        chatSessionId: input.chatSessionId,
        providerTargetId: resolved.providerTargetId,
        runtimeKind: this.runtimeKind,
        providerSessionId: session.id,
        providerRuntimeLease: lease,
        providerStateSnapshot: JSON.stringify({
          workspacePath: input.workspacePath,
          models: { currentModelId: resolved.modelId },
          opencode: {
            serverUrl: lease.resource.server.url,
            providerModel: resolved.model,
          },
        }),
      }
    }
    finally {
      if (!leaseTransferred) {
        lease.release()
      }
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: input.modelId,
    })
    const lease = await acquireOpencodeRuntimeResource({
      runtimeKind: this.runtimeKind,
      providerTargetId: resolved.hostProviderTargetId,
      chatSessionId: input.runtimeSession.chatSessionId,
      config: resolved.config,
      directory: input.workspacePath,
    })

    const snapshot = readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      runtimeKind: this.runtimeKind,
      providerRuntimeLease: lease,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        models: { currentModelId: resolved.modelId ?? snapshot.models.currentModelId },
        opencode: {
          serverUrl: lease.resource.server.url,
          providerModel: resolved.model,
        },
      }),
    }
  }

  async forkRuntimeSession(input: ForkRuntimeSessionInput): Promise<RuntimeSession> {
    const sourceSessionId = input.sourceRuntimeSession.providerSessionId
    if (!sourceSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.sourceRuntimeSession.chatSessionId))
    }

    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: input.modelId,
    })
    const sourceLease = input.sourceRuntimeSession.providerRuntimeLease as RuntimeLiveResourceLease<OpencodeRuntimeResource> | undefined
    const lease = sourceLease
      ? createOpencodeChildRuntimeLease(sourceLease.resource)
      : await acquireOpencodeRuntimeResource({
          runtimeKind: this.runtimeKind,
          providerTargetId: resolved.hostProviderTargetId,
          chatSessionId: input.childChatSessionId,
          config: resolved.config,
          directory: input.workspacePath,
        })
    let leaseTransferred = false
    try {
      const resource = lease.resource as OpencodeRuntimeResource
      const result = await resource.client.session.fork({
        path: { id: sourceSessionId },
        query: { directory: input.workspacePath },
        body: {},
      })
      if (result.error) {
        throw new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, 'session.fork', formatOpencodeError(result.error)),
        )
      }
      const session = result.data
      if (!session) {
        throw new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, 'session.fork', 'opencode returned no forked session'),
        )
      }
      leaseTransferred = true
      return {
        id: input.childChatSessionId,
        chatSessionId: input.childChatSessionId,
        providerTargetId: resolved.providerTargetId,
        runtimeKind: this.runtimeKind,
        providerSessionId: session.id,
        providerRuntimeLease: lease,
        providerStateSnapshot: JSON.stringify({
          workspacePath: input.workspacePath,
          models: { currentModelId: resolved.modelId },
          opencode: {
            serverUrl: resource.server.url,
            providerModel: resolved.model,
            sideConversation: {
              sessionId: session.id,
              liveFork: true,
              parentSessionId: sourceSessionId,
              updatedAt: Date.now(),
            },
          },
        }),
      }
    }
    finally {
      if (!leaseTransferred) {
        lease.release()
      }
    }
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId || !supportsOpencodeProviderThreadSourceKinds(input.sourceKinds)) {
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId,
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      }
    }

    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const result = await handle.client.session.list({
      query: { directory: input.workspacePath },
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.list', formatOpencodeError(result.error)),
      )
    }
    const sessions = result.data ?? []

    const sortKey = input.sortKey ?? 'updated_at'
    const sortDirection = input.sortDirection ?? 'desc'
    const searchTerm = normalizeProviderThreadText(input.searchTerm)
    const childCounts = countOpencodeSessionChildren(sessions)
    const visibleSessions = input.archived ? [] : sessions
    const threads = visibleSessions
      .map(session => projectOpencodeProviderThread(session, childCounts.get(session.id) ?? 0))
      .filter(thread => !searchTerm || opencodeProviderThreadMatchesSearch(thread, searchTerm))
      .sort((left, right) => compareOpencodeProviderThreads(left, right, sortKey, sortDirection))

    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = threads.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId,
      threads: page,
      nextCursor: offset + limit < threads.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const result = await handle.client.session.get({
      path: { id: input.threadId },
      query: { directory: input.workspacePath },
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.get', formatOpencodeError(result.error)),
      )
    }
    if (!result.data) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.get', 'opencode returned no session'),
      )
    }
    const children = await readOpencodeSessionChildren(handle, input.workspacePath, input.threadId)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: input.runtimeSession.providerSessionId,
      thread: projectOpencodeProviderThread(result.data, children.length),
    }
  }

  async deleteProviderThread(input: ProviderThreadDeleteInput): Promise<ProviderThreadDeleteResult> {
    if (input.threadId === input.runtimeSession.providerSessionId) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.delete', 'Cannot delete the active OpenCode runtime session through the provider-thread API'),
      )
    }
    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const result = await handle.client.session.delete({
      path: { id: input.threadId },
      query: { directory: input.workspacePath },
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.delete', formatOpencodeError(result.error)),
      )
    }
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: input.runtimeSession.providerSessionId,
      threadId: input.threadId,
      deleted: true,
    }
  }

  async updateRuntimeSettings(_input: UpdateRuntimeSettingsInput): Promise<void> {
    // OpenCode mode is applied per turn in streamTurn via providerOptions.runtimeSettings.
  }

  async listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult> {
    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const result = await handle.client.session.messages({
      path: { id: input.threadId },
      query: { directory: input.workspacePath, limit: 200 },
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.messages', formatOpencodeError(result.error)),
      )
    }

    const sortDirection = input.sortDirection ?? 'asc'
    const rows = result.data ?? []
    const ordered = [...rows].sort((left, right) => readOpencodeMessageCreatedAt(left.info) - readOpencodeMessageCreatedAt(right.info))
    const messages = sortDirection === 'desc' ? ordered.reverse() : ordered
    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = messages.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: input.runtimeSession.providerSessionId,
      threadId: input.threadId,
      turns: page.map(projectOpencodeProviderThreadTurn),
      messages: projectOpencodeProviderThreadMessages(input.threadId, page),
      nextCursor: offset + limit < messages.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
  }

  async* quickQuestion(input: QuickQuestionInput): AsyncGenerator<UIMessageChunk, void, void> {
    const snapshot = readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: snapshot.models.currentModelId,
    })
    const resource = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const session = await this.createNativeSession(
      resource,
      input.workspacePath,
      `${input.runtimeSession.chatSessionId} quick question`,
    )
    const projector = new OpencodeEventStreamProjector(session.id)

    try {
      const result = await resource.client.session.prompt({
        path: { id: session.id },
        query: { directory: input.workspacePath },
        body: {
          ...(resolved.model ? { model: resolved.model } : {}),
          parts: projectOpencodeQuickQuestionParts({
            question: input.question,
            transcript: input.transcript,
          }),
        },
      })

      if (result.error) {
        throw new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, 'quickQuestion', formatOpencodeError(result.error)),
        )
      }
      if (result.data.info.error) {
        throw new ProviderRuntimeError(
          ProviderErrors.requestFailed(
            this.runtimeKind,
            'quickQuestion',
            formatOpencodeAssistantError(result.data.info.error),
          ),
        )
      }

      for (const chunk of projector.projectPromptResult(result.data)) {
        yield chunk
      }
      yield projector.finish(result.data.info)
    }
    finally {
      await resource.client.session.delete({
        path: { id: session.id },
        query: { directory: input.workspacePath },
      }).catch(() => undefined)
    }
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) {
      return null
    }

    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: input.modelId,
    })
    const titleModel = parseOpenCodeModelRef(resolved.config.small_model) ?? resolved.model
    if (!titleModel) {
      return null
    }

    const summarizeResult = await handle.client.session.summarize({
      path: { id: providerSessionId },
      query: { directory: input.workspacePath },
      body: titleModel,
    })
    if (summarizeResult.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.summarize', formatOpencodeError(summarizeResult.error)),
      )
    }

    const sessionResult = await handle.client.session.get({
      path: { id: providerSessionId },
      query: { directory: input.workspacePath },
    })
    if (sessionResult.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.get', formatOpencodeError(sessionResult.error)),
      )
    }

    const title = sessionResult.data.title.trim()
    if (!title) {
      return null
    }

    const updateResult = await handle.client.session.update({
      path: { id: providerSessionId },
      query: { directory: input.workspacePath },
      body: { title },
    })
    if (updateResult.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.update', formatOpencodeError(updateResult.error)),
      )
    }
    return title
  }

  async executeShellCommand(input: ExecuteShellCommandInput): Promise<ExecuteShellCommandResult> {
    const command = input.command.trim()
    if (!command) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'executeShellCommand', 'opencode shell command must not be empty'),
      )
    }

    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: input.modelId,
    })
    const startedAt = Date.now()
    const result = await handle.client.session.shell({
      path: { id: providerSessionId },
      query: { directory: input.workspacePath },
      body: {
        agent: 'build',
        ...(resolved.model ? { model: resolved.model } : {}),
        command,
      },
      signal: input.signal,
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.shell', formatOpencodeError(result.error)),
      )
    }
    if (result.data.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.shell', formatOpencodeAssistantError(result.data.error)),
      )
    }

    const messageResult = await handle.client.session.message({
      path: { id: providerSessionId, messageID: result.data.id },
      query: { directory: input.workspacePath },
    })
    if (messageResult.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.message', formatOpencodeError(messageResult.error)),
      )
    }

    const shell = projectOpencodeShellResult(messageResult.data.parts)
    return {
      command,
      stdout: shell.stdout,
      stderr: shell.stderr,
      exitCode: null,
      durationMs: shell.durationMs ?? Math.max(0, Date.now() - startedAt),
      timedOut: false,
      truncated: false,
    }
  }

  async rollbackLastTurn(input: RollbackLastTurnInput): Promise<RollbackLastTurnResult> {
    const providerSessionId = input.runtimeSession.providerSessionId
    if (!providerSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    const handle = readOpencodeRuntimeHandle(this.runtimeKind, input.runtimeSession)
    const messagesResult = await handle.client.session.messages({
      path: { id: providerSessionId },
      query: { directory: input.workspacePath, limit: 50 },
    })
    if (messagesResult.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.messages', formatOpencodeError(messagesResult.error)),
      )
    }

    const message = readLastAssistantMessage(messagesResult.data)
    if (!message) {
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId,
        rolledBackTurns: 0,
        fileChangesReverted: false,
      }
    }

    const revertResult = await handle.client.session.revert({
      path: { id: providerSessionId },
      query: { directory: input.workspacePath },
      body: { messageID: message.id },
    })
    if (revertResult.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.revert', formatOpencodeError(revertResult.error)),
      )
    }

    return {
      runtimeKind: this.runtimeKind,
      providerSessionId,
      rolledBackTurns: 1,
      fileChangesReverted: false,
      providerResult: revertResult.data,
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const initialOpencodeSessionId = input.runtimeSession.providerSessionId
    const lease = input.runtimeSession.providerRuntimeLease
    if (!initialOpencodeSessionId || !lease) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: input.modelId,
    })
    this._lastUsage = null
    this._lastModelId = resolved.modelId

    const resource = lease.resource as OpencodeRuntimeResource
    let opencodeSessionId = initialOpencodeSessionId
    let projector = new OpencodeEventStreamProjector(opencodeSessionId)
    const chunks = new AsyncChunkQueue()
    const eventAbortController = new AbortController()
    let asyncPromptBaselineMessageIds: ReadonlySet<string> | null = null
    let asyncPromptDispatchStarted = false
    let asyncPromptSubmitted = false
    let eventStreamEnded = false
    let asyncPromptSessionBecameBusy = false
    let asyncPromptSessionBecameIdle = false
    let eventStreamRecoveryStarted = false
    let retriedWithFreshSession = false

    const submitAsyncPromptTurn = async (): Promise<void> => {
      asyncPromptDispatchStarted = true
      asyncPromptBaselineMessageIds = await this.readAsyncPromptBaselineMessageIds({
        resource,
        sessionId: opencodeSessionId,
        workspacePath: input.workspacePath,
        chunks,
      })
      if (!asyncPromptBaselineMessageIds) {
        return
      }
      projector.ignoreMessages(asyncPromptBaselineMessageIds)
      const submission = await submitOpencodeTurn(resource, {
        sessionId: opencodeSessionId,
        workspacePath: input.workspacePath,
        model: resolved.model,
        agent: readOpencodeTurnAgent(input),
        useAsyncPrompt: true,
        systemPrompt: input.systemPrompt,
        message: input.message,
      })
      const { operation, result } = submission

      if (chunks.done) {
        return
      }
      if (result.error) {
        chunks.fail(new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, operation, formatOpencodeError(result.error)),
        ))
        return
      }
      if (operation === 'session.promptAsync') {
        asyncPromptSubmitted = true
        await recoverAsyncPromptIfTerminalSignalObserved()
        return
      }
      const data = result.data
      if (!data) {
        chunks.fail(new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, operation, 'opencode returned no turn data'),
        ))
        return
      }
      if (data.info.error) {
        chunks.fail(new ProviderRuntimeError(
          ProviderErrors.requestFailed(
            this.runtimeKind,
            operation,
            formatOpencodeAssistantError(data.info.error),
          ),
        ))
        return
      }

      for (const chunk of projector.projectPromptResult(data)) {
        chunks.push(chunk)
      }
      this._lastUsage = projector.usage
      chunks.push(projector.finish(data.info))
      chunks.close()
    }

    const retryAsyncPromptWithFreshSession = async (): Promise<void> => {
      if (retriedWithFreshSession || chunks.done) {
        return
      }
      retriedWithFreshSession = true
      const previousSessionId = opencodeSessionId
      const session = await this.createNativeSession(resource, input.workspacePath, input.runtimeSession.chatSessionId)
      opencodeSessionId = session.id
      input.runtimeSession.providerSessionId = session.id
      projector = new OpencodeEventStreamProjector(opencodeSessionId)
      asyncPromptBaselineMessageIds = null
      asyncPromptDispatchStarted = false
      asyncPromptSubmitted = false
      asyncPromptSessionBecameBusy = false
      asyncPromptSessionBecameIdle = false
      eventStreamRecoveryStarted = false
      chunks.push({
        type: 'data-runtime-event',
        data: {
          kind: 'opencode.session.recovered',
          previousSessionId,
          sessionId: opencodeSessionId,
        },
      })
      await submitAsyncPromptTurn()
    }

    const recoverAsyncPromptIfTerminalSignalObserved = async (): Promise<void> => {
      if (
        !asyncPromptBaselineMessageIds
        || eventStreamRecoveryStarted
        || chunks.done
      ) {
        return
      }
      const shouldRecoverFromEndedStream = eventStreamEnded && asyncPromptSubmitted
      const shouldRecoverFromIdleSession
        = asyncPromptDispatchStarted && asyncPromptSessionBecameBusy && asyncPromptSessionBecameIdle
      if (!shouldRecoverFromEndedStream && !shouldRecoverFromIdleSession) {
        return
      }
      eventStreamRecoveryStarted = true
      const recovered = await this.closeAsyncPromptTurnFromHistory({
        resource,
        projector,
        chunks,
        sessionId: opencodeSessionId,
        workspacePath: input.workspacePath,
        baselineMessageIds: asyncPromptBaselineMessageIds,
      })
      if (recovered) {
        return
      }
      if (shouldRecoverFromIdleSession && !retriedWithFreshSession) {
        await retryAsyncPromptWithFreshSession()
        return
      }
      chunks.fail(new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'session.promptAsync',
          shouldRecoverFromIdleSession
            ? 'opencode session became idle before the async prompt produced a terminal assistant message'
            : 'opencode event stream ended before the async prompt produced a terminal assistant message',
        ),
      ))
    }

    try {
      const subscription = await resource.client.event.subscribe({
        ...(input.workspacePath ? { query: { directory: input.workspacePath } } : {}),
        signal: eventAbortController.signal,
        sseMaxRetryAttempts: 0,
      })
      void (async () => {
        try {
          for await (const event of subscription.stream) {
            if (isOpencodeSessionStatusEvent(event, opencodeSessionId, 'busy')) {
              asyncPromptSessionBecameBusy = true
            }
            if (
              isOpencodeSessionStatusEvent(event, opencodeSessionId, 'idle')
              || isOpencodeSessionIdleEvent(event, opencodeSessionId)
            ) {
              asyncPromptSessionBecameIdle = true
            }
            if (event.type === 'permission.updated') {
              await this.handleOpencodePermissionEvent({
                input,
                resource,
                chunks,
                permission: event.properties,
              })
            }
            for (const chunk of projector.projectEvent(event)) {
              chunks.push(chunk)
            }
            const terminalAssistant = asyncPromptBaselineMessageIds
              ? readOpencodeTerminalAssistantForTurn(event, {
                  sessionId: opencodeSessionId,
                  baselineMessageIds: asyncPromptBaselineMessageIds,
                })
              : null
            if (terminalAssistant) {
              await this.closeAsyncPromptTurn({
                resource,
                projector,
                chunks,
                sessionId: opencodeSessionId,
                workspacePath: input.workspacePath,
                assistant: terminalAssistant,
              })
              return
            }
            await recoverAsyncPromptIfTerminalSignalObserved()
          }
          eventStreamEnded = true
          await recoverAsyncPromptIfTerminalSignalObserved()
        }
        catch (error) {
          if (!eventAbortController.signal.aborted) {
            chunks.push({
              type: 'data-runtime-event',
              data: {
                kind: 'opencode.event-stream-error',
                message: formatOpencodeError(error),
              },
            })
          }
        }
      })()
    }
    catch {
      // The final prompt response remains a complete recovery path when SSE is unavailable.
    }

    void submitAsyncPromptTurn().catch(error => chunks.fail(error))

    try {
      for await (const chunk of chunks) {
        yield chunk
      }
    }
    finally {
      eventAbortController.abort()
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const opencodeSessionId = input.runtimeSession.providerSessionId
    const lease = input.runtimeSession.providerRuntimeLease
    if (!opencodeSessionId || !lease) {
      return
    }

    try {
      await (lease.resource as OpencodeRuntimeResource).client.session.abort({
        path: { id: opencodeSessionId },
      })
    }
    catch {
      // opencode abort is best-effort from the unified runtime boundary.
    }
  }

  private async handleOpencodePermissionEvent(input: {
    input: StreamTurnInput
    resource: OpencodeRuntimeResource
    chunks: AsyncChunkQueue
    permission: OpencodePermission
  }): Promise<void> {
    const permission = input.permission
    if (permission.sessionID !== input.input.runtimeSession.providerSessionId) {
      return
    }

    const toolCallId = toOpencodePermissionToolCallId(permission.id)
    if (this.activePermissionIds.has(toolCallId)) {
      return
    }
    this.activePermissionIds.add(toolCallId)
    this.recordPermissionApproval({
      chatSessionId: input.input.runtimeSession.chatSessionId,
      permission,
      status: 'pending',
    })

    input.chunks.push(providerChunk.toolInputStart(toolCallId, 'server_request_opencode_permission'))
    input.chunks.push(providerChunk.toolInputAvailable({
      toolCallId,
      toolName: 'server_request_opencode_permission',
      input: buildOpencodePermissionInput(permission),
    }))
    input.chunks.push(providerChunk.toolApprovalRequest(toolCallId))

    try {
      const profileProviderKind = input.input.profile?.providerKind ?? 'universal'
      const resolution = await requestProviderToolApproval({
        deps: this.deps,
        sessionId: input.input.runtimeSession.chatSessionId,
        runId: input.input.runId,
        providerRequestId: permission.id,
        providerKind: profileProviderKind,
        runtimeKind: this.runtimeKind,
        providerMethod: 'permission.updated',
        toolCallId,
        metadata: { permission },
      })
      const response = resolution.approved ? 'once' : 'reject'
      const reply = await input.resource.client.postSessionIdPermissionsPermissionId({
        path: {
          id: permission.sessionID,
          permissionID: permission.id,
        },
        query: { directory: input.input.workspacePath },
        body: { response },
      })
      if (reply.error) {
        throw new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, 'permission.reply', formatOpencodeError(reply.error)),
        )
      }
      this.recordPermissionApproval({
        chatSessionId: input.input.runtimeSession.chatSessionId,
        permission,
        status: resolution.approved ? 'approved' : 'denied',
      })
      input.chunks.push(providerChunk.toolOutputAvailable({
        toolCallId,
        output: buildOpencodePermissionOutput({
          permission,
          response,
          approved: resolution.approved,
          reason: resolution.reason,
        }),
      }))
    }
    catch (error) {
      this.recordPermissionApproval({
        chatSessionId: input.input.runtimeSession.chatSessionId,
        permission,
        status: 'denied',
      })
      input.chunks.push(providerChunk.toolOutputError(toolCallId, formatOpencodeError(error)))
      await input.resource.client.postSessionIdPermissionsPermissionId({
        path: {
          id: permission.sessionID,
          permissionID: permission.id,
        },
        query: { directory: input.input.workspacePath },
        body: { response: 'reject' },
      }).catch(() => undefined)
    }
    finally {
      this.activePermissionIds.delete(toolCallId)
    }
  }

  private async closeAsyncPromptTurn(input: {
    resource: OpencodeRuntimeResource
    projector: OpencodeEventStreamProjector
    chunks: AsyncChunkQueue
    sessionId: string
    workspacePath?: string
    assistant: OpencodeAssistantMessage
  }): Promise<void> {
    if (input.assistant.error) {
      input.chunks.fail(new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'session.promptAsync',
          formatOpencodeAssistantError(input.assistant.error),
        ),
      ))
      return
    }

    const recovered = await input.resource.client.session.message({
      path: {
        id: input.sessionId,
        messageID: input.assistant.id,
      },
      query: { directory: input.workspacePath },
    })
    if (!recovered.error && recovered.data?.info.role === 'assistant') {
      for (const chunk of input.projector.projectPromptResult({
        info: recovered.data.info,
        parts: recovered.data.parts,
      })) {
        input.chunks.push(chunk)
      }
    }
    else if (recovered.error) {
      input.chunks.push({
        type: 'data-runtime-event',
        data: {
          kind: 'opencode.promptAsync-recovery-error',
          message: formatOpencodeError(recovered.error),
        },
      })
    }
    else if (!recovered.data) {
      input.chunks.push({
        type: 'data-runtime-event',
        data: {
          kind: 'opencode.promptAsync-recovery-error',
          message: 'opencode returned no recovered assistant message',
        },
      })
    }

    this._lastUsage = input.projector.usage
    input.chunks.push(input.projector.finish(input.assistant))
    input.chunks.close()
  }

  private async closeAsyncPromptTurnFromHistory(input: {
    resource: OpencodeRuntimeResource
    projector: OpencodeEventStreamProjector
    chunks: AsyncChunkQueue
    sessionId: string
    workspacePath?: string
    baselineMessageIds: ReadonlySet<string>
  }): Promise<boolean> {
    if (input.chunks.done) {
      return true
    }

    const messages = await input.resource.client.session.messages({
      path: { id: input.sessionId },
      query: { directory: input.workspacePath, limit: 50 },
    })
    if (messages.error) {
      input.chunks.fail(new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'session.promptAsync',
          `opencode event stream ended before completion and history recovery failed: ${formatOpencodeError(messages.error)}`,
        ),
      ))
      return true
    }

    const terminalAssistant = readTerminalAssistantAfterBaseline(messages.data ?? [], input.baselineMessageIds)
    if (!terminalAssistant) {
      return false
    }

    await this.closeAsyncPromptTurn({
      resource: input.resource,
      projector: input.projector,
      chunks: input.chunks,
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      assistant: terminalAssistant,
    })
    return true
  }

  private async readAsyncPromptBaselineMessageIds(input: {
    resource: OpencodeRuntimeResource
    sessionId: string
    workspacePath?: string
    chunks: AsyncChunkQueue
  }): Promise<ReadonlySet<string> | null> {
    const messages = await input.resource.client.session.messages({
      path: { id: input.sessionId },
      query: { directory: input.workspacePath, limit: 50 },
    })
    if (messages.error) {
      input.chunks.fail(new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'session.promptAsync',
          `opencode async prompt baseline failed: ${formatOpencodeError(messages.error)}`,
        ),
      ))
      return null
    }
    return readOpencodeMessageIds(messages.data ?? [])
  }

  private recordPermissionApproval(input: {
    chatSessionId: string
    permission: OpencodePermission
    status: OpencodePermissionApprovalRecord['status']
  }): void {
    const existing = this.permissionApprovalsByChatSessionId.get(input.chatSessionId) ?? []
    const now = Date.now()
    const startedAt = input.permission.time.created || now
    const nextRecord: OpencodePermissionApprovalRecord = {
      id: input.permission.id,
      targetItemId: input.permission.callID ?? input.permission.messageID,
      status: input.status,
      label: input.permission.title || input.permission.type,
      riskLevel: typeof input.permission.metadata.riskLevel === 'string' ? input.permission.metadata.riskLevel : null,
      rationale: typeof input.permission.metadata.reason === 'string' ? input.permission.metadata.reason : null,
      startedAt,
      completedAt: input.status === 'pending' ? null : now,
      updatedAt: now,
    }
    const withoutCurrent = existing.filter(record => record.id !== input.permission.id)
    this.permissionApprovalsByChatSessionId.set(input.chatSessionId, [nextRecord, ...withoutCurrent].slice(0, 20))
  }

  private async createNativeSession(
    resource: OpencodeRuntimeResource,
    workspacePath: string | undefined,
    chatSessionId: string,
  ): Promise<OpencodeSession & { id: string }> {
    const result = await resource.client.session.create({
      query: { directory: workspacePath },
      body: { title: `Cradle ${chatSessionId}` },
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.create', formatOpencodeError(result.error)),
      )
    }
    if (!result.data?.id) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.create', 'opencode returned no created session'),
      )
    }
    return result.data as OpencodeSession & { id: string }
  }

  private async resolveRuntimeConfig(input: {
    profile: StartChatSessionInput['profile']
    requestedModelId?: string | null
  }): Promise<{
    config: Config
    model: { providerID: string, modelID: string } | null
    modelId: string | null
    providerTargetId: string | null
    hostProviderTargetId: string
  }> {
    if (input.profile) {
      const resolved = await resolveOpencodeConfig({
        profile: input.profile,
        requestedModelId: input.requestedModelId,
        readSecret: ref => this.deps.readSecret(ref),
      })
      return {
        ...resolved,
        modelId: resolved.requestedModelId,
        providerTargetId: input.profile.providerTargetId,
        hostProviderTargetId: input.profile.providerTargetId,
      }
    }

    const model = parseOpenCodeModelRef(input.requestedModelId)
    return {
      config: {
        ...(input.requestedModelId ? { model: input.requestedModelId } : {}),
      },
      model,
      modelId: input.requestedModelId ?? null,
      providerTargetId: null,
      hostProviderTargetId: OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
    }
  }
}

class AsyncChunkQueue implements AsyncIterable<UIMessageChunk> {
  private readonly values: UIMessageChunk[] = []
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<UIMessageChunk>) => void
    reject: (error: unknown) => void
  }> = []

  private closed = false
  private failure: unknown

  get done(): boolean {
    return this.closed
  }

  push(value: UIMessageChunk): void {
    if (this.closed) {
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close(): void {
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true })
    }
  }

  fail(error: unknown): void {
    this.failure = error
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error)
    }
  }

  async next(): Promise<IteratorResult<UIMessageChunk>> {
    if (this.values.length > 0) {
      return { value: this.values.shift()!, done: false }
    }
    if (this.failure) {
      throw this.failure
    }
    if (this.closed) {
      return { value: undefined, done: true }
    }
    return await new Promise<IteratorResult<UIMessageChunk>>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
    return this
  }
}

function parseOpenCodeModelRef(modelId: string | null | undefined): { providerID: string, modelID: string } | null {
  if (!modelId) {
    return null
  }
  const slashIndex = modelId.indexOf('/')
  if (slashIndex <= 0 || slashIndex === modelId.length - 1) {
    return null
  }
  return {
    providerID: modelId.slice(0, slashIndex),
    modelID: modelId.slice(slashIndex + 1),
  }
}

function toOpenCodeModelRef(providerId: string, modelId: string): string {
  return modelId.includes('/') ? modelId : `${providerId}/${modelId}`
}

function readOpencodeRuntimeHandle(runtimeKind: RuntimeKind, runtimeSession: RuntimeSession): OpencodeRuntimeResource {
  const lease = runtimeSession.providerRuntimeLease
  if (!runtimeSession.providerSessionId || !lease) {
    throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(runtimeKind, runtimeSession.chatSessionId))
  }
  return lease.resource as OpencodeRuntimeResource
}

function createOpencodeChildRuntimeLease(
  resource: OpencodeRuntimeResource,
): RuntimeLiveResourceLease<OpencodeRuntimeResource> {
  return {
    resource,
    refresh() {},
    release() {},
  }
}

async function submitOpencodeTurn(
  resource: OpencodeRuntimeResource,
  input: {
    sessionId: string
    workspacePath?: string
    model: { providerID: string, modelID: string } | null
    agent: string
    useAsyncPrompt: boolean
    systemPrompt?: string
    message: StreamTurnInput['message']
  },
): Promise<{
  operation: 'session.command' | 'session.prompt' | 'session.promptAsync'
  result: OpencodeTurnResult
}> {
  const invocation = readOpencodeSlashCommandInvocation(input.message)
  if (invocation) {
    const commandList = await resource.client.command.list({
      query: { directory: input.workspacePath },
    })
    if (commandList.error) {
      return {
        operation: 'session.prompt',
        result: normalizeOpencodeTurnResult(await resource.client.session.prompt({
          path: { id: input.sessionId },
          query: { directory: input.workspacePath },
          body: {
            ...(input.model ? { model: input.model } : {}),
            agent: input.agent,
            ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
            parts: projectOpencodePromptParts(input.message),
          },
        })),
      }
    }

    const command = (commandList.data ?? []).find(candidate => candidate.name === invocation.command)
    if (command) {
      return {
        operation: 'session.command',
        result: normalizeOpencodeTurnResult(await resource.client.session.command({
          path: { id: input.sessionId },
          query: { directory: input.workspacePath },
          body: {
            command: invocation.command,
            arguments: invocation.arguments,
            ...(command.agent ? { agent: command.agent } : {}),
            ...(command.model ? { model: command.model } : {}),
          },
        })),
      }
    }
  }

  if (input.useAsyncPrompt) {
    const result = await resource.client.session.promptAsync({
      path: { id: input.sessionId },
      query: { directory: input.workspacePath },
      body: {
        ...(input.model ? { model: input.model } : {}),
        agent: input.agent,
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
        parts: projectOpencodePromptParts(input.message),
      },
    })
    return {
      operation: 'session.promptAsync',
      result: {
        data: undefined,
        error: result.error,
      },
    }
  }

  return {
    operation: 'session.prompt',
    result: normalizeOpencodeTurnResult(await resource.client.session.prompt({
      path: { id: input.sessionId },
      query: { directory: input.workspacePath },
      body: {
        ...(input.model ? { model: input.model } : {}),
        agent: input.agent,
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
        parts: projectOpencodePromptParts(input.message),
      },
    })),
  }
}

function normalizeOpencodeTurnResult(result: {
  data?: {
    info: OpencodeAssistantMessage
    parts: OpencodePart[]
  }
  error?: unknown
}): OpencodeTurnResult {
  return {
    data: result.data,
    error: result.error,
  }
}

function readOpencodeTurnAgent(input: StreamTurnInput): string {
  return input.providerOptions?.runtimeSettings?.interactionMode === 'plan' ? 'plan' : 'build'
}

function isOpencodeSessionStatusEvent(
  event: OpencodeEvent,
  sessionId: string,
  status: 'busy' | 'idle',
): boolean {
  return event.type === 'session.status'
    && event.properties.sessionID === sessionId
    && event.properties.status.type === status
}

function isOpencodeSessionIdleEvent(event: OpencodeEvent, sessionId: string): boolean {
  return event.type === 'session.idle' && event.properties.sessionID === sessionId
}

function toOpencodePermissionToolCallId(permissionId: string): string {
  return `server-request-${permissionId}`
}

async function readOpencodeSessionStatus(
  resource: OpencodeRuntimeResource,
  workspacePath: string,
  sessionId: string,
): Promise<OpencodeSessionStatus | null> {
  const result = await resource.client.session.status({
    query: { directory: workspacePath },
  }).catch(() => null)
  if (!result || result.error) {
    return null
  }
  return result.data[sessionId] ?? null
}

async function readOpencodeSessionTodo(
  resource: OpencodeRuntimeResource,
  workspacePath: string,
  sessionId: string,
): Promise<OpencodeTodo[]> {
  const result = await resource.client.session.todo({
    path: { id: sessionId },
    query: { directory: workspacePath },
  }).catch(() => null)
  if (!result || result.error) {
    return []
  }
  return result.data ?? []
}

async function readOpencodeSessionDiff(
  resource: OpencodeRuntimeResource,
  workspacePath: string,
  sessionId: string,
): Promise<Array<{ additions: number, deletions: number }>> {
  const result = await resource.client.session.diff({
    path: { id: sessionId },
    query: { directory: workspacePath },
  }).catch(() => null)
  if (!result || result.error) {
    return []
  }
  return result.data ?? []
}

async function readOpencodeSessionChildren(
  resource: OpencodeRuntimeResource,
  workspacePath: string,
  sessionId: string,
): Promise<OpencodeSession[]> {
  const result = await resource.client.session.children({
    path: { id: sessionId },
    query: { directory: workspacePath },
  }).catch(() => null)
  if (!result || result.error) {
    return []
  }
  return result.data ?? []
}

async function readOpencodeMcpStatus(
  resource: OpencodeRuntimeResource,
  workspacePath: string,
): Promise<Map<string, OpencodeMcpStatus>> {
  const result = await resource.client.mcp.status({
    query: { directory: workspacePath },
  }).catch(() => null)
  if (!result || result.error || !result.data) {
    return new Map()
  }
  return new Map(Object.entries(result.data))
}

async function readOpencodeFileStatus(
  resource: OpencodeRuntimeResource,
  workspacePath: string,
): Promise<OpencodeFile[]> {
  const result = await resource.client.file.status({
    query: { directory: workspacePath },
  }).catch(() => null)
  if (!result || result.error) {
    return []
  }
  return result.data ?? []
}

async function readOpencodeAgents(
  resource: OpencodeRuntimeResource,
  workspacePath: string,
): Promise<OpencodeAgent[]> {
  const result = await resource.client.app.agents({
    query: { directory: workspacePath },
  }).catch(() => null)
  if (!result || result.error) {
    return []
  }
  return result.data ?? []
}

function projectOpencodeRuntimeThreadStatus(status: OpencodeSessionStatus | null): Extract<RuntimeUiSlotState, { kind: 'status' }>['status'] {
  if (!status) {
    return 'notLoaded'
  }
  switch (status.type) {
    case 'busy':
    case 'retry':
      return 'active'
    case 'idle':
      return 'idle'
  }
}

function projectOpencodeProgressState(
  sessionId: string,
  todos: OpencodeTodo[],
  updatedAt: number,
): RuntimeUiSlotState {
  const items = todos.map(todo => ({
    id: todo.id,
    label: todo.content,
    status: projectOpencodeTodoStatus(todo.status),
    sourceStatus: todo.status,
  }))
  return {
    kind: 'progress',
    slotId: 'opencode:progress',
    threadId: sessionId,
    turnId: null,
    source: 'opencode.todo',
    items,
    currentItem: items.find(item => item.status === 'inProgress')?.label ?? null,
    pendingCount: items.filter(item => item.status === 'pending').length,
    inProgressCount: items.filter(item => item.status === 'inProgress').length,
    completedCount: items.filter(item => item.status === 'completed').length,
    updatedAt,
  }
}

function projectOpencodeTodoStatus(status: string): 'pending' | 'inProgress' | 'completed' {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'in_progress':
    case 'inProgress':
      return 'inProgress'
    default:
      return 'pending'
  }
}

function projectOpencodeMcpState(
  sessionId: string,
  serversByName: Map<string, OpencodeMcpStatus>,
  updatedAt: number,
): RuntimeUiSlotState {
  const servers = Array.from(serversByName.entries(), ([name, status]) => ({
      name,
      status: projectOpencodeMcpServerStatus(status),
      authStatus: projectOpencodeMcpAuthStatus(status),
      toolCount: 0,
      resourceCount: 0,
      error: readOpencodeMcpError(status),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    kind: 'mcp',
    slotId: 'opencode:mcp',
    threadId: sessionId,
    serverCount: servers.length,
    readyCount: servers.filter(server => server.status === 'ready').length,
    failedCount: servers.filter(server => server.status === 'failed').length,
    needsLoginCount: servers.filter(server => server.authStatus === 'notLoggedIn').length,
    recentProgress: null,
    servers,
    updatedAt,
  }
}

function projectOpencodeMcpServerStatus(status: OpencodeMcpStatus): Extract<RuntimeUiSlotState, { kind: 'mcp' }>['servers'][number]['status'] {
  switch (status.status) {
    case 'connected':
      return 'ready'
    case 'failed':
      return 'failed'
    case 'disabled':
      return 'cancelled'
    case 'needs_auth':
    case 'needs_client_registration':
      return 'unknown'
  }
}

function projectOpencodeMcpAuthStatus(status: OpencodeMcpStatus): Extract<RuntimeUiSlotState, { kind: 'mcp' }>['servers'][number]['authStatus'] {
  switch (status.status) {
    case 'needs_auth':
    case 'needs_client_registration':
      return 'notLoggedIn'
    case 'disabled':
      return 'unsupported'
    case 'connected':
    case 'failed':
      return 'unknown'
  }
}

function readOpencodeMcpError(status: OpencodeMcpStatus): string | null {
  switch (status.status) {
    case 'failed':
    case 'needs_client_registration':
      return status.error
    case 'connected':
    case 'disabled':
    case 'needs_auth':
      return null
  }
}

function projectOpencodeFilesystemState(
  sessionId: string,
  files: OpencodeFile[],
  updatedAt: number,
): RuntimeUiSlotState {
  return {
    kind: 'filesystem',
    slotId: 'opencode:filesystem',
    threadId: sessionId,
    changedPathCount: files.length,
    recentPaths: files.map(file => file.path).slice(0, 20),
    updatedAt,
  }
}

function projectOpencodeCrewState(
  sessionId: string,
  agents: OpencodeAgent[],
  updatedAt: number,
): RuntimeUiSlotState {
  const visibleAgents = agents
    .map(agent => ({
      threadId: `${sessionId}:agent:${agent.name}`,
      status: 'available',
      message: agent.description ?? null,
      name: agent.name,
      preview: agent.prompt ?? agent.description ?? null,
      modelProvider: agent.model?.providerID ?? null,
      agentNickname: agent.name,
      agentRole: agent.mode,
    }))
    .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''))
  const collaborationModes = agents
    .map(agent => ({
      name: agent.name,
      mode: agent.mode,
      model: agent.model ? toOpenCodeModelRef(agent.model.providerID, agent.model.modelID) : null,
      reasoningEffort: null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    kind: 'crew',
    slotId: 'opencode:crew',
    threadId: sessionId,
    activeCount: 0,
    completedCount: 0,
    failedCount: 0,
    recentItems: [],
    agents: visibleAgents,
    collaborationModeCount: collaborationModes.length,
    collaborationModes,
    calls: [],
    updatedAt,
  }
}

function supportsOpencodeProviderThreadSourceKinds(sourceKinds: ProviderThreadListInput['sourceKinds']): boolean {
  return !sourceKinds || sourceKinds.length === 0 || sourceKinds.includes('appServer') || sourceKinds.includes('unknown')
}

function projectOpencodeProviderThread(session: OpencodeSession, childCount = 0): ProviderThread {
  return {
    id: session.id,
    providerSessionTreeId: session.parentID ?? null,
    forkedFromId: session.parentID ?? null,
    preview: normalizeProviderThreadTitle(session.title),
    ephemeral: false,
    modelProvider: null,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    status: session.time.compacting ? 'active' : 'idle',
    sourceKind: 'appServer',
    source: {
      type: 'opencode-session',
      projectID: session.projectID,
      version: session.version,
      shareUrl: session.share?.url ?? null,
      summary: session.summary ?? null,
      revert: session.revert ?? null,
      childCount,
    },
    threadSource: {
      kind: 'opencode-session',
      directory: session.directory,
      parentID: session.parentID ?? null,
      shareUrl: session.share?.url ?? null,
      childCount,
    },
    agentNickname: null,
    agentRole: null,
    name: normalizeProviderThreadTitle(session.title),
    cwd: session.directory,
  }
}

function countOpencodeSessionChildren(sessions: OpencodeSession[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    if (!session.parentID) {
      continue
    }
    counts.set(session.parentID, (counts.get(session.parentID) ?? 0) + 1)
  }
  return counts
}

function projectOpencodeProviderThreadTurn(input: { info: OpencodeMessage, parts: OpencodePart[] }): ProviderThreadTurn {
  const startedAt = readOpencodeMessageCreatedAt(input.info)
  const completedAt = input.info.role === 'assistant' ? input.info.time.completed ?? null : startedAt
  return {
    id: input.info.id,
    status: input.info.role === 'assistant' && input.info.error ? 'failed' : 'completed',
    startedAt,
    completedAt,
    durationMs: completedAt === null ? null : Math.max(0, completedAt - startedAt),
    itemsView: 'full',
    items: [{
      provider: 'opencode',
      message: input.info,
      parts: input.parts,
    }],
  }
}

function projectOpencodeProviderThreadMessages(
  threadId: string,
  messages: Array<{ info: OpencodeMessage, parts: OpencodePart[] }>,
): UIMessage[] {
  return messages.flatMap((message): UIMessage[] => {
    const parts = projectOpencodeMessagePartsToUiParts(message.parts)
    if (parts.length === 0) {
      return []
    }
    return [{
      id: `provider-thread:${threadId}:message:${message.info.id}`,
      role: message.info.role,
      parts,
      metadata: {
        provider: 'opencode',
        providerThreadId: threadId,
        providerMessageId: message.info.id,
      },
    }]
  })
}

function projectOpencodeMessagePartsToUiParts(parts: OpencodePart[]): UIMessage['parts'] {
  return parts.flatMap((part): UIMessage['parts'] => {
    switch (part.type) {
      case 'text':
        return part.text && part.synthetic !== true && part.ignored !== true
          ? [{ type: 'text', text: part.text }]
          : []
      case 'reasoning':
        return part.text ? [{ type: 'reasoning', text: part.text }] : []
      case 'file':
        return [{
          type: 'file',
          mediaType: part.mime,
          ...(part.filename ? { filename: part.filename } : {}),
          url: part.url,
        }]
      case 'tool':
        return [{
          type: 'text',
          text: formatOpencodeToolPartForProviderThread(part),
        }]
      case 'patch':
        return [{
          type: 'text',
          text: `Patch: ${part.files.join(', ')}`,
        }]
      case 'snapshot':
      case 'step-start':
      case 'step-finish':
      case 'agent':
      case 'retry':
      case 'compaction':
      case 'subtask':
        return []
      default:
        return []
    }
  })
}

function formatOpencodeToolPartForProviderThread(part: Extract<OpencodePart, { type: 'tool' }>): string {
  switch (part.state.status) {
    case 'pending':
      return `${part.tool}: pending`
    case 'running':
      return `${part.tool}: ${part.state.title ?? 'running'}`
    case 'completed':
      return `${part.tool}: ${part.state.output}`
    case 'error':
      return `${part.tool}: ${part.state.error}`
  }
}

function readOpencodeMessageCreatedAt(message: OpencodeMessage): number {
  return message.time.created
}

function compareOpencodeProviderThreads(
  left: ProviderThread,
  right: ProviderThread,
  sortKey: ProviderThreadListInput['sortKey'],
  sortDirection: ProviderThreadListInput['sortDirection'],
): number {
  const leftValue = sortKey === 'created_at' ? left.createdAt : left.updatedAt
  const rightValue = sortKey === 'created_at' ? right.createdAt : right.updatedAt
  const direction = sortDirection === 'asc' ? 1 : -1
  return ((leftValue ?? 0) - (rightValue ?? 0)) * direction
}

function opencodeProviderThreadMatchesSearch(thread: ProviderThread, searchTerm: string): boolean {
  return [
    thread.id,
    thread.forkedFromId,
    thread.preview,
    thread.name,
    thread.cwd,
  ].some(value => normalizeProviderThreadText(value)?.includes(searchTerm))
}

function normalizeProviderThreadText(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizeProviderThreadTitle(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function readProviderThreadLimit(limit: number | null | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return 50
  }
  return Math.max(1, Math.min(100, Math.floor(limit)))
}

function readProviderThreadOffset(cursor: string | null | undefined): number {
  if (!cursor) {
    return 0
  }
  const offset = Number.parseInt(cursor, 10)
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function readLastAssistantMessage(
  messages: Array<{ info: OpencodeMessage, parts: OpencodePart[] }>,
): OpencodeAssistantMessage | null {
  let selected: OpencodeAssistantMessage | null = null
  for (const message of messages) {
    if (message.info.role !== 'assistant') {
      continue
    }
    if (!selected || message.info.time.created >= selected.time.created) {
      selected = message.info
    }
  }
  return selected
}

function readOpencodeMessageIds(
  messages: Array<{ info: OpencodeMessage, parts: OpencodePart[] }>,
): ReadonlySet<string> {
  return new Set(messages.map(message => message.info.id))
}

function readTerminalAssistantAfterBaseline(
  messages: Array<{ info: OpencodeMessage, parts: OpencodePart[] }>,
  baselineMessageIds: ReadonlySet<string>,
): OpencodeAssistantMessage | null {
  let selected: OpencodeAssistantMessage | null = null
  for (const message of messages) {
    if (
      message.info.role !== 'assistant'
      || baselineMessageIds.has(message.info.id)
      || !isTerminalOpencodeAssistant(message.info)
    ) {
      continue
    }
    if (!selected || message.info.time.created >= selected.time.created) {
      selected = message.info
    }
  }
  return selected
}

function isTerminalOpencodeAssistant(message: OpencodeAssistantMessage): boolean {
  return message.time.completed !== undefined || message.finish !== undefined || message.error !== undefined
}

function projectOpencodeShellResult(parts: OpencodePart[]): {
  stdout: string
  stderr: string
  durationMs: number | null
} {
  const stdout: string[] = []
  const stderr: string[] = []
  let durationMs: number | null = null

  for (const part of parts) {
    if (part.type === 'text' && part.text) {
      stdout.push(part.text)
      continue
    }
    if (part.type !== 'tool') {
      continue
    }
    switch (part.state.status) {
      case 'completed':
        stdout.push(part.state.output)
        durationMs = readToolDurationMs(part.state.time.start, part.state.time.end, durationMs)
        break
      case 'error':
        stderr.push(part.state.error)
        durationMs = readToolDurationMs(part.state.time.start, part.state.time.end, durationMs)
        break
      case 'pending':
      case 'running':
        break
    }
  }

  return {
    stdout: stdout.join('\n').trim(),
    stderr: stderr.join('\n').trim(),
    durationMs,
  }
}

function readToolDurationMs(startedAt: number, completedAt: number, current: number | null): number {
  const duration = Math.max(0, completedAt - startedAt)
  return current === null ? duration : Math.max(current, duration)
}

function formatOpencodeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return JSON.stringify(error)
}

export function formatOpencodeAssistantError(error: NonNullable<OpencodeAssistantMessage['error']>): string {
  switch (error.name) {
    case 'ProviderAuthError':
      return `Provider authentication failed for ${error.data.providerID}: ${error.data.message}`
    case 'UnknownError':
      return error.data.message
    case 'MessageOutputLengthError':
      return `Message output length exceeded: ${JSON.stringify(error.data)}`
    case 'MessageAbortedError':
      return error.data.message
    case 'APIError':
      return formatOpencodeApiError(error.data)
  }
}

function formatOpencodeApiError(error: Extract<
  NonNullable<OpencodeAssistantMessage['error']>,
  { name: 'APIError' }
>['data']): string {
  return error.statusCode === undefined
    ? error.message
    : `${error.statusCode}: ${error.message}`
}
