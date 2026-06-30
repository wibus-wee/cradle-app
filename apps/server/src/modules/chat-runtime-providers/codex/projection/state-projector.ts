/**
 * Output: Codex providerStateSnapshot projections for notifications, goal state, and native history.
 * Input: runtime session snapshots, Codex app-server notifications, and full app-server turn history.
 * Position: Codex provider package owner for provider snapshot state projection.
 */

import { Buffer } from 'node:buffer'

import { readObjectRecord as readRecord } from '../../../../helpers/json-record'
import type {
  RuntimeApprovalStatus,
  RuntimeCompactUiSlotState,
  RuntimeGoalStatus,
  RuntimeMcpAuthStatus,
  RuntimeMcpServerStatus,
  RuntimePlanStepStatus,
  RuntimeSession,
  RuntimeTokenUsageBreakdown,
  RuntimeToolActivityStatus,
} from '../../../chat-runtime/runtime-provider-types'
import type { TokenUsage } from '../../../chat-runtime-engine/ai-sdk-engine'
import type { WorkspaceProviderStateSnapshot } from '../../provider-state-snapshot'
import {
  readWorkspaceProviderStateSnapshot,
} from '../../provider-state-snapshot'
import type { CodexAppServerMessage } from '../app-server/client'
import { isCodexAppServerToolApprovalRequest } from '../app-server/server-request-methods'
import type { Turn } from '../app-server-protocol/v2/Turn'
import { isRetryableCodexAppServerError } from '../turn/stream-diagnostics'
import type {
  AccountRateLimitsUpdatedNotificationParams,
  CodexAlertSnapshot,
  CodexApprovalsSnapshot,
  CodexCompactSnapshot,
  CodexDiffSnapshot,
  CodexGoalSnapshot,
  CodexGoalUpdatedNotificationParams,
  CodexMcpServerSnapshot,
  CodexMcpSnapshot,
  CodexPlanSnapshot,
  CodexProviderSnapshot,
  CodexThreadItem,
  CodexThreadSettings,
  CodexThreadStatus,
  CodexThreadTokenUsage,
  CodexTokenUsageBreakdown,
  CommandExecutionOutputDeltaNotificationParams,
  ContextCompactedNotificationParams,
  ErrorNotificationParams,
  FileChangePatchUpdatedNotificationParams,
  FsChangedNotificationParams,
  FuzzyFileSearchSessionNotificationParams,
  GuardianApprovalReviewNotificationParams,
  ItemNotificationParams,
  McpServerOauthLoginCompletedNotificationParams,
  McpServerStatusUpdatedNotificationParams,
  McpToolCallProgressNotificationParams,
  ProcessExitedNotificationParams,
  ProcessOutputDeltaNotificationParams,
  ServerRequestResolvedNotificationParams,
  TerminalInteractionNotificationParams,
  ThreadGoalGetResponse,
  ThreadSettingsUpdatedNotificationParams,
  ThreadStatusChangedNotificationParams,
  ThreadTokenUsageUpdatedNotificationParams,
  TurnDiffUpdatedNotificationParams,
  TurnNotificationParams,
  TurnPlanUpdatedNotificationParams,
  WarningNotificationParams,
} from '../types'

export interface CodexNativeHistorySnapshot {
  threadId: string
  itemsView: 'full'
  fetchedAt: number
  complete: boolean
  turns: Turn[]
  turnCount: number
  itemCount: number
  nextCursor: string | null
  error: string | null
}

interface ServerRequestBridgeNotificationParams {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
}

interface CodexProviderStateSnapshot extends WorkspaceProviderStateSnapshot {
  codex?: CodexProviderState
}

interface CodexProviderState extends Record<string, unknown> {
  nativeHistory?: CodexNativeHistorySnapshot
  previousNativeHistory?: CodexNativeHistorySnapshot
}

export function writeCodexNativeHistorySnapshot(
  runtimeSession: RuntimeSession,
  nativeHistory: CodexNativeHistorySnapshot,
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot) as CodexProviderStateSnapshot
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...readCodexState(snapshot),
      nativeHistory,
    },
  })
}

export function readRestorableCodexNativeHistory(raw: string | null | undefined): CodexNativeHistorySnapshot | undefined {
  try {
    const snapshot = readWorkspaceProviderStateSnapshot(raw) as CodexProviderStateSnapshot
    const nativeHistory = snapshot.codex?.nativeHistory
    if (isRestorableCodexNativeHistory(nativeHistory)) {
      return nativeHistory
    }
    const previousNativeHistory = snapshot.codex?.previousNativeHistory
    if (isRestorableCodexNativeHistory(previousNativeHistory)) {
      return previousNativeHistory
    }
    return undefined
  }
  catch {
    return undefined
  }
}

export function projectCodexProviderStateSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  projectCodexThreadSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexCompactSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexPlanSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexToolActivitySnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexMcpSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexDiffSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexTerminalSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexApprovalsSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexAlertSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexFilesystemSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexSearchSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexUsageSnapshot(runtimeSession, notification, fallbackThreadId)
  projectCodexGoalSnapshot(runtimeSession, notification)
}

