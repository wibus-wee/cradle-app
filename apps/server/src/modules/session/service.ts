import { randomUUID } from 'node:crypto'

import type { Message, Session } from '@cradle/db'
import { agents, backendRuns, backendSessionBindings, messages, sessions } from '@cradle/db'
import { and, desc, eq, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import {
  AgentRuntimeConfigJsonSchema,
  buildSessionRuntimeConfigJson,
} from '../../helpers/agent-runtime-config'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import { db } from '../../infra'
import { commitSessionEventsWithProjection } from '../chat-runtime/es/commands'
import type {
  ChatRuntimeSettingsPatch,
  ChatThinkingEffort,
} from '../chat-runtime/runtime-provider-types'
import type { SessionClaudeAgentConfigPatchInput } from '../chat-runtime/runtime-settings'
import {
  mergeRuntimeSettings,
  normalizeRuntimeSettingsPatch,
  readSessionRuntimeSettings,
  writeSessionRuntimeConfigJson,
} from '../chat-runtime/runtime-settings'
import { normalizeClaudeAgentConfigPatch } from '../provider-contracts/claude-agent-config'
import {
  readRuntimeOwnedProviderTargetOwner,
  runtimeOwnsProviderBinding,
  runtimeUsesAgentTerminalLaunch,
} from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import { invalidateDurableProviderRuntimeBindingForChatSession } from '../provider-runtime/service'
import {
  assertProviderTargetCompatibleWithRuntime,
  resolveProviderTarget,
} from '../provider-targets/service'
import * as Workspace from '../workspace/service'
import { attachSessionToWorktree, readSessionIsolation } from '../worktree/service'

export type SessionStatus = 'idle' | 'streaming' | 'error'
export type SessionView = Session & {
  modelId: string | null
  thinkingEffort: ChatThinkingEffort | null
  status: SessionStatus
  latestUserMessageAt: number | null
  latestAssistantMessageAt: number | null
  unread: boolean
  isIsolated: boolean
  worktreeId: string | null
  worktreeBranch: string | null
  worktreePath: string | null
  worktreeHealth: 'ok' | 'missing' | 'stale' | null
  pendingWorktreeId: string | null
  isolationBoundaryRequired: boolean
}

type SessionRuntimeSettingsCreatePatch = ChatRuntimeSettingsPatch & {
  claudeAgent?: SessionClaudeAgentConfigPatchInput | null
}

const SessionCreateInputSchema = z.object({
  id: z.string().default(() => randomUUID()),
  workspaceId: z.string().nullable().optional(),
  title: z.string(),
  origin: z.string().trim().min(1).default('manual'),
  parentSessionId: z.string().nullable().optional(),
  sideContextSource: z.enum(['provider-native', 'cradle-context']).nullable().optional(),
  providerTargetId: z.string().optional(),
  modelId: z.string().nullable().optional(),
  thinkingEffort: z.enum(['low', 'medium', 'high', 'xhigh']).nullable().optional(),
  runtimeKind: z.string().trim().min(1).optional(),
  runtimeSettings: z.unknown().optional(),
  agentId: z.string().nullable().optional(),
  linkedIssueId: z.string().nullable().default(null),
  worktreeId: z.string().nullable().optional(),
  configJson: z.string().optional(),
})

function listRequestedModelsBySessionIds(sessionIds: string[]): Map<string, string | null> {
  if (sessionIds.length === 0) {
    return new Map()
  }

  const sessionRows = db()
    .select({
      id: sessions.id,
      configJson: sessions.configJson,
    })
    .from(sessions)
    .where(inArray(sessions.id, sessionIds))
    .all()
  const modelsBySessionId = new Map(
    sessionRows.map(row => [row.id, readSessionModelPreference(row.configJson)]),
  )

  const bindings = db()
    .select({
      chatSessionId: backendSessionBindings.chatSessionId,
      requestedModelId: backendSessionBindings.requestedModelId,
    })
    .from(backendSessionBindings)
    .where(
      and(
        inArray(backendSessionBindings.chatSessionId, sessionIds),
        isNotNull(backendSessionBindings.backendSessionId),
      ),
    )
    .all()

  for (const binding of bindings) {
    if (modelsBySessionId.get(binding.chatSessionId) === null) {
      modelsBySessionId.set(binding.chatSessionId, binding.requestedModelId ?? null)
    }
  }

  return modelsBySessionId
}

function parseTrustedConfigJson(configJson: string | null | undefined): Record<string, unknown> {
  return parseJsonObjectOrEmpty(configJson)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key)
}

