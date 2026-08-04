import type {
  AccountInfo,
  Query,
  SDKAuthStatusMessage,
  SDKMessage,
  SDKRateLimitEvent,
} from '@anthropic-ai/claude-agent-sdk'
import {
  getSessionInfo,
  getSubagentMessages,
  listSubagents,
  renameSession,
} from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage } from 'ai'

import { readObjectRecord as readRecord } from '../../../helpers/json-record'
import {
  invalidateHarnessProjection,
} from '../../chat-runtime/harness/provider-state'
import type {
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  ProviderThread,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadTurn,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  RuntimeProviderTargetProfile,
  RuntimeSession,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import { readWorkspaceProviderStateSnapshot } from '../kit/state-snapshot'
import {
  CLAUDE_AGENT_RUNTIME_KIND,
} from './metadata'
import type {
  ClaudeSubagentProjectedEntry,
  ClaudeSubagentSessionMessage,
  ClaudeSubagentThreadRecord,
  ClaudeTranscriptContentBlock,
  ClaudeTranscriptMessagePayload,
} from './provider-internals'
import {
  generateClaudeSessionTitle,
} from './provider-title-generation'
import {
  activateClaudeAgentSdkConfigDir,
  resolveClaudeAgentRuntimeContext,
} from './runtime-context'
import {
  writeClaudeAgentAccountSnapshot,
  writeClaudeAgentAuthStatusSnapshot,
  writeClaudeAgentRateLimitSnapshot,
} from './state-projector'
import { createClaudeCodeToolInputPayload, createClaudeCodeToolResultPayload } from './tools/mapper'
import type {
  ClaudeAgentProviderDeps,
  ClaudeAgentSessionInfo,
  ClaudeTitleGenerationThinkingEffort,
} from './types'

const DEFAULT_PROVIDER_THREAD_LIMIT = 50
const CLAUDE_SUBAGENT_SOURCE_KIND = 'subAgent'

type ClaudeSubagentProjectedToolPart = UIMessage['parts'][number] & {
  toolCallId: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

export class ClaudeAgentSessionArtifacts {
  readonly runtimeKind = CLAUDE_AGENT_RUNTIME_KIND

  constructor(private readonly deps: ClaudeAgentProviderDeps) {}

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const parentSessionId = input.runtimeSession.providerSessionId
    if (!parentSessionId || !supportsClaudeSubagentSourceKinds(input.sourceKinds)) {
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: parentSessionId,
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      }
    }

    const cwd = this.resolveClaudeProviderThreadDir(input)
    const agentIds = await listSubagents(parentSessionId, { dir: cwd })
    const records = await Promise.all(
      agentIds.map(
        async agentId =>
          ({
            agentId,
            parentSessionId,
            cwd,
            messages: await this.readClaudeSubagentMessages(parentSessionId, agentId, cwd),
          }) satisfies ClaudeSubagentThreadRecord,
      ),
    )
    const sortKey = input.sortKey ?? 'updated_at'
    const sortDirection = input.sortDirection ?? 'desc'
    const searchTerm = normalizeProviderThreadText(input.searchTerm)
    const threads = records
      .map(projectClaudeSubagentThread)
      .filter(thread => !searchTerm || claudeProviderThreadMatchesSearch(thread, searchTerm))
      .sort((left, right) => compareClaudeProviderThreads(left, right, sortKey, sortDirection))

    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = threads.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: parentSessionId,
      threads: page,
      nextCursor: offset + limit < threads.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const record = await this.resolveClaudeSubagentThreadRecord(input.threadId, input)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: record.parentSessionId,
      thread: projectClaudeSubagentThread(record),
    }
  }

  async listProviderThreadTurns(
    input: ProviderThreadTurnsInput,
  ): Promise<ProviderThreadTurnsResult> {
    const record = await this.resolveClaudeSubagentThreadRecord(input.threadId, input)
    const sortDirection = input.sortDirection ?? 'asc'
    const displayMessages = record.messages.filter(hasClaudeSubagentDisplayParts)
    const entries = projectClaudeSubagentEntries(record, displayMessages)
    const orderedEntries = sortDirection === 'desc' ? [...entries].reverse() : entries
    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = orderedEntries.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: record.parentSessionId,
      threadId: readClaudeSubagentProviderThreadId(record),
      turns: page.map(entry => entry.turn),
      messages: page.map(entry => entry.message),
      nextCursor: offset + limit < orderedEntries.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const titleGeneration = this.resolveClaudeSessionTitleGenerationConfig({
      currentProfile: profile,
      fallbackModel: input.modelId ?? snapshot.models.currentModelId ?? config.model ?? null,
    })
    const abortController = new AbortController()
    try {
      const title = await generateClaudeSessionTitle({
        runtimeSession: input.runtimeSession,
        profile: titleGeneration.profile,
        promptText: input.promptText,
        modelId: titleGeneration.modelId ?? titleGeneration.fallbackModel,
        thinkingEffort: titleGeneration.thinkingEffort,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath ?? snapshot.workspacePath ?? '',
        agentId: input.agentId ?? snapshot.agentId ?? null,
        deps: this.deps,
        signal: abortController.signal,
      })
      if (title && input.runtimeSession.providerSessionId) {
        await renameSession(input.runtimeSession.providerSessionId, title, {
          dir: this.resolveClaudeSessionProjectDir({
            workspacePath: input.workspacePath ?? snapshot.workspacePath ?? undefined,
            agentId: input.agentId ?? snapshot.agentId ?? null,
          }),
        }).catch(() => undefined)
      }
      return title
    }
 finally {
      abortController.abort()
    }
  }

  async reportClaudeSessionTitle(input: {
    sessionId: string
    runtimeSession: RuntimeSession
    reportSessionTitle?: (title: string) => void
  }): Promise<void> {
    if (!input.reportSessionTitle) {
      return
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const info = await getSessionInfo(input.sessionId, {
      dir: this.resolveClaudeSessionProjectDir({
        workspacePath: snapshot.workspacePath ?? undefined,
        agentId: snapshot.agentId ?? null,
      }),
    }).catch(() => undefined)
    const title = normalizeClaudeSessionTitle(
      (info as ClaudeAgentSessionInfo | undefined)?.customTitle
      ?? (info as ClaudeAgentSessionInfo | undefined)?.summary,
    )
    if (title) {
      input.reportSessionTitle(title)
    }
  }

  async captureClaudeAgentAccountSnapshot(
    runtimeSession: RuntimeSession,
    activeQuery: Query,
  ): Promise<void> {
    try {
      const result = await activeQuery.initializationResult()
      if (hasClaudeAgentAccountSignal(result.account)) {
        writeClaudeAgentAccountSnapshot(runtimeSession, result.account)
      }
    }
 catch (error) {
      this.deps.logger?.debug?.('Claude Agent account initialization probe failed', {
        error,
        sessionId: runtimeSession.chatSessionId,
      })
    }
  }

  projectClaudeAgentRuntimeState(
    runtimeSession: RuntimeSession,
    message: SDKMessage,
  ): void {
    if (message.type === 'system' && message.subtype === 'compact_boundary') {
      invalidateHarnessProjection(runtimeSession)
      return
    }
    if (message.type === 'auth_status') {
      writeClaudeAgentAuthStatusSnapshot(runtimeSession, message as SDKAuthStatusMessage)
      return
    }
    if (message.type === 'rate_limit_event') {
      writeClaudeAgentRateLimitSnapshot(
        runtimeSession,
        (message as SDKRateLimitEvent).rate_limit_info,
      )
    }
  }

  private resolveClaudeSessionProjectDir(input: {
    workspacePath?: string | null
    agentId?: string | null
  }): string {
    activateClaudeAgentSdkConfigDir()
    return resolveClaudeAgentRuntimeContext(input.workspacePath ?? undefined, input.agentId ?? null)
      .cwd
  }

  private resolveClaudeProviderThreadDir(input: GetCapabilitiesInput): string {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return this.resolveClaudeSessionProjectDir({
      workspacePath: input.workspacePath ?? snapshot.workspacePath ?? undefined,
      agentId: input.agentId ?? snapshot.agentId ?? null,
    })
  }

  private async readClaudeSubagentMessages(
    parentSessionId: string,
    agentId: string,
    cwd: string,
  ): Promise<ClaudeSubagentSessionMessage[]> {
    const messages = await getSubagentMessages(parentSessionId, agentId, { dir: cwd })
    return messages.map(message => message as ClaudeSubagentSessionMessage)
  }

  private async resolveClaudeSubagentThreadRecord(
    requestedThreadId: string,
    input: GetCapabilitiesInput,
  ): Promise<ClaudeSubagentThreadRecord> {
    const parentSessionId = input.runtimeSession.providerSessionId
    if (!parentSessionId) {
      throw new ProviderRuntimeError(
        ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId),
      )
    }

    const cwd = this.resolveClaudeProviderThreadDir(input)
    const agentIds = await listSubagents(parentSessionId, { dir: cwd })
    if (agentIds.includes(requestedThreadId)) {
      const messages = await this.readClaudeSubagentMessages(
        parentSessionId,
        requestedThreadId,
        cwd,
      )
      return { agentId: requestedThreadId, parentSessionId, cwd, messages }
    }

    for (const agentId of agentIds) {
      const messages = await this.readClaudeSubagentMessages(parentSessionId, agentId, cwd)
      if (messages.some(message => message.parent_tool_use_id === requestedThreadId)) {
        return { agentId, parentSessionId, cwd, messages }
      }
    }

    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(
        this.runtimeKind,
        'provider-thread/read',
        `Claude Agent subagent transcript was not found: ${requestedThreadId}`,
      ),
    )
  }

  resolveClaudeSessionTitleGenerationConfig(input: {
    currentProfile: RuntimeProviderTargetProfile
    fallbackModel: string | null
  }): {
    profile: RuntimeProviderTargetProfile
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: ClaudeTitleGenerationThinkingEffort
  } {
    const preferences = this.deps.readChatPreferences?.()
    const titlePreferences = preferences?.titleGeneration
    const thinkingEffort = titlePreferences?.thinkingEffort ?? 'minimal'
    const explicitProviderTargetId = titlePreferences?.providerTargetId ?? null
    const explicitModelId = titlePreferences?.modelId ?? null

    if (!explicitProviderTargetId) {
      return {
        profile: input.currentProfile,
        modelId: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const profile = this.deps.resolveProviderTargetProfile?.(explicitProviderTargetId)
    if (!profile) {
      return {
        profile: input.currentProfile,
        modelId: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const modelId = explicitModelId ?? config.model ?? null
    return {
      profile,
      modelId,
      fallbackModel: input.fallbackModel,
      thinkingEffort,
    }
  }

  generateClaudeSessionTitleInBackground(input: {
    runtimeSession: RuntimeSession
    profile: RuntimeProviderTargetProfile
    mainSessionId: string
    promptText: string
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: ClaudeTitleGenerationThinkingEffort
    workspaceId?: string | null
    workspacePath: string
    agentId: string | null
    reportSessionTitle?: (title: string) => void
  }): void {
    setTimeout(() => {
      void (async () => {
        const abortController = new AbortController()
        try {
          const model = input.modelId ?? input.fallbackModel
          const generatedTitle = await generateClaudeSessionTitle({
            runtimeSession: input.runtimeSession,
            profile: input.profile,
            promptText: input.promptText,
            modelId: model,
            thinkingEffort: input.thinkingEffort,
            workspaceId: input.workspaceId,
            workspacePath: input.workspacePath,
            agentId: input.agentId,
            deps: this.deps,
            signal: abortController.signal,
          })
          if (generatedTitle) {
            await renameSession(input.mainSessionId, generatedTitle, {
              dir: this.resolveClaudeSessionProjectDir({
                workspacePath: input.workspacePath,
                agentId: input.agentId,
              }),
            })
            input.reportSessionTitle?.(generatedTitle)
          }
        }
 catch {
          // Title generation is opportunistic and must not affect the active turn.
        }
 finally {
          abortController.abort()
        }
      })()
    }, 0)
  }
}

function normalizeClaudeSessionTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function supportsClaudeSubagentSourceKinds(
  sourceKinds: ProviderThreadListInput['sourceKinds'],
): boolean {
  return (
    !sourceKinds || sourceKinds.length === 0 || sourceKinds.includes(CLAUDE_SUBAGENT_SOURCE_KIND)
  )
}

function readProviderThreadLimit(limit: number | null | undefined): number {
  return Number.isFinite(limit) && typeof limit === 'number' && limit > 0
    ? Math.floor(limit)
    : DEFAULT_PROVIDER_THREAD_LIMIT
}

function readProviderThreadOffset(cursor: string | null | undefined): number {
  if (!cursor) {
    return 0
  }
  const offset = Number.parseInt(cursor, 10)
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function projectClaudeSubagentThread(record: ClaudeSubagentThreadRecord): ProviderThread {
  const parentToolUseId = readClaudeSubagentParentToolUseId(record.messages)
  const providerThreadId = readClaudeSubagentProviderThreadId(record)
  const preview = readClaudeSubagentPreview(record.messages)
  const createdAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'first')
  const updatedAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'last')
  const subagentType = readFirstClaudeSubagentString(record.messages, 'subagent_type')
  const taskDescription = readFirstClaudeSubagentString(record.messages, 'task_description')
  return {
    id: providerThreadId,
    providerSessionTreeId: record.parentSessionId,
    forkedFromId: parentToolUseId,
    preview,
    ephemeral: false,
    modelProvider: readClaudeSubagentModel(record.messages),
    createdAt,
    updatedAt,
    status: 'completed',
    sourceKind: CLAUDE_SUBAGENT_SOURCE_KIND,
    source: {
      type: 'claude-agent-subagent',
      agentId: record.agentId,
      parentToolUseId,
    },
    threadSource: {
      kind: 'claude-agent-transcript',
      parentSessionId: record.parentSessionId,
      agentId: record.agentId,
      parentToolUseId,
    },
    agentNickname: subagentType,
    agentRole: taskDescription,
    name: taskDescription ?? subagentType ?? preview,
    cwd: record.cwd,
  }
}

function readClaudeSubagentProviderThreadId(record: ClaudeSubagentThreadRecord): string {
  return readClaudeSubagentParentToolUseId(record.messages) ?? record.agentId
}

function compareClaudeProviderThreads(
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

function claudeProviderThreadMatchesSearch(thread: ProviderThread, searchTerm: string): boolean {
  return [
    thread.id,
    thread.forkedFromId,
    readClaudeProviderThreadSourceAgentId(thread.source),
    thread.preview,
    thread.agentNickname,
    thread.agentRole,
    thread.name,
  ].some(value => normalizeProviderThreadText(value)?.includes(searchTerm))
}

function readClaudeProviderThreadSourceAgentId(source: unknown): string | null {
  if (!source || typeof source !== 'object') {
    return null
  }
  const agentId = (source as { agentId?: unknown }).agentId
  return typeof agentId === 'string' ? agentId : null
}

function normalizeProviderThreadText(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function readClaudeSubagentParentToolUseId(
  messages: ClaudeSubagentSessionMessage[],
): string | null {
  return messages.find(message => message.parent_tool_use_id)?.parent_tool_use_id ?? null
}

function readClaudeSubagentModel(messages: ClaudeSubagentSessionMessage[]): string | null {
  for (const message of messages) {
    const payload = readClaudeTranscriptPayload(message)
    const model = normalizeProviderThreadText(payload?.model)
    if (model) {
      return payload!.model!
    }
  }
  return null
}

function readFirstClaudeSubagentString(
  messages: ClaudeSubagentSessionMessage[],
  key: 'subagent_type' | 'task_description',
): string | null {
  for (const message of messages) {
    const value = normalizeProviderThreadText(message[key])
    if (value) {
      return message[key]!
    }
  }
  return null
}

function readClaudeSubagentPreview(messages: ClaudeSubagentSessionMessage[]): string | null {
  for (const message of messages) {
    const text = readClaudeMessageText(message)
    if (text) {
      return text.length > 240 ? `${text.slice(0, 237)}...` : text
    }
  }
  return null
}

function readClaudeSubagentBoundaryTimestamp(
  messages: ClaudeSubagentSessionMessage[],
  boundary: 'first' | 'last',
): number | null {
  const ordered = boundary === 'first' ? messages : [...messages].reverse()
  for (const message of ordered) {
    const timestamp = readClaudeSubagentTimestamp(message)
    if (timestamp !== null) {
      return timestamp
    }
  }
  return null
}

function readClaudeSubagentTimestamp(message: ClaudeSubagentSessionMessage): number | null {
  if (!message.timestamp) {
    return null
  }
  const timestamp = Date.parse(message.timestamp)
  return Number.isFinite(timestamp) ? timestamp : null
}

function projectClaudeSubagentEntryTurn(
  entry: Pick<
    ClaudeSubagentProjectedEntry,
    'agentId' | 'providerThreadId' | 'rawMessages' | 'message'
  >,
): ProviderThreadTurn {
  const metadata = readRecord(entry.message.metadata)
  const entryId
    = typeof metadata.providerMessageId === 'string' ? metadata.providerMessageId : entry.message.id
  const startedAt = readClaudeSubagentTimestamp(entry.rawMessages[0]!)
  const completedAt = readClaudeSubagentTimestamp(entry.rawMessages.at(-1)!)
  return {
    id: entryId,
    status: entry.message.parts.some(part => isClaudeSubagentToolErrorPart(part))
      ? 'failed'
      : 'completed',
    startedAt,
    completedAt,
    durationMs:
      startedAt !== null && completedAt !== null ? Math.max(0, completedAt - startedAt) : null,
    itemsView: 'full',
    items: entry.rawMessages.map(message => ({
      provider: 'claude-agent',
      providerThreadId: entry.providerThreadId,
      agentId: entry.agentId,
      message,
    })),
  }
}

function projectClaudeSubagentEntries(
  record: ClaudeSubagentThreadRecord,
  messages: ClaudeSubagentSessionMessage[],
  toolSourceMessages: ClaudeSubagentSessionMessage[] = messages,
): ClaudeSubagentProjectedEntry[] {
  const providerThreadId = readClaudeSubagentProviderThreadId(record)
  const toolUseById = collectClaudeSubagentToolUses(toolSourceMessages)
  const entries: ClaudeSubagentProjectedEntry[] = []
  const toolEntryByCallId = new Map<string, ClaudeSubagentProjectedEntry>()

  // The launch prompt is metadata carried on every persisted session message (`task_description`),
  // not a message of its own — so it must be synthesized as a standing entry rather than relying on
  // one of `messages` to happen to render it. Without this, the prompt was only ever visible via the
  // transient live-stream announcement and vanished from history once the subagent produced output.
  const launchPromptEntry = projectClaudeSubagentLaunchPromptEntry(record)
  if (launchPromptEntry) {
    entries.push(launchPromptEntry)
  }

  for (const message of messages) {
    const rawParts = projectClaudeSubagentMessageParts(message, toolUseById)
    if (rawParts.length === 0) {
      continue
    }
    // Claude Code session transcripts can bundle a `tool_use` block and its matching
    // `tool_result` in the very same session message (unlike the raw Anthropic API, where
    // they are always in separate messages). Merge those before cross-message merging below,
    // or the tool call would render as two separate blocks — the input-available one and the
    // output-available one — inside a single chat message.
    const parts = mergeClaudeSubagentToolResultPartsWithinMessage(rawParts)

    const localParts: UIMessage['parts'] = []
    for (const part of parts) {
      const merged = mergeClaudeSubagentToolResultPartIntoEntry(part, message, toolEntryByCallId)
      if (!merged) {
        localParts.push(part)
      }
    }

    if (localParts.length === 0) {
      continue
    }

    const entryMessage: UIMessage = {
      id: `provider-thread:${providerThreadId}:message:${message.uuid}`,
      role: readClaudeSubagentUiRole(message),
      parts: localParts,
      metadata: {
        provider: 'claude-agent',
        providerThreadId,
        agentId: record.agentId,
        providerMessageId: message.uuid,
        providerMessageIds: [message.uuid],
        parentToolUseId: message.parent_tool_use_id,
      },
    }
    const entry: ClaudeSubagentProjectedEntry = {
      providerThreadId,
      agentId: record.agentId,
      turn: {
        id: message.uuid,
        status: 'completed',
        startedAt: readClaudeSubagentTimestamp(message),
        completedAt: readClaudeSubagentTimestamp(message),
        durationMs: null,
        itemsView: 'full',
        items: [
          {
            provider: 'claude-agent',
            providerThreadId,
            agentId: record.agentId,
            message,
          },
        ],
      },
      message: entryMessage,
      rawMessages: [message],
    }
    entry.turn = projectClaudeSubagentEntryTurn(entry)

    entries.push(entry)
    indexClaudeSubagentToolUseParts(entry, toolEntryByCallId)
  }

  return entries
}

function projectClaudeSubagentLaunchPromptEntry(
  record: ClaudeSubagentThreadRecord,
): ClaudeSubagentProjectedEntry | null {
  const promptText = readFirstClaudeSubagentString(record.messages, 'task_description')
  if (!promptText) {
    return null
  }

  const providerThreadId = readClaudeSubagentProviderThreadId(record)
  const startedAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'first')
  const entryId = `${providerThreadId}:launch-prompt`
  const message: UIMessage = {
    id: `provider-thread:${providerThreadId}:message:${entryId}`,
    role: 'user',
    parts: [{ type: 'text', text: promptText, state: 'done' }],
    metadata: {
      provider: 'claude-agent',
      providerThreadId,
      agentId: record.agentId,
      providerMessageId: entryId,
      providerMessageIds: [entryId],
      synthetic: 'launch-prompt',
    },
  }
  return {
    providerThreadId,
    agentId: record.agentId,
    turn: {
      id: entryId,
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      durationMs: null,
      itemsView: 'full',
      items: [],
    },
    message,
    rawMessages: [],
  }
}

function indexClaudeSubagentToolUseParts(
  entry: ClaudeSubagentProjectedEntry,
  toolEntryByCallId: Map<string, ClaudeSubagentProjectedEntry>,
): void {
  for (const part of entry.message.parts) {
    if (isClaudeSubagentToolUsePart(part)) {
      toolEntryByCallId.set(part.toolCallId, entry)
    }
  }
}

/**
 * Merges a `tool_result` part into an earlier `tool_use` part for the same `toolCallId` when
 * both originate from the same raw session message's content blocks. Must run before
 * cross-message merging (`mergeClaudeSubagentToolResultPartIntoEntry`), since that only indexes
 * tool_use parts from messages already fully processed — it can never see a tool_use from the
 * message currently being projected.
 */
function mergeClaudeSubagentToolResultPartsWithinMessage(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  const merged: UIMessage['parts'] = []
  const toolUseIndexByCallId = new Map<string, number>()

  for (const part of parts) {
    if (isClaudeSubagentToolResultPart(part)) {
      const toolUseIndex = toolUseIndexByCallId.get(part.toolCallId)
      const toolUsePart = toolUseIndex !== undefined ? merged[toolUseIndex] : undefined
      if (toolUseIndex !== undefined && toolUsePart && isClaudeSubagentToolUsePart(toolUsePart)) {
        merged[toolUseIndex] = {
          ...toolUsePart,
          ...part,
          input: toolUsePart.input ?? part.input,
        } as UIMessage['parts'][number]
        continue
      }
    }
    if (isClaudeSubagentToolUsePart(part)) {
      toolUseIndexByCallId.set(part.toolCallId, merged.length)
    }
    merged.push(part)
  }

  return merged
}

function mergeClaudeSubagentToolResultPartIntoEntry(
  part: UIMessage['parts'][number],
  message: ClaudeSubagentSessionMessage,
  toolEntryByCallId: Map<string, ClaudeSubagentProjectedEntry>,
): boolean {
  if (!isClaudeSubagentToolResultPart(part)) {
    return false
  }
  const entry = toolEntryByCallId.get(part.toolCallId)
  if (!entry) {
    return false
  }
  entry.message.parts = entry.message.parts.map((candidate) => {
    if (!isClaudeSubagentToolUsePart(candidate) || candidate.toolCallId !== part.toolCallId) {
      return candidate
    }
    return {
      ...candidate,
      ...part,
      input: candidate.input ?? part.input,
    } as UIMessage['parts'][number]
  })
  const providerMessageIds = readProviderMessageIds(entry.message.metadata)
  if (!providerMessageIds.includes(message.uuid)) {
    providerMessageIds.push(message.uuid)
  }
  entry.message.metadata = {
    ...readRecord(entry.message.metadata),
    providerMessageIds,
  }
  entry.rawMessages.push(message)
  entry.turn = projectClaudeSubagentEntryTurn(entry)
  return true
}

function readProviderMessageIds(metadata: UIMessage['metadata']): string[] {
  if (!metadata || typeof metadata !== 'object') {
    return []
  }
  const ids = (metadata as { providerMessageIds?: unknown }).providerMessageIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

function isClaudeSubagentToolUsePart(
  part: UIMessage['parts'][number],
): part is ClaudeSubagentProjectedToolPart {
  return isClaudeSubagentToolPart(part) && part.state === 'input-available'
}

function isClaudeSubagentToolResultPart(
  part: UIMessage['parts'][number],
): part is ClaudeSubagentProjectedToolPart {
  return (
    isClaudeSubagentToolPart(part)
    && (part.state === 'output-available' || part.state === 'output-error')
  )
}

function isClaudeSubagentToolErrorPart(
  part: UIMessage['parts'][number],
): part is ClaudeSubagentProjectedToolPart {
  return isClaudeSubagentToolPart(part) && part.state === 'output-error'
}

function isClaudeSubagentToolPart(
  part: UIMessage['parts'][number],
): part is ClaudeSubagentProjectedToolPart {
  return (
    typeof part.type === 'string'
    && part.type.startsWith('tool-')
    && typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
  )
}

function hasClaudeSubagentDisplayParts(message: ClaudeSubagentSessionMessage): boolean {
  return projectClaudeSubagentMessageParts(message, new Map()).length > 0
}

function readClaudeSubagentUiRole(message: ClaudeSubagentSessionMessage): UIMessage['role'] {
  if (hasClaudeSubagentToolResult(message)) {
    return 'assistant'
  }
  return message.type === 'assistant' || message.type === 'system' ? message.type : 'user'
}

function projectClaudeSubagentMessageParts(
  message: ClaudeSubagentSessionMessage,
  toolUseById: Map<string, { toolName: string, input: unknown }>,
): UIMessage['parts'] {
  const payload = readClaudeTranscriptPayload(message)
  if (!payload) {
    return projectClaudeSubagentTextPart(
      typeof message.message === 'string' ? message.message : null,
    )
  }
  const content = payload.content
  if (typeof content === 'string') {
    return projectClaudeSubagentTextPart(content)
  }
  if (!Array.isArray(content)) {
    return []
  }

  const parts: UIMessage['parts'] = []
  const toolResultCount = content.filter(block => block.type === 'tool_result').length
  for (const block of content) {
    if (block.type === 'text') {
      const text = normalizeProviderThreadRawText(block.text)
      if (text) {
        parts.push({ type: 'text', text, state: 'done' })
      }
      continue
    }
    if (block.type === 'thinking') {
      const thinking = normalizeProviderThreadRawText(block.thinking)
      if (thinking) {
        parts.push({ type: 'reasoning', text: thinking, state: 'done' })
      }
      continue
    }
    if (block.type === 'tool_use') {
      const part = projectClaudeSubagentToolUsePart(block, toolUseById)
      if (part) {
        parts.push(part)
      }
      continue
    }
    if (block.type === 'tool_result') {
      const part = projectClaudeSubagentToolResultPart(message, block, toolResultCount, toolUseById)
      if (part) {
        parts.push(part)
      }
      continue
    }
  }
  return parts
}

function projectClaudeSubagentTextPart(text: string | null): UIMessage['parts'] {
  const normalized = normalizeProviderThreadRawText(text)
  return normalized ? [{ type: 'text', text: normalized, state: 'done' }] : []
}

function readClaudeMessageText(message: ClaudeSubagentSessionMessage): string | null {
  return (
    projectClaudeSubagentMessageParts(message, new Map())
      .flatMap(part => (part.type === 'text' || part.type === 'reasoning' ? [part.text] : []))
      .join('\n')
      .trim() || null
  )
}

function collectClaudeSubagentToolUses(
  messages: ClaudeSubagentSessionMessage[],
): Map<string, { toolName: string, input: unknown }> {
  const toolUseById = new Map<string, { toolName: string, input: unknown }>()
  for (const message of messages) {
    const payload = readClaudeTranscriptPayload(message)
    if (!payload || typeof payload.content === 'string' || !Array.isArray(payload.content)) {
      continue
    }
    for (const block of payload.content) {
      if (block.type !== 'tool_use' || !block.id || !block.name) {
        continue
      }
      toolUseById.set(block.id, { toolName: block.name, input: block.input })
    }
  }
  return toolUseById
}

function projectClaudeSubagentToolUsePart(
  block: ClaudeTranscriptContentBlock,
  toolUseById: Map<string, { toolName: string, input: unknown }>,
): UIMessage['parts'][number] | null {
  if (!block.id || !block.name) {
    return null
  }
  toolUseById.set(block.id, { toolName: block.name, input: block.input })
  return {
    type: `tool-${block.name}`,
    toolCallId: block.id,
    state: 'input-available',
    input: createClaudeCodeToolInputPayload(block.name, block.input),
  } as UIMessage['parts'][number]
}

function projectClaudeSubagentToolResultPart(
  message: ClaudeSubagentSessionMessage,
  block: ClaudeTranscriptContentBlock,
  toolResultCount: number,
  toolUseById: Map<string, { toolName: string, input: unknown }>,
): UIMessage['parts'][number] | null {
  if (!block.tool_use_id) {
    return null
  }

  const toolUse = toolUseById.get(block.tool_use_id)
  const toolName = toolUse?.toolName ?? 'Tool'
  const result = normalizeClaudeSubagentToolResultContent(
    readClaudeSubagentToolResultContent(message, block, toolResultCount),
  )
  if (block.is_error) {
    return {
      type: `tool-${toolName}`,
      toolCallId: block.tool_use_id,
      state: 'output-error',
      ...(toolUse ? { input: createClaudeCodeToolInputPayload(toolName, toolUse.input) } : {}),
      errorText: normalizeClaudeSubagentToolErrorText(result),
    } as UIMessage['parts'][number]
  }

  return {
    type: `tool-${toolName}`,
    toolCallId: block.tool_use_id,
    state: 'output-available',
    ...(toolUse ? { input: createClaudeCodeToolInputPayload(toolName, toolUse.input) } : {}),
    output: createClaudeCodeToolResultPayload({
      apiName: toolName,
      args: toolUse?.input,
      result,
    }),
  } as UIMessage['parts'][number]
}

function hasClaudeSubagentToolResult(message: ClaudeSubagentSessionMessage): boolean {
  const payload = readClaudeTranscriptPayload(message)
  return Boolean(
    payload
    && Array.isArray(payload.content)
    && payload.content.some(block => block.type === 'tool_result' && Boolean(block.tool_use_id)),
  )
}

function readClaudeSubagentToolResultContent(
  message: ClaudeSubagentSessionMessage,
  block: ClaudeTranscriptContentBlock,
  toolResultCount: number,
): unknown {
  if (message.tool_use_result !== undefined && toolResultCount === 1) {
    return message.tool_use_result
  }
  return block.content
}

function normalizeClaudeSubagentToolResultContent(content: unknown): unknown {
  if (content == null) {
    return ''
  }
  if (typeof content === 'object') {
    return content
  }
  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    }
 catch {
      return content
    }
  }
  return String(content)
}

function normalizeClaudeSubagentToolErrorText(output: unknown): string {
  if (typeof output === 'string') {
    return output || 'Tool execution failed'
  }
  if (output == null) {
    return 'Tool execution failed'
  }
  try {
    return JSON.stringify(output)
  }
 catch {
    return String(output)
  }
}

function readClaudeTranscriptPayload(
  message: ClaudeSubagentSessionMessage,
): ClaudeTranscriptMessagePayload | null {
  if (typeof message.message === 'string') {
    return null
  }
  const record = readRecord(message.message)
  if (!('content' in record) && !('model' in record)) {
    return null
  }
  return {
    role: typeof record.role === 'string' ? record.role : undefined,
    content: readClaudeTranscriptContent(record.content),
    model: typeof record.model === 'string' ? record.model : undefined,
  }
}

function readClaudeTranscriptContent(value: unknown): ClaudeTranscriptMessagePayload['content'] {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.map(block => readRecord(block) as ClaudeTranscriptContentBlock)
}

function normalizeProviderThreadRawText(text: string | null | undefined): string | null {
  const normalized = text?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function hasClaudeAgentAccountSignal(account: AccountInfo | undefined): account is AccountInfo {
  return Boolean(
    account?.email
    || account?.organization
    || account?.subscriptionType
    || account?.tokenSource
    || account?.apiKeySource
    || account?.apiProvider,
  )
}