function isRestorableCodexNativeHistory(value: CodexNativeHistorySnapshot | undefined): value is CodexNativeHistorySnapshot {
  return value?.itemsView === 'full'
    && value.complete
    && Array.isArray(value.turns)
    && value.turns.length > 0
}

function readCodexState(snapshot: CodexProviderStateSnapshot): Record<string, unknown> {
  return snapshot.codex && typeof snapshot.codex === 'object' && !Array.isArray(snapshot.codex)
    ? snapshot.codex
    : {}
}

export function hasActiveGoal(goal: CodexGoalSnapshot | null | undefined): boolean {
  return goal?.status === 'active' && typeof goal.objective === 'string' && goal.objective.trim().length > 0
}

export function projectCodexGoalSnapshotFromGoal(goal: ThreadGoalGetResponse['goal']): CodexGoalSnapshot | null {
  if (!goal?.threadId || !goal.objective || !isCodexGoalStatus(goal.status)) {
    return null
  }
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
    tokensUsed: typeof goal.tokensUsed === 'number' ? goal.tokensUsed : 0,
    timeUsedSeconds: typeof goal.timeUsedSeconds === 'number' ? goal.timeUsedSeconds : 0,
    createdAt: typeof goal.createdAt === 'number' ? goal.createdAt : 0,
    updatedAt: typeof goal.updatedAt === 'number' ? goal.updatedAt : 0,
  }
}

export function writeCodexGoalSnapshot(runtimeSession: RuntimeSession, goal: CodexGoalSnapshot): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      goal,
    },
  })
}

export function clearCodexGoalSnapshot(
  runtimeSession: RuntimeSession,
  options: { preserveCompletedGoal?: boolean } = {},
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  if (options.preserveCompletedGoal === true && snapshot.codex?.goal?.status === 'complete') {
    return
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      goal: null,
    },
  })
}

export function pauseCodexGoalSnapshot(runtimeSession: RuntimeSession): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const goal = snapshot.codex?.goal
  if (!hasActiveGoal(goal)) {
    return
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      goal: {
        ...goal,
        status: 'paused',
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexGoalSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
): void {
  if (notification.method === 'thread/goal/updated') {
    const goal = (notification.params as CodexGoalUpdatedNotificationParams | undefined)?.goal
    const goalSnapshot = projectCodexGoalSnapshotFromGoal(goal ?? null)
    if (goalSnapshot) {
      writeCodexGoalSnapshot(runtimeSession, goalSnapshot)
    }
    return
  }

  if (notification.method === 'thread/goal/cleared') {
    clearCodexGoalSnapshot(runtimeSession, { preserveCompletedGoal: true })
  }
}

export function writeCodexThreadSnapshot(
  runtimeSession: RuntimeSession,
  thread: {
    threadId: string
    modelId: string | null
    modelProvider: string | null
    serviceTier: string | null
    reasoningEffort: string | null
    status: CodexThreadStatus | null
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const now = Date.now()
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      model: {
        ...snapshot.codex?.model,
        threadId: thread.threadId,
        modelId: thread.modelId,
        modelProvider: thread.modelProvider,
        serviceTier: thread.serviceTier,
        updatedAt: now,
      },
      reasoning: {
        ...snapshot.codex?.reasoning,
        threadId: thread.threadId,
        effort: thread.reasoningEffort,
        summary: snapshot.codex?.reasoning?.summary ?? null,
        updatedAt: now,
      },
      ...(thread.status
        ? {
            status: {
              threadId: thread.threadId,
              status: thread.status,
              updatedAt: now,
            },
          }
        : {}),
    },
  })
}

function projectCodexThreadSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'thread/status/changed') {
    const params = notification.params as ThreadStatusChangedNotificationParams | undefined
    if (!params?.status) {
      return
    }
    writeCodexStatusSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      status: params.status,
      updatedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'thread/settings/updated') {
    const params = notification.params as ThreadSettingsUpdatedNotificationParams | undefined
    if (!params?.threadSettings) {
      return
    }
    writeCodexSettingsSnapshot(runtimeSession, params.threadId ?? fallbackThreadId, params.threadSettings)
  }
}

function writeCodexStatusSnapshot(
  runtimeSession: RuntimeSession,
  status: NonNullable<CodexProviderSnapshot['codex']>['status'],
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      status,
    },
  })
}

function writeCodexSettingsSnapshot(
  runtimeSession: RuntimeSession,
  threadId: string,
  settings: CodexThreadSettings,
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const now = Date.now()
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      model: {
        ...snapshot.codex?.model,
        threadId,
        modelId: settings.model ?? snapshot.codex?.model?.modelId ?? null,
        modelProvider: settings.modelProvider ?? snapshot.codex?.model?.modelProvider ?? null,
        serviceTier: settings.serviceTier ?? snapshot.codex?.model?.serviceTier ?? null,
        updatedAt: now,
      },
      reasoning: {
        ...snapshot.codex?.reasoning,
        threadId,
        effort: settings.effort ?? snapshot.codex?.reasoning?.effort ?? null,
        summary: settings.summary ?? snapshot.codex?.reasoning?.summary ?? null,
        updatedAt: now,
      },
    },
  })
}

function projectCodexCompactSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'thread/tokenUsage/updated') {
    const params = notification.params as ThreadTokenUsageUpdatedNotificationParams | undefined
    if (!params?.tokenUsage) {
      return
    }
    writeCodexCompactSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      tokenUsage: params.tokenUsage,
      updatedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'thread/compacted') {
    const params = notification.params as ContextCompactedNotificationParams | undefined
    mergeCodexCompactSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      turnId: params?.turnId ?? null,
      status: 'compacted',
      lastCompactedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'item/started') {
    const params = notification.params as ItemNotificationParams | undefined
    if (params?.item?.type !== 'contextCompaction') {
      return
    }
    mergeCodexCompactSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      status: 'running',
      compactionStartedAt: typeof params.startedAtMs === 'number' ? params.startedAtMs : Date.now(),
      compactionItemId: params.item.id ?? null,
    })
    return
  }

  if (notification.method === 'item/completed') {
    const params = notification.params as ItemNotificationParams | undefined
    if (params?.item?.type !== 'contextCompaction') {
      return
    }
    const compactionItemId = params.item.id ?? null
    const existing = readCodexCompactSnapshot(runtimeSession.providerStateSnapshot)
    mergeCodexCompactSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      status: 'compacted',
      lastCompactedAt: typeof params.completedAtMs === 'number' ? params.completedAtMs : Date.now(),
      compactionItemId,
      completedCompactionItemIds: compactionItemId
        ? [compactionItemId, ...(existing?.completedCompactionItemIds ?? []).filter(id => id !== compactionItemId)].slice(0, 6)
        : existing?.completedCompactionItemIds ?? [],
    })
  }
}

function writeCodexCompactSnapshot(runtimeSession: RuntimeSession, compact: CodexCompactSnapshot): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      compact: {
        ...readCodexCompactSnapshot(runtimeSession.providerStateSnapshot),
        ...compact,
      },
    },
  })
}

function mergeCodexCompactSnapshot(
  runtimeSession: RuntimeSession,
  compact: Pick<CodexCompactSnapshot, 'threadId' | 'turnId'> & Partial<CodexCompactSnapshot>,
): void {
  const existing = readCodexCompactSnapshot(runtimeSession.providerStateSnapshot)
  const tokenUsage = existing?.tokenUsage ?? {
    total: createEmptyTokenUsageBreakdown(),
    last: createEmptyTokenUsageBreakdown(),
    modelContextWindow: null,
  }
  writeCodexCompactSnapshot(runtimeSession, {
    ...existing,
    threadId: compact.threadId,
    turnId: compact.turnId,
    tokenUsage,
    updatedAt: Date.now(),
    status: compact.status ?? existing?.status,
    compactionStartedAt: compact.compactionStartedAt ?? existing?.compactionStartedAt ?? null,
    lastCompactedAt: compact.lastCompactedAt ?? existing?.lastCompactedAt ?? null,
    compactionItemId: compact.compactionItemId ?? existing?.compactionItemId ?? null,
    completedCompactionItemIds: compact.completedCompactionItemIds ?? existing?.completedCompactionItemIds ?? [],
  })
}

function projectCodexPlanSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'turn/started') {
    const params = notification.params as TurnNotificationParams | undefined
    const existing = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.plan
    const threadId = params?.threadId ?? fallbackThreadId
    if (existing?.threadId === threadId) {
      clearCodexPlanSnapshot(runtimeSession)
    }
    return
  }

  if (notification.method === 'item/completed') {
    const params = notification.params as ItemNotificationParams | undefined
    if (params?.item?.type !== 'plan') {
      return
    }
    const content = params.item.text?.trim()
    if (!content) {
      return
    }
    const existing = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.plan
    writeCodexPlanSnapshot(runtimeSession, {
      threadId: params.threadId ?? existing?.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? existing?.turnId ?? null,
      explanation: existing?.explanation ?? null,
      content,
      steps: existing?.steps ?? [],
      updatedAt: Date.now(),
    })
    return
  }

  if (notification.method !== 'turn/plan/updated') {
    return
  }
  const params = notification.params as TurnPlanUpdatedNotificationParams | undefined
  const existing = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.plan
  const steps = (params?.plan ?? [])
    .flatMap(step => typeof step.step === 'string' && isRuntimePlanStepStatus(step.status)
      ? [{ step: step.step, status: step.status }]
      : [])
  writeCodexPlanSnapshot(runtimeSession, {
    threadId: params?.threadId ?? fallbackThreadId,
    turnId: params?.turnId ?? null,
    explanation: typeof params?.explanation === 'string' ? params.explanation : null,
    content: existing?.turnId === (params?.turnId ?? null) ? existing.content : null,
    steps,
    updatedAt: Date.now(),
  })
}

function writeCodexPlanSnapshot(runtimeSession: RuntimeSession, plan: CodexPlanSnapshot): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      plan,
    },
  })
}

function clearCodexPlanSnapshot(runtimeSession: RuntimeSession): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const codex = { ...snapshot.codex }
  delete codex.plan
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex,
  })
}

function projectCodexToolActivitySnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'item/started' && notification.method !== 'item/completed') {
    if (notification.method === 'item/plan/delta') {
      writeCodexToolActivityItem(runtimeSession, {
        threadId: (notification.params as { threadId?: string } | undefined)?.threadId ?? fallbackThreadId,
        turnId: (notification.params as { turnId?: string } | undefined)?.turnId ?? null,
        item: {
          id: (notification.params as { itemId?: string } | undefined)?.itemId ?? 'plan-delta',
          type: 'plan',
          text: 'Streaming plan',
        },
        status: 'running',
        startedAt: Date.now(),
        completedAt: null,
      })
    }
    return
  }
  const params = notification.params as ItemNotificationParams | undefined
  const item = params?.item
  if (!params || !item?.id || !item.type || !isToolActivityItem(item.type)) {
    return
  }
  writeCodexToolActivityItem(runtimeSession, {
    threadId: params.threadId ?? fallbackThreadId,
    turnId: params.turnId ?? null,
    item,
    status: notification.method === 'item/completed' ? readToolActivityCompletionStatus(item) : 'running',
    startedAt: notification.method === 'item/started' && typeof params.startedAtMs === 'number' ? params.startedAtMs : null,
    completedAt: notification.method === 'item/completed' && typeof params.completedAtMs === 'number' ? params.completedAtMs : null,
  })
}

function writeCodexToolActivityItem(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string
    turnId: string | null
    item: CodexThreadItem
    status: RuntimeToolActivityStatus
    startedAt: number | null
    completedAt: number | null
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.toolActivity
  const existingItems = existing?.items ?? []
  const itemId = input.item.id ?? `${input.item.type ?? 'item'}-${Date.now()}`
  const current = existingItems.find(item => item.id === itemId)
  const nextItem = {
    id: itemId,
    type: input.item.type ?? 'unknown',
    label: readToolActivityLabel(input.item),
    status: input.status,
    startedAt: input.startedAt ?? current?.startedAt ?? null,
    completedAt: input.completedAt ?? current?.completedAt ?? null,
    ...(input.item.type === 'collabAgentToolCall'
      ? {
          senderThreadId: typeof input.item.senderThreadId === 'string' ? input.item.senderThreadId : current?.senderThreadId ?? null,
          receiverThreadIds: Array.isArray(input.item.receiverThreadIds) ? input.item.receiverThreadIds.filter(id => typeof id === 'string') : current?.receiverThreadIds ?? [],
          prompt: typeof input.item.prompt === 'string' ? input.item.prompt : current?.prompt ?? null,
          model: typeof input.item.model === 'string' ? input.item.model : current?.model ?? null,
          reasoningEffort: typeof input.item.reasoningEffort === 'string' ? input.item.reasoningEffort : current?.reasoningEffort ?? null,
          agentsStates: input.item.agentsStates ?? current?.agentsStates ?? {},
        }
      : {}),
  }
  const items = [
    nextItem,
    ...existingItems.filter(item => item.id !== itemId),
  ].slice(0, 12)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      toolActivity: {
        threadId: input.threadId,
        turnId: input.turnId,
        items,
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexMcpSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'mcpServer/startupStatus/updated') {
    const params = notification.params as McpServerStatusUpdatedNotificationParams | undefined
    if (!params?.name) {
      return
    }
    mergeCodexMcpServer(runtimeSession, fallbackThreadId, {
      name: params.name,
      status: normalizeMcpServerStatus(params.status),
      authStatus: 'unknown',
      toolCount: 0,
      resourceCount: 0,
      error: typeof params.error === 'string' ? params.error : null,
    })
    return
  }
  if (notification.method === 'mcpServer/oauthLogin/completed') {
    const params = notification.params as McpServerOauthLoginCompletedNotificationParams | undefined
    if (!params?.name) {
      return
    }
    mergeCodexMcpServer(runtimeSession, fallbackThreadId, {
      name: params.name,
      status: params.success === false ? 'failed' : 'ready',
      authStatus: params.success === false ? 'notLoggedIn' : 'oAuth',
      toolCount: 0,
      resourceCount: 0,
      error: typeof params.error === 'string' ? params.error : null,
    })
    return
  }
  if (notification.method === 'item/mcpToolCall/progress') {
    const params = notification.params as McpToolCallProgressNotificationParams | undefined
    mergeCodexMcpSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      recentProgress: typeof params?.message === 'string' ? params.message : null,
    })
  }
}

function mergeCodexMcpServer(
  runtimeSession: RuntimeSession,
  threadId: string,
  server: CodexMcpServerSnapshot,
): void {
  const existing = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.mcp
  mergeCodexMcpSnapshot(runtimeSession, {
    threadId,
    servers: [
      server,
      ...(existing?.servers ?? []).filter(candidate => candidate.name !== server.name),
    ],
  })
}