export function readSessionModelPreference(configJson: string | null | undefined): string | null {
  const config = parseTrustedConfigJson(configJson)
  return typeof config.requestedModelId === 'string' && config.requestedModelId.trim().length > 0
    ? config.requestedModelId.trim()
    : null
}

export function readSessionThinkingEffortPreference(
  configJson: string | null | undefined,
): ChatThinkingEffort | null {
  const config = parseTrustedConfigJson(configJson)
  switch (config.requestedThinkingEffort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return config.requestedThinkingEffort
    default:
      return null
  }
}

function writeSessionModelPreferenceConfigJson(
  configJson: string | null | undefined,
  modelId: string | null,
): string {
  const config = parseTrustedConfigJson(configJson)
  if (modelId === null) {
    const { requestedModelId: _requestedModelId, ...rest } = config
    return JSON.stringify(rest)
  }
  return JSON.stringify({
    ...config,
    requestedModelId: modelId,
  })
}

function writeSessionThinkingEffortPreferenceConfigJson(
  configJson: string | null | undefined,
  thinkingEffort: ChatThinkingEffort | null,
): string {
  const config = parseTrustedConfigJson(configJson)
  if (thinkingEffort === null) {
    const { requestedThinkingEffort: _requestedThinkingEffort, ...rest } = config
    return JSON.stringify(rest)
  }
  return JSON.stringify({
    ...config,
    requestedThinkingEffort: thinkingEffort,
  })
}

function projectSessionStatus(input: {
  runStatus?: string | null
}): SessionStatus {
  if (input.runStatus === 'streaming') {
    return 'streaming'
  }
  if (input.runStatus === 'failed') {
    return 'error'
  }
  return 'idle'
}

function listStatusesBySessionIds(sessionIds: string[]): Map<string, SessionStatus> {
  if (sessionIds.length === 0) {
    return new Map()
  }

  const runRows = db()
    .select({
      chatSessionId: backendRuns.chatSessionId,
      status: backendRuns.status,
      startedAt: backendRuns.startedAt,
    })
    .from(backendRuns)
    .where(inArray(backendRuns.chatSessionId, sessionIds))
    .orderBy(desc(backendRuns.startedAt), desc(sql`backend_runs.rowid`))
    .all()

  const statusesBySessionId = new Map<string, SessionStatus>()

  for (const row of runRows) {
    if (statusesBySessionId.has(row.chatSessionId)) {
      continue
    }
    statusesBySessionId.set(
      row.chatSessionId,
      projectSessionStatus({
        runStatus: row.status,
      }),
    )
  }

  for (const sessionId of sessionIds) {
    if (statusesBySessionId.has(sessionId)) {
      continue
    }
    statusesBySessionId.set(
      sessionId,
      projectSessionStatus({}),
    )
  }

  return statusesBySessionId
}

function readSessionStatus(sessionId: string): SessionStatus {
  const latestRun = db()
    .select({
      status: backendRuns.status,
    })
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt), desc(sql`backend_runs.rowid`))
    .get()

  return projectSessionStatus({
    runStatus: latestRun?.status,
  })
}

function toSessionView(
  session: Session,
  modelId: string | null,
  status: SessionStatus,
  latestUserMessageAt: number | null = null,
  latestAssistantMessageAt: number | null = null,
): SessionView {
  const isolation = readSessionIsolation(session)
  return {
    ...session,
    providerTargetId: session.providerTargetId,
    modelId,
    thinkingEffort: readSessionThinkingEffortPreference(session.configJson),
    status,
    latestUserMessageAt,
    latestAssistantMessageAt,
    unread:
      latestAssistantMessageAt !== null
      && (session.lastReadAt === null || latestAssistantMessageAt > session.lastReadAt),
    isIsolated: isolation.isIsolated,
    worktreeId: isolation.worktreeId,
    worktreeBranch: isolation.worktreeBranch,
    worktreePath: isolation.worktreePath,
    worktreeHealth: isolation.worktreeHealth,
    pendingWorktreeId: isolation.pendingWorktreeId,
    isolationBoundaryRequired: isolation.isolationBoundaryRequired,
  }
}