function mergeCodexMcpSnapshot(
  runtimeSession: RuntimeSession,
  patch: Partial<CodexMcpSnapshot> & { threadId: string },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.mcp
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      mcp: {
        threadId: patch.threadId,
        servers: patch.servers ?? existing?.servers ?? [],
        recentProgress: patch.recentProgress ?? existing?.recentProgress ?? null,
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexDiffSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'turn/diff/updated') {
    const params = notification.params as TurnDiffUpdatedNotificationParams | undefined
    writeCodexDiffSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      turnId: params?.turnId ?? null,
      files: summarizeUnifiedDiff(params?.diff ?? ''),
      updatedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'item/fileChange/patchUpdated') {
    const params = notification.params as FileChangePatchUpdatedNotificationParams | undefined
    const files = (params?.changes ?? [])
      .flatMap(change => typeof change.path === 'string'
        ? [{ path: change.path, ...countDiffLines(change.diff ?? '') }]
        : [])
    writeCodexDiffSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      turnId: params?.turnId ?? null,
      files,
      updatedAt: Date.now(),
    })
  }
}

function writeCodexDiffSnapshot(runtimeSession: RuntimeSession, diff: CodexDiffSnapshot): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      diff,
    },
  })
}

function projectCodexTerminalSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    const params = notification.params as ItemNotificationParams | undefined
    if (params?.item?.type !== 'commandExecution' || !params.item.id) {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      id: params.item.id,
      command: params.item.command ?? null,
      status: notification.method === 'item/completed' ? readToolActivityCompletionStatus(params.item) : 'running',
      outputPreview: null,
    })
    return
  }

  if (notification.method === 'item/commandExecution/outputDelta') {
    const params = notification.params as CommandExecutionOutputDeltaNotificationParams | undefined
    if (!params?.itemId || typeof params.delta !== 'string') {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      id: params.itemId,
      command: null,
      status: 'running',
      outputPreview: params.delta,
    })
    return
  }

  if (notification.method === 'item/commandExecution/terminalInteraction') {
    const params = notification.params as TerminalInteractionNotificationParams | undefined
    if (!params?.itemId || typeof params.stdin !== 'string') {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      id: params.itemId,
      command: null,
      status: 'running',
      outputPreview: params.stdin,
    })
    return
  }

  if (notification.method === 'process/outputDelta') {
    const params = notification.params as ProcessOutputDeltaNotificationParams | undefined
    if (!params?.processHandle || typeof params.deltaBase64 !== 'string') {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: fallbackThreadId,
      turnId: null,
      id: params.processHandle,
      command: null,
      status: 'running',
      outputPreview: decodeBase64Preview(params.deltaBase64),
    })
    return
  }

  if (notification.method === 'process/exited') {
    const params = notification.params as ProcessExitedNotificationParams | undefined
    if (!params?.processHandle) {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: fallbackThreadId,
      turnId: null,
      id: params.processHandle,
      command: null,
      status: params.exitCode === 0 ? 'completed' : 'failed',
      outputPreview: [params.stdout, params.stderr].filter(value => typeof value === 'string' && value.length > 0).join('\n') || null,
    })
  }
}

function writeCodexTerminalCommand(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string
    turnId: string | null
    id: string
    command: string | null
    status: RuntimeToolActivityStatus
    outputPreview: string | null
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.terminal
  const existingCommands = existing?.commands ?? []
  const current = existingCommands.find(command => command.id === input.id)
  const nextCommand = {
    id: input.id,
    command: input.command ?? current?.command ?? null,
    status: input.status,
    outputPreview: trimPreview([current?.outputPreview, input.outputPreview].filter(Boolean).join('')),
    updatedAt: Date.now(),
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      terminal: {
        threadId: input.threadId,
        turnId: input.turnId,
        commands: [
          nextCommand,
          ...existingCommands.filter(command => command.id !== input.id),
        ].slice(0, 8),
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexApprovalsSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'item/autoApprovalReview/started' || notification.method === 'item/autoApprovalReview/completed') {
    const params = notification.params as GuardianApprovalReviewNotificationParams | undefined
    if (!params?.reviewId) {
      return
    }
    writeCodexApprovalItem(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      item: {
        id: params.reviewId,
        targetItemId: params.targetItemId ?? null,
        status: normalizeApprovalStatus(params.review?.status) ?? (notification.method === 'item/autoApprovalReview/completed' ? 'approved' : 'pending'),
        label: readApprovalActionLabel(params.action),
        riskLevel: typeof params.review?.riskLevel === 'string' ? params.review.riskLevel : null,
        rationale: typeof params.review?.rationale === 'string' ? params.review.rationale : null,
        startedAt: typeof params.startedAtMs === 'number' ? params.startedAtMs : null,
        completedAt: typeof params.completedAtMs === 'number' ? params.completedAtMs : null,
      },
    })
    return
  }

  if (notification.method === 'serverRequest/resolved') {
    const params = notification.params as ServerRequestResolvedNotificationParams | undefined
    if (!params?.requestId) {
      return
    }
    updateResolvedApproval(runtimeSession, params.requestId)
    return
  }

  if (notification.method === 'serverRequest/pending') {
    const params = notification.params as ServerRequestBridgeNotificationParams | undefined
    if (typeof params?.id !== 'number' || !params.method || !isCodexAppServerToolApprovalRequest(params.method)) {
      return
    }
    const requestParams = readRecord(params.params)
    writeCodexApprovalItem(runtimeSession, {
      threadId: readString(requestParams.threadId) ?? fallbackThreadId,
      turnId: readString(requestParams.turnId),
      item: {
        id: `server-request-${params.id}`,
        targetItemId: readString(requestParams.itemId),
        status: 'pending',
        label: readServerRequestApprovalLabel(params.method),
        riskLevel: null,
        rationale: readString(requestParams.reason),
        startedAt: readNumber(requestParams.startedAtMs),
        completedAt: null,
      },
    })
    return
  }

  if (notification.method === 'serverRequest/handled') {
    const params = notification.params as ServerRequestBridgeNotificationParams | undefined
    if (typeof params?.id !== 'number' || !params.method || !isCodexAppServerToolApprovalRequest(params.method)) {
      return
    }
    updateResolvedApproval(
      runtimeSession,
      `server-request-${params.id}`,
      readServerRequestApprovalStatus(params.method, params.result),
    )
  }
}

function writeCodexApprovalItem(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string
    turnId: string | null
    item: CodexApprovalsSnapshot['items'][number]
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.approvals
  const existingItems = existing?.items ?? []
  const current = existingItems.find(item => item.id === input.item.id)
  const nextItem = {
    ...input.item,
    startedAt: input.item.startedAt ?? current?.startedAt ?? null,
    completedAt: input.item.completedAt ?? current?.completedAt ?? null,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      approvals: {
        threadId: input.threadId,
        turnId: input.turnId,
        items: [
          nextItem,
          ...existingItems.filter(item => item.id !== input.item.id),
        ].slice(0, 12),
        updatedAt: Date.now(),
      },
    },
  })
}

function updateResolvedApproval(
  runtimeSession: RuntimeSession,
  requestId: string,
  status: RuntimeApprovalStatus = 'approved',
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const approvals = snapshot.codex?.approvals
  if (!approvals) {
    return
  }
  const items = approvals.items.map(item => item.id === requestId && item.status === 'pending'
    ? { ...item, status, completedAt: Date.now() }
    : item)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      approvals: {
        ...approvals,
        items,
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexAlertSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'warning'
    && notification.method !== 'guardianWarning'
    && notification.method !== 'configWarning'
    && notification.method !== 'deprecationNotice'
    && notification.method !== 'error') {
    return
  }
  if (notification.method === 'error' && isRetryableCodexAppServerError(notification)) {
    return
  }
  const params = notification.params as WarningNotificationParams | ErrorNotificationParams | undefined
  const message = readAlertMessage(notification.method, params)
  if (!message) {
    return
  }
  writeCodexAlertItem(runtimeSession, {
    threadId: readAlertThreadId(notification.method, params, fallbackThreadId),
    item: {
      id: `${notification.method}:${Date.now()}`,
      severity: notification.method === 'error' ? 'error' : 'warning',
      message,
      source: notification.method,
      updatedAt: Date.now(),
    },
  })
}

function writeCodexAlertItem(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string | null
    item: CodexAlertSnapshot['items'][number]
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.alert
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      alert: {
        threadId: input.threadId,
        items: [
          input.item,
          ...(existing?.items ?? []),
        ].slice(0, 8),
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexFilesystemSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'fs/changed') {
    return
  }
  const params = notification.params as FsChangedNotificationParams | undefined
  const changedPaths = (params?.changedPaths ?? []).filter(path => typeof path === 'string')
  if (changedPaths.length === 0) {
    return
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.filesystem
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      filesystem: {
        threadId: existing?.threadId ?? fallbackThreadId,
        recentPaths: [...changedPaths, ...(existing?.recentPaths ?? [])].filter((path, index, paths) => paths.indexOf(path) === index).slice(0, 12),
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexSearchSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'fuzzyFileSearch/sessionUpdated' && notification.method !== 'fuzzyFileSearch/sessionCompleted') {
    return
  }
  const params = notification.params as FuzzyFileSearchSessionNotificationParams | undefined
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.search
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      search: {
        threadId: params?.threadId ?? existing?.threadId ?? fallbackThreadId,
        recentResultCount: readNonNegativeNumber(params?.resultCount ?? params?.results?.length ?? existing?.recentResultCount),
        recentQuery: typeof params?.query === 'string' ? params.query : existing?.recentQuery ?? null,
        fuzzySessionActive: notification.method === 'fuzzyFileSearch/sessionUpdated',
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexUsageSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'account/rateLimits/updated') {
    return
  }
  const params = notification.params as AccountRateLimitsUpdatedNotificationParams | undefined
  if (!params?.rateLimits) {
    return
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      usage: {
        threadId: fallbackThreadId,
        rateLimits: params.rateLimits,
        updatedAt: Date.now(),
      },
    },
  })
}