function listRowsByActivity(where: ReturnType<typeof and> | undefined): Array<{
  session: Session
  latestUserMessageAt: number | null
  latestAssistantMessageAt: number | null
}> {
  const latestUserMessages = db()
    .select({
      sessionId: messages.sessionId,
      latestUserMessageAt: max(messages.createdAt).as('latest_user_message_at'),
    })
    .from(messages)
    .where(eq(messages.role, 'user'))
    .groupBy(messages.sessionId)
    .as('latest_user_messages')

  const latestAssistantMessages = db()
    .select({
      sessionId: messages.sessionId,
      latestAssistantMessageAt: max(messages.createdAt).as('latest_assistant_message_at'),
    })
    .from(messages)
    .where(
      and(
        eq(messages.role, 'assistant'),
        inArray(messages.status, ['complete', 'aborted', 'failed']),
      ),
    )
    .groupBy(messages.sessionId)
    .as('latest_assistant_messages')

  const query = db()
    .select({
      session: sessions,
      latestUserMessageAt: latestUserMessages.latestUserMessageAt,
      latestAssistantMessageAt: latestAssistantMessages.latestAssistantMessageAt,
    })
    .from(sessions)
    .leftJoin(latestUserMessages, eq(sessions.id, latestUserMessages.sessionId))
    .leftJoin(latestAssistantMessages, eq(sessions.id, latestAssistantMessages.sessionId))
    .orderBy(
      desc(sql<number>`coalesce(${latestUserMessages.latestUserMessageAt}, ${sessions.createdAt})`),
      desc(sessions.createdAt),
    )

  return (where ? query.where(where).all() : query.all()).map(row => ({
    session: row.session,
    latestUserMessageAt: row.latestUserMessageAt ?? null,
    latestAssistantMessageAt: row.latestAssistantMessageAt ?? null,
  }))
}

function readLatestUserMessageAt(sessionId: string): number | null {
  const row = db()
    .select({
      latestUserMessageAt: max(messages.createdAt),
    })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .get()
  return row?.latestUserMessageAt ?? null
}

function readLatestAssistantMessageAt(sessionId: string): number | null {
  const row = db()
    .select({
      latestAssistantMessageAt: max(messages.createdAt),
    })
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        eq(messages.role, 'assistant'),
        inArray(messages.status, ['complete', 'aborted', 'failed']),
      ),
    )
    .get()
  return row?.latestAssistantMessageAt ?? null
}

function assertTargetCompatibleWithRuntime(input: {
  providerTargetId: string
  runtimeKind: RuntimeKind
}): void {
  if (assertRuntimeOwnedProviderTargetForRuntime(input)) {
    return
  }
  try {
    assertProviderTargetCompatibleWithRuntime(input.providerTargetId, input.runtimeKind)
  }
 catch (error) {
    if (error instanceof AppError && error.code === 'invalid_provider_target') {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'Session provider target is not compatible with the selected runtime',
        details: error.details,
      })
    }
    throw error
  }
}

function assertRuntimeOwnedProviderTargetForRuntime(input: {
  providerTargetId: string
  runtimeKind: RuntimeKind
}): boolean {
  const owningRuntimeKind = readRuntimeOwnedProviderTargetOwner(input.providerTargetId)
  if (!owningRuntimeKind) {
    return false
  }
  if (owningRuntimeKind === input.runtimeKind) {
    return true
  }
  throw new AppError({
    code: 'invalid_session_input',
    status: 400,
    message: 'Runtime-owned provider targets can only be used by their owning runtime',
    details: {
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      owningRuntimeKind,
    },
  })
}

export function list(
  input: { workspaceId?: string, origin?: string, archived?: boolean } = {},
): SessionView[] {
  const predicates = [
    input.workspaceId ? eq(sessions.workspaceId, input.workspaceId) : undefined,
    input.origin ? eq(sessions.origin, input.origin) : undefined,
    input.archived ? isNotNull(sessions.archivedAt) : isNull(sessions.archivedAt),
  ].filter(predicate => predicate !== undefined)
  const where = predicates.length > 0 ? and(...predicates) : undefined
  const rows = listRowsByActivity(where)

  const sessionIds = rows.map(row => row.session.id)
  const modelsBySessionId = listRequestedModelsBySessionIds(sessionIds)
  const statusesBySessionId = listStatusesBySessionIds(sessionIds)
  return rows.map(row =>
    toSessionView(
      row.session,
      modelsBySessionId.get(row.session.id) ?? null,
      statusesBySessionId.get(row.session.id) ?? 'idle',
      row.latestUserMessageAt,
      row.latestAssistantMessageAt,
    ))
}