function summarizeUnifiedDiff(diff: string): CodexDiffSnapshot['files'] {
  const fileMap = new Map<string, { path: string, addedLines: number, removedLines: number }>()
  let currentPath: string | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      currentPath = match?.[2] ?? null
      if (currentPath && !fileMap.has(currentPath)) {
        fileMap.set(currentPath, { path: currentPath, addedLines: 0, removedLines: 0 })
      }
      continue
    }
    if (line.startsWith('+++ b/')) {
      currentPath = line.slice('+++ b/'.length)
      if (!fileMap.has(currentPath)) {
        fileMap.set(currentPath, { path: currentPath, addedLines: 0, removedLines: 0 })
      }
      continue
    }
    if (!currentPath || line.startsWith('+++') || line.startsWith('---')) {
      continue
    }
    const file = fileMap.get(currentPath)
    if (!file) {
      continue
    }
    if (line.startsWith('+')) {
      file.addedLines += 1
    }
    else if (line.startsWith('-')) {
      file.removedLines += 1
    }
  }
  return [...fileMap.values()]
}

function countDiffLines(diff: string): { addedLines: number, removedLines: number } {
  return diff.split('\n').reduce((counts, line) => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return counts
    }
    if (line.startsWith('+')) {
      counts.addedLines += 1
    }
    else if (line.startsWith('-')) {
      counts.removedLines += 1
    }
    return counts
  }, { addedLines: 0, removedLines: 0 })
}

function trimPreview(value: string | null): string | null {
  if (!value) {
    return null
  }
  const normalized = value.replace(/\s+$/g, '')
  return normalized.length > 240 ? normalized.slice(-240) : normalized
}

function decodeBase64Preview(value: string): string | null {
  try {
    return Buffer.from(value, 'base64').toString('utf-8')
  }
  catch {
    return null
  }
}

function normalizeApprovalStatus(value: unknown): RuntimeApprovalStatus | null {
  switch (value) {
    case 'inProgress':
      return 'pending'
    case 'approved':
    case 'denied':
    case 'timedOut':
    case 'aborted':
      return value
    default:
      return null
  }
}

function readApprovalActionLabel(action: GuardianApprovalReviewNotificationParams['action']): string {
  if (typeof action === 'string') {
    return formatRuntimePhrase(action)
  }
  switch (action?.type) {
    case 'command':
      return 'Command'
    case 'execve':
      return 'Process'
    case 'applyPatch':
      return 'File change'
    case 'networkAccess':
      return 'Network'
    case 'mcpToolCall':
      return 'MCP tool'
    case 'requestPermissions':
      return 'Permissions'
    default:
      return 'Approval'
  }
}

function readServerRequestApprovalLabel(method: string): string {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return 'Command'
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return 'File change'
    case 'item/permissions/requestApproval':
      return 'Permissions'
    default:
      return 'Approval'
  }
}

function readServerRequestApprovalStatus(method: string, result: unknown): RuntimeApprovalStatus {
  const response = readRecord(result)
  const decision = response.decision
  if (decision === 'decline' || decision === 'denied') {
    return 'denied'
  }
  if (decision === 'cancel' || decision === 'abort') {
    return 'aborted'
  }
  if (decision === 'timed_out') {
    return 'timedOut'
  }
  if (method === 'item/permissions/requestApproval') {
    return Object.keys(readRecord(response.permissions)).length > 0 ? 'approved' : 'denied'
  }
  return 'approved'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readAlertMessage(method: string, params: WarningNotificationParams | ErrorNotificationParams | undefined): string | null {
  if (method === 'configWarning') {
    const warning = params as WarningNotificationParams | undefined
    return [warning?.summary, warning?.details].filter(Boolean).join(': ') || null
  }
  if (method === 'error') {
    const error = params as ErrorNotificationParams | undefined
    return error?.message ?? error?.error?.message ?? null
  }
  const warning = params as WarningNotificationParams | undefined
  return warning?.message ?? warning?.summary ?? null
}

function readAlertThreadId(
  method: string,
  params: WarningNotificationParams | ErrorNotificationParams | undefined,
  fallbackThreadId: string,
): string | null {
  if (method === 'configWarning' || method === 'deprecationNotice') {
    return null
  }
  const warning = params as WarningNotificationParams | undefined
  return warning?.threadId ?? fallbackThreadId
}

export function isCodexGoalStatus(value: unknown): value is RuntimeGoalStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'blocked'
    || value === 'usageLimited'
    || value === 'budgetLimited'
    || value === 'complete'
}

function isRuntimePlanStepStatus(value: unknown): value is RuntimePlanStepStatus {
  return value === 'pending' || value === 'inProgress' || value === 'completed'
}

function isToolActivityItem(type: string): boolean {
  return type === 'plan'
    || type === 'commandExecution'
    || type === 'fileChange'
    || type === 'mcpToolCall'
    || type === 'dynamicToolCall'
    || type === 'collabAgentToolCall'
    || type === 'subAgentActivity'
    || type === 'webSearch'
    || type === 'sleep'
    || type === 'imageGeneration'
    || type === 'enteredReviewMode'
    || type === 'exitedReviewMode'
    || type === 'contextCompaction'
}

function readToolActivityCompletionStatus(item: CodexThreadItem): RuntimeToolActivityStatus {
  if (readCodexItemError(item)) {
    return 'failed'
  }
  if (item.status === 'failed') {
    return 'failed'
  }
  return 'completed'
}