export function listLinkedToIssue(issueId: string): SessionView[] {
  const rows = listRowsByActivity(and(eq(sessions.linkedIssueId, issueId)))

  const sessionIds = rows.map(row => row.session.id)
  const modelsBySessionId = listRequestedModelsBySessionIds(sessionIds)
  const statusesBySessionId = listStatusesBySessionIds(sessionIds)
  return rows.map(row =>
    toSessionView(
      row.session,
      modelsBySessionId.get(row.session.id) ?? null,
      statusesBySessionId.get(row.session.id) ?? 'idle',
      row.latestUserMessageAt,
      row.latestAssistantMessageAt,
    ))
}

export function setArchived(input: { id: string, archived: boolean }): SessionView | null {
  const record = db().select().from(sessions).where(eq(sessions.id, input.id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessions)
    .set({
      archivedAt: input.archived ? now : null,
      updatedAt: now,
    })
    .where(eq(sessions.id, input.id))
    .run()
  if (input.archived) {
    notifySessionArchived(input.id)
  }
  return get(input.id)
}

export function get(id: string): SessionView | null {
  const row = db().select().from(sessions).where(eq(sessions.id, id)).get() ?? null
  if (!row) {
    return null
  }

  const binding
    = db()
      .select({
        requestedModelId: backendSessionBindings.requestedModelId,
      })
      .from(backendSessionBindings)
      .where(
        and(
          eq(backendSessionBindings.chatSessionId, id),
          isNotNull(backendSessionBindings.backendSessionId),
        ),
      )
      .get() ?? null

  return toSessionView(
    row,
    readSessionModelPreference(row.configJson) ?? binding?.requestedModelId ?? null,
    readSessionStatus(id),
    readLatestUserMessageAt(id),
    readLatestAssistantMessageAt(id),
  )
}

export function markRead(id: string): SessionView | null {
  const record = db().select().from(sessions).where(eq(sessions.id, id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const latestAssistantMessageAt = readLatestAssistantMessageAt(id)
  db()
    .update(sessions)
    .set({
      lastReadAt: latestAssistantMessageAt ?? record.lastReadAt,
      updatedAt: now,
    })
    .where(eq(sessions.id, id))
    .run()

  return get(id)
}

export function markUnread(id: string): SessionView | null {
  const record = db().select().from(sessions).where(eq(sessions.id, id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const latestAssistantMessageAt = readLatestAssistantMessageAt(id)
  db()
    .update(sessions)
    .set({
      lastReadAt: latestAssistantMessageAt !== null ? latestAssistantMessageAt - 1 : null,
      updatedAt: now,
    })
    .where(eq(sessions.id, id))
    .run()

  return get(id)
}

export function create(input: {
  id?: string
  workspaceId?: string | null
  title: string
  origin?: string
  parentSessionId?: string | null
  sideContextSource?: 'provider-native' | 'cradle-context' | null
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort | null
  runtimeKind?: RuntimeKind
  runtimeSettings?: SessionRuntimeSettingsCreatePatch
  agentId?: string | null
  linkedIssueId?: string | null
  worktreeId?: string | null
  configJson?: string
}): SessionView {
  const parsed = SessionCreateInputSchema.parse(input)
  const resolved = resolveSessionCreateInput(parsed)
  const workspaceId = resolveSessionWorkspaceId(parsed)
  const rowInput = z
    .object({
      configJson: z.string().default(() => resolved.configJson),
    })
    .parse(parsed)
  const runtimeSettings = mergeRuntimeSettings(
    readSessionRuntimeSettings(rowInput.configJson),
    normalizeRuntimeSettingsPatch(parsed.runtimeSettings),
  )
  const rawRuntimeSettings
    = parsed.runtimeSettings && typeof parsed.runtimeSettings === 'object'
      ? (parsed.runtimeSettings as Record<string, unknown>)
      : {}
  const updateClaudeAgent = hasOwn(rawRuntimeSettings, 'claudeAgent')
  const runtimeConfigJson = writeSessionRuntimeConfigJson({
    configJson: rowInput.configJson,
    runtimeSettings,
    claudeAgent: updateClaudeAgent
      ? normalizeClaudeAgentConfigPatch(rawRuntimeSettings.claudeAgent)
      : undefined,
    updateClaudeAgent,
  })
  const modelConfigJson
    = parsed.modelId !== undefined
      ? writeSessionModelPreferenceConfigJson(runtimeConfigJson, parsed.modelId)
      : runtimeConfigJson
  const configJson
    = parsed.thinkingEffort !== undefined
      ? writeSessionThinkingEffortPreferenceConfigJson(modelConfigJson, parsed.thinkingEffort)
      : modelConfigJson
  const created = db()
    .insert(sessions)
    .values({
      id: parsed.id,
      parentSessionId: parsed.parentSessionId ?? null,
      sideContextSource: parsed.sideContextSource ?? null,
      workspaceId,
      title: parsed.title,
      origin: parsed.origin,
      providerTargetId: resolved.providerTargetId,
      runtimeKind: resolved.runtimeKind,
      agentId: resolved.agentId,
      configJson,
      linkedIssueId: parsed.linkedIssueId,
      worktreeId: parsed.worktreeId ?? null,
    })
    .returning()
    .get()

  if (parsed.worktreeId) {
    attachSessionToWorktree({
      sessionId: created.id,
      worktreeId: parsed.worktreeId,
    })
  }

  const finalRow = parsed.worktreeId
    ? db().select().from(sessions).where(eq(sessions.id, created.id)).get() ?? created
    : created

  return toSessionView(finalRow, readSessionModelPreference(finalRow.configJson), 'idle')
}

function resolveSessionWorkspaceId(input: { workspaceId?: string | null }): string | null {
  if (input.workspaceId !== undefined) {
    return input.workspaceId
  }
  return Workspace.createAdHocWorkspace().id
}

function resolveSessionCreateInput(input: {
  providerTargetId?: string
  runtimeKind?: RuntimeKind
  agentId?: string | null
}): {
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  agentId: string | null
  configJson: string
} {
  if (input.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, input.agentId)).get()
    if (!agent) {
      throw new AppError({
        code: 'agent_not_found',
        status: 404,
        message: 'Agent not found',
        details: { agentId: input.agentId },
      })
    }

    if (input.runtimeKind && input.runtimeKind !== agent.runtimeKind) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'Session runtime must match the selected agent runtime',
        details: {
          agentId: input.agentId,
          runtimeKind: input.runtimeKind,
          agentRuntimeKind: agent.runtimeKind,
        },
      })
    }

    if (!agent.enabled) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 409,
        message: 'Agent is disabled',
        details: { agentId: input.agentId },
      })
    }

    if (runtimeUsesAgentTerminalLaunch(agent.runtimeKind)) {
      const launch = AgentRuntimeConfigJsonSchema.parse(agent.configJson).cliTui
      if (!launch) {
        throw new AppError({
          code: 'invalid_session_input',
          status: 400,
          message: 'Agent terminal session requires launch configuration on the selected agent',
          details: { agentId: input.agentId },
        })
      }
      return {
        providerTargetId: null,
        runtimeKind: agent.runtimeKind,
        agentId: agent.id,
        configJson: buildSessionRuntimeConfigJson({ cliTuiLaunch: launch }),
      }
    }

    if (!agent.providerTargetId && !runtimeOwnsProviderBinding(agent.runtimeKind)) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'Provider-backed agent requires a provider target',
        details: { agentId: input.agentId },
      })
    }

    if (!agent.providerTargetId) {
      return {
        providerTargetId: null,
        runtimeKind: agent.runtimeKind,
        agentId: agent.id,
        configJson: writeSessionThinkingEffortPreferenceConfigJson(
          writeSessionModelPreferenceConfigJson('{}', agent.modelId),
          agent.thinkingEffort,
        ),
      }
    }

    assertTargetCompatibleWithRuntime({
      providerTargetId: agent.providerTargetId,
      runtimeKind: agent.runtimeKind,
    })
    const providerTarget = resolveProviderTarget(agent.providerTargetId)
    if (!providerTarget.enabled) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 409,
        message: 'Provider target is disabled',
        details: { agentId: input.agentId, providerTargetId: agent.providerTargetId },
      })
    }

    return {
      providerTargetId: agent.providerTargetId,
      runtimeKind: agent.runtimeKind,
      agentId: agent.id,
      configJson: writeSessionThinkingEffortPreferenceConfigJson(
        writeSessionModelPreferenceConfigJson('{}', agent.modelId),
        agent.thinkingEffort,
      ),
    }
  }

  const runtimeKind = input.runtimeKind ?? 'standard'
  if (runtimeUsesAgentTerminalLaunch(runtimeKind)) {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'Agent terminal sessions must be created from an agent',
    })
  }

  if (!input.providerTargetId) {
    if (runtimeOwnsProviderBinding(runtimeKind)) {
      return {
        providerTargetId: null,
        runtimeKind,
        agentId: null,
        configJson: '{}',
      }
    }
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: 'Session requires a provider target or an agent',
    })
  }

  if (assertRuntimeOwnedProviderTargetForRuntime({
    providerTargetId: input.providerTargetId,
    runtimeKind,
  })) {
    return {
      providerTargetId: null,
      runtimeKind,
      agentId: null,
      configJson: '{}',
    }
  }

  resolveProviderTarget(input.providerTargetId)
  assertTargetCompatibleWithRuntime({
    providerTargetId: input.providerTargetId,
    runtimeKind,
  })

  return {
    providerTargetId: input.providerTargetId,
    runtimeKind,
    agentId: null,
    configJson: '{}',
  }
}

export async function update(input: {
  id: string
  title?: string
  pinned?: boolean
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort | null
}): Promise<SessionView | null> {
  const record = db().select().from(sessions).where(eq(sessions.id, input.id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const patch: Partial<typeof sessions.$inferInsert> = { updatedAt: now }

  if (input.pinned !== undefined) {
    patch.pinned = input.pinned ? 1 : 0
  }
  if (input.providerTargetId !== undefined) {
    if (assertRuntimeOwnedProviderTargetForRuntime({
      providerTargetId: input.providerTargetId,
      runtimeKind: record.runtimeKind ?? 'standard',
    })) {
      patch.providerTargetId = null
      if (record.agentId) {
        patch.agentId = null
      }
    }
 else {
      const target = resolveProviderTarget(input.providerTargetId)
      assertProviderTargetCompatibleWithRuntime(input.providerTargetId, record.runtimeKind)
      if (!target.enabled) {
        throw new AppError({
          code: 'invalid_session_input',
          status: 409,
          message: 'Provider target is disabled',
          details: { sessionId: input.id, providerTargetId: input.providerTargetId },
        })
      }
      patch.providerTargetId = input.providerTargetId
      if (record.agentId && input.providerTargetId !== record.providerTargetId) {
        patch.agentId = null
      }
    }
  }
 else if (
    input.modelId !== undefined
    && runtimeOwnsProviderBinding(record.runtimeKind)
    && record.providerTargetId !== null
  ) {
    patch.providerTargetId = null
    if (record.agentId) {
      patch.agentId = null
    }
  }
  let configJson = record.configJson
  if (input.modelId !== undefined) {
    configJson = writeSessionModelPreferenceConfigJson(configJson, input.modelId)
  }
 else if (
    input.providerTargetId !== undefined
    && input.providerTargetId !== record.providerTargetId
  ) {
    configJson = writeSessionModelPreferenceConfigJson(configJson, null)
  }
  if (input.thinkingEffort !== undefined) {
    configJson = writeSessionThinkingEffortPreferenceConfigJson(configJson, input.thinkingEffort)
  }
  if (configJson !== record.configJson) {
    patch.configJson = configJson
  }

  const hasSessionPatch = Object.keys(patch).some(key => key !== 'updatedAt')
  if (input.title !== undefined) {
    await commitSessionEventsWithProjection(
      input.id,
      [
        {
          type: 'TitleChanged',
          payload: {
            sessionId: input.id,
            title: input.title,
            titleSource: 'user',
            updatedAt: now,
          },
        },
      ],
      (tx) => {
        if (hasSessionPatch) {
          tx.update(sessions).set(patch).where(eq(sessions.id, input.id)).run()
        }
      },
    )
  }
 else {
    db().update(sessions).set(patch).where(eq(sessions.id, input.id)).run()
  }
  if (input.providerTargetId !== undefined && input.providerTargetId !== record.providerTargetId) {
    invalidateDurableProviderRuntimeBindingForChatSession(input.id)
  }

  return get(input.id)
}

export async function updateTitle(input: { id: string, title: string }): Promise<void> {
  await update(input)
}

type CleanupHandler = (sessionId: string) => void
type ArchiveHandler = (sessionId: string) => void
const cleanupHandlers: CleanupHandler[] = []
const archiveHandlers: ArchiveHandler[] = []

export function onSessionCleanup(handler: CleanupHandler): void {
  cleanupHandlers.push(handler)
}

export function onSessionArchived(handler: ArchiveHandler): void {
  archiveHandlers.push(handler)
}

function notifySessionArchived(id: string): void {
  for (const handler of archiveHandlers) {
    try {
      handler(id)
    }
 catch {
      // archive hooks must not break the soft-archive flow
    }
  }
}

function cleanupSessionResources(id: string): void {
  for (const handler of cleanupHandlers) {
    try {
      handler(id)
    }
 catch {
      // cleanup handlers must not break the delete flow
    }
  }
}

export function remove(id: string): void {
  cleanupSessionResources(id)
  db().delete(sessions).where(eq(sessions.id, id)).run()
}

type SessionDeleteDb = Pick<ReturnType<typeof db>, 'select' | 'delete'>

function deleteSessionIdsInDb(ids: string[], d: SessionDeleteDb): void {
  for (const id of ids) {
    cleanupSessionResources(id)
  }

  if (ids.length > 0) {
    d.delete(sessions).where(inArray(sessions.id, ids)).run()
  }
}

export function deleteByProviderTargetInDb(providerTargetId: string, d: SessionDeleteDb): void {
  const ids = d
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.providerTargetId, providerTargetId))
    .all()
    .map(row => row.id)

  deleteSessionIdsInDb(ids, d)
}