function readToolActivityLabel(item: CodexThreadItem): string {
  switch (item.type) {
    case 'commandExecution':
      return item.command ?? 'Command'
    case 'fileChange':
      return item.changes?.flatMap(change => typeof change.path === 'string' ? [change.path] : []).join(', ') || 'File change'
    case 'mcpToolCall':
      return [item.server, item.tool].filter(Boolean).join('/') || 'MCP tool'
    case 'dynamicToolCall':
      return item.tool ?? 'Tool'
    case 'collabAgentToolCall':
      return item.tool ?? 'Agent'
    case 'subAgentActivity':
      return [item.kind, item.agentPath].filter(Boolean).join(' ') || 'Subagent activity'
    case 'webSearch':
      return item.query ?? 'Web search'
    case 'sleep':
      return item.durationMs === null || item.durationMs === undefined ? 'Sleep' : `Sleep ${item.durationMs}ms`
    case 'plan':
      return item.text ?? 'Plan'
    case 'imageGeneration':
      return 'Image generation'
    case 'enteredReviewMode':
      return 'Entered review mode'
    case 'exitedReviewMode':
      return 'Exited review mode'
    case 'contextCompaction':
      return 'Context compaction'
    default:
      return item.type ?? 'Activity'
  }
}

function formatRuntimePhrase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function readCodexItemError(item: CodexThreadItem): string | null {
  if (typeof item.error === 'string') {
    return item.error
  }
  if (typeof item.error?.message === 'string') {
    return item.error.message
  }
  return null
}

function normalizeMcpServerStatus(value: unknown): RuntimeMcpServerStatus {
  switch (value) {
    case 'starting':
    case 'ready':
    case 'failed':
    case 'cancelled':
      return value
    default:
      return 'unknown'
  }
}

export function normalizeMcpAuthStatus(value: unknown): RuntimeMcpAuthStatus {
  switch (value) {
    case 'unsupported':
    case 'notLoggedIn':
    case 'bearerToken':
    case 'oAuth':
      return value
    default:
      return 'unknown'
  }
}

export function readCodexProviderSnapshot(raw: string | null | undefined): CodexProviderSnapshot {
  return readWorkspaceProviderStateSnapshot(raw) as CodexProviderSnapshot
}

export function readCodexCompactSnapshot(raw: string | null | undefined): CodexCompactSnapshot | null {
  const compact = readCodexProviderSnapshot(raw).codex?.compact
  if (!compact || typeof compact.threadId !== 'string') {
    return null
  }
  return {
    threadId: compact.threadId,
    turnId: typeof compact.turnId === 'string' ? compact.turnId : null,
    tokenUsage: compact.tokenUsage ?? {
      total: createEmptyTokenUsageBreakdown(),
      last: createEmptyTokenUsageBreakdown(),
      modelContextWindow: null,
    },
    updatedAt: typeof compact.updatedAt === 'number' ? compact.updatedAt : 0,
    status: normalizeCompactLifecycleStatus(compact.status),
    compactionStartedAt: typeof compact.compactionStartedAt === 'number' ? compact.compactionStartedAt : null,
    lastCompactedAt: typeof compact.lastCompactedAt === 'number' ? compact.lastCompactedAt : null,
    compactionItemId: typeof compact.compactionItemId === 'string' ? compact.compactionItemId : null,
    completedCompactionItemIds: Array.isArray(compact.completedCompactionItemIds)
      ? compact.completedCompactionItemIds.filter(id => typeof id === 'string')
      : [],
  }
}

function normalizeCompactLifecycleStatus(value: unknown): RuntimeCompactUiSlotState['status'] | undefined {
  if (value === 'running' || value === 'compacted') {
    return value
  }
  return undefined
}

export function normalizeTokenUsageBreakdown(value: CodexTokenUsageBreakdown | undefined): RuntimeTokenUsageBreakdown {
  return {
    totalTokens: readNonNegativeNumber(value?.totalTokens),
    inputTokens: readNonNegativeNumber(value?.inputTokens),
    cachedInputTokens: readNonNegativeNumber(value?.cachedInputTokens),
    outputTokens: readNonNegativeNumber(value?.outputTokens),
    reasoningOutputTokens: readNonNegativeNumber(value?.reasoningOutputTokens),
  }
}

export function readCodexLastTokenUsage(value: CodexThreadTokenUsage | undefined): TokenUsage | null {
  const last = normalizeTokenUsageBreakdown(value?.last)
  if (last.totalTokens === 0 && last.inputTokens === 0 && last.outputTokens === 0) {
    return null
  }
  return {
    promptTokens: last.inputTokens,
    completionTokens: last.outputTokens,
    totalTokens: last.totalTokens || last.inputTokens + last.outputTokens,
  }
}

function createEmptyTokenUsageBreakdown(): RuntimeTokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
}

export function readConfigNumber(value: number | bigint | null | undefined): number | null {
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return readPositiveNumber(value)
}

export function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function readPercent(value: number, limit: number): number {
  return Math.min(100, Math.max(0, Math.round((value / limit) * 100)))
}

export function readNullablePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
}

export function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