export function deleteByAgentIdsInDb(agentIds: string[], d: SessionDeleteDb): void {
  if (agentIds.length === 0) {
    return
  }

  const ids = d
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.agentId, agentIds))
    .all()
    .map(row => row.id)

  deleteSessionIdsInDb(ids, d)
}

export function getMessagesWithRunIds(
  sessionId: string,
): Array<Message & { runId: string | null }> {
  const d = db()
  const rows = d
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const assistantIds = rows.filter(row => row.role === 'assistant').map(row => row.id)
  const latestRunByMessageId = new Map<string, string>()

  if (assistantIds.length > 0) {
    const runs = d
      .select({
        id: backendRuns.id,
        messageId: backendRuns.messageId,
        startedAt: backendRuns.startedAt,
      })
      .from(backendRuns)
      .where(inArray(backendRuns.messageId, assistantIds))
      .orderBy(desc(backendRuns.startedAt))
      .all()

    for (const run of runs) {
      if (!run.messageId || latestRunByMessageId.has(run.messageId)) {
        continue
      }
      latestRunByMessageId.set(run.messageId, run.id)
    }
  }

  return rows.map(row => ({
    ...row,
    runId: row.role === 'assistant' ? (latestRunByMessageId.get(row.id) ?? null) : null,
  }))
}

export function getRunMessageContents(runIds: string[]): { runId: string, content: string }[] {
  if (runIds.length === 0) {
    return []
  }

  const rows = db()
    .select({
      runId: backendRuns.id,
      content: messages.content,
    })
    .from(backendRuns)
    .innerJoin(messages, eq(backendRuns.messageId, messages.id))
    .where(inArray(backendRuns.id, runIds))
    .all()

  return rows.map(row => ({ runId: row.runId, content: row.content }))
}

export function exportMarkdown(sessionId: string): string {
  const d = db()
  const session = d.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return ''
  }

  const msgs = d
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const binding = d
    .select()
    .from(backendSessionBindings)
    .where(
      and(
        eq(backendSessionBindings.chatSessionId, sessionId),
        isNotNull(backendSessionBindings.backendSessionId),
      ),
    )
    .get()

  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(
    `> Model: ${readSessionModelPreference(session.configJson) ?? binding?.requestedModelId ?? 'unknown'} | Created: ${new Date(session.createdAt * 1000).toLocaleString()}`,
  )
  lines.push('')

  for (const msg of msgs) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${role}`)
    lines.push('')
    lines.push(msg.content)
    lines.push('')
  }

  return lines.join('\n')
}
