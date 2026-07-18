import type { BackendSessionBinding, Session } from '@cradle/db'
import { agents, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { parseJsonObject } from '../../helpers/json-record'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { readProviderStateSnapshot } from '../chat-runtime-providers/kit/state-snapshot'
import * as ModelRegistry from '../model-registry/service'
import {
  readRuntimeOwnedProviderTargetOwner,
  readRuntimeProviderBinding,
  runtimeOwnsProviderTarget,
  runtimeSkipsProviderTarget,
  runtimeSupportsProviderKind,
} from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import {
  persistProviderRuntimeResolution,
  resolveExistingProviderRuntimeSession,
  resolveProviderRuntimeSession,
} from '../provider-runtime/service'
import { getProviderTarget, resolveProviderTargetForRuntime } from '../provider-targets/service'
import { getRemoteSessionLink } from '../session/remote-projection'
import * as SessionService from '../session/service'
import * as Workspace from '../workspace/service'
import { assertIsolationExecutionReady, resolveSessionExecutionRoot } from '../worktree/service'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import { resolveSessionSystemPrompt } from './harness/turn-context'
import type { ActiveRun } from './run-registry'
import { runRegistry } from './run-registry'
import type {
  ChatRuntime,
  ChatThinkingEffort,
  RuntimeProviderTargetProfile,
  RuntimeSession,
} from './runtime-provider-types'

const runtimeSessionLogger = createChildLogger({ module: 'chat-runtime.runtime-session' })

export interface SessionRunContext {
  session: Session
  workspacePath: string
  profile: RuntimeProviderTargetProfile | null
  providerTarget: { id: string, kind: 'manual' | 'external' } | null
}

export type ProviderBoundSessionRunContext = SessionRunContext & {
  profile: RuntimeProviderTargetProfile
  providerTarget: { id: string, kind: 'manual' | 'external' }
}

export function assertProviderBoundRunContext(
  context: SessionRunContext,
  operation: string,
): ProviderBoundSessionRunContext {
  if (context.profile && context.providerTarget) {
    return context as ProviderBoundSessionRunContext
  }
  throw new AppError({
    code: 'chat_provider_target_required',
    status: 409,
    message: `${operation} requires a provider target bound runtime`,
    details: {
      sessionId: context.session.id,
      runtimeKind: context.session.runtimeKind ?? 'standard',
    },
  })
}

export function getSessionRunContext(
  sessionId: string,
  input: { providerTargetId?: string } = {},
): SessionRunContext | null {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return null
  }
  const remoteLink = getRemoteSessionLink(sessionId)
  if (remoteLink) {
    return null
  }
  assertIsolationExecutionReady(session)
  const providerTargetId = input.providerTargetId ?? session.providerTargetId
  const providerTarget = providerTargetId ? { id: providerTargetId } : null
  const execution = resolveSessionExecutionRoot(session)
  const workspacePath = session.workspaceId
    ? (execution.rootPath || Workspace.getLocalWorkspacePath(session.workspaceId))
    : null
  if (session.workspaceId && !workspacePath) {
    return null
  }

  const runtimeKind = session.runtimeKind ?? 'standard'
  const runtimeOwnedProviderTargetOwner = readRuntimeOwnedProviderTargetOwner(providerTargetId)
  if (runtimeOwnedProviderTargetOwner) {
    if (runtimeOwnedProviderTargetOwner !== runtimeKind) {
      return null
    }
    const runtime = getRuntimeRegistry().get(runtimeKind)
    if (runtime?.metadata.providerBinding !== 'runtime-owned') {
      return null
    }
    return {
      session,
      workspacePath: workspacePath ?? '',
      profile: null,
      providerTarget: null,
    }
  }
  const runtime = getRuntimeRegistry().get(runtimeKind)
  if (providerTarget && runtime?.metadata.providerBinding === 'runtime-owned') {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'Runtime only supports runtime-owned provider targets',
      details: {
        providerTargetId,
        runtimeKind,
      },
    })
  }

  const agent = session.agentId
    ? db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    : null
  const agentConfig = agent ? parseJsonObject(agent.configJson) : {}
  const sessionConfig = parseJsonObject(session.configJson)

  if (!providerTarget) {
    if (runtime?.metadata.providerBinding === 'runtime-owned') {
      return {
        session,
        workspacePath: workspacePath ?? '',
        profile: null,
        providerTarget: null,
      }
    }
    if (runtime?.metadata.providerBinding === 'none') {
      const profile = buildRuntimeConfigOnlyProfile({ agentConfig, sessionConfig })
      if (!profile) {
        return null
      }
      return {
        session,
        workspacePath: workspacePath ?? '',
        profile,
        providerTarget: null,
      }
    }
    return null
  }

  const resolvedTarget = resolveProviderTargetForRuntime(providerTarget, runtimeKind)
  const profileConfig = parseJsonObject(resolvedTarget.configJson)
  const targetModelRegistryConfig = {
    modelRegistryMappings: ModelRegistry.listMappingEntries(),
  }
  const effectiveProfile = {
    id: resolvedTarget.target.id,
    name: resolvedTarget.label,
    providerKind: resolvedTarget.providerKind,
    enabled: resolvedTarget.enabled,
    configJson: JSON.stringify({
      ...profileConfig,
      ...targetModelRegistryConfig,
      ...agentConfig,
      ...sessionConfig,
    }),
    credentialRef: resolvedTarget.credentialRef,
    customModels: resolvedTarget.customModelsJson,
    iconSlug: resolvedTarget.iconSlug,
    providerTargetKind: resolvedTarget.target.kind,
    providerTargetId: resolvedTarget.target.id,
  }

  return {
    session,
    workspacePath: workspacePath ?? '',
    profile: effectiveProfile,
    providerTarget: resolvedTarget.target,
  }
}

/**
 * Synthesize the run profile for a runtime whose provider binding is `'none'` (ACP).
 * The runtime reads its launch config from the merged agent/session config via `acpAgentId`;
 * the synthetic id `acp:<acpAgentId>` keys one runtime connection per installed ACP agent.
 * Returns null when the merged config carries no `acpAgentId` (unsupported legacy session).
 */
function buildRuntimeConfigOnlyProfile(input: {
  agentConfig: Record<string, unknown>
  sessionConfig: Record<string, unknown>
}): RuntimeProviderTargetProfile | null {
  const mergedConfig = { ...input.agentConfig, ...input.sessionConfig }
  const acpAgentId = mergedConfig.acpAgentId
  if (typeof acpAgentId !== 'string' || acpAgentId.length === 0) {
    return null
  }
  const profileId = `acp:${acpAgentId}`
  return {
    id: profileId,
    name: acpAgentId,
    enabled: true,
    configJson: JSON.stringify(mergedConfig),
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: profileId,
  }
}

export function isProviderTargetAvailable(providerTargetId: string | null | undefined): boolean {
  if (!providerTargetId) {
    return false
  }
  return getProviderTarget(providerTargetId)?.enabled === true
}

export function attachBinding(input: {
  sessionId: string
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}): BackendSessionBinding | undefined {
  return persistProviderRuntimeResolution({
    chatSessionId: input.sessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    runtimeSession: input.runtimeSession,
    requestedModelId: input.requestedModelId,
    durable: true,
  })
}

export async function resolveExistingRuntimeSessionForContext(input: {
  sessionId: string
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  modelId?: string | null
}): Promise<{
  runtimeSession: RuntimeSession
  requestedModelId: string | null
} | null> {
  const resolution = await resolveExistingProviderRuntimeSession({
    chatSessionId: input.sessionId,
    providerTargetId: input.context.providerTarget?.id ?? null,
    runtimeKind: input.runtimeKind,
    runtime: input.runtime,
    profile: input.context.profile,
    workspacePath: input.context.workspacePath,
    agentId: input.context.session.agentId,
    modelId: input.modelId,
  })
  return resolution
    ? {
        runtimeSession: resolution.runtimeSession,
        requestedModelId: resolution.requestedModelId,
      }
    : null
}

export async function resolveRuntimeSessionForContext(input: {
  sessionId: string
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  modelId?: string | null
  requestedProviderTargetId?: string
}): Promise<{
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}> {
  const resolution = await resolveProviderRuntimeSession({
    chatSessionId: input.sessionId,
    providerTargetId: input.context.providerTarget?.id ?? null,
    runtimeKind: input.runtimeKind,
    runtime: input.runtime,
    profile: input.context.profile,
    workspacePath: input.context.workspacePath,
    agentId: input.context.session.agentId,
    modelId: input.modelId,
  })
  try {
    validateResolvedRuntimeSessionContext({
      sessionId: input.sessionId,
      originalContext: input.context,
      requestedProviderTargetId: input.requestedProviderTargetId,
      runtimeKind: input.runtimeKind,
    })
  }
 catch (error) {
    try {
      await input.runtime.cancelTurn({
        runtimeSession: resolution.runtimeSession,
        profile: input.context.profile,
      })
    }
 catch (cancelError) {
      runtimeSessionLogger.warn('runtime session cancellation failed after context invalidation', {
        error: cancelError,
        sessionId: input.sessionId,
        providerTargetId: input.context.providerTarget?.id ?? null,
      })
    }
    throw error
  }
  return {
    runtimeSession: resolution.runtimeSession,
    requestedModelId: resolution.requestedModelId,
  }
}

function validateResolvedRuntimeSessionContext(input: {
  sessionId: string
  originalContext: SessionRunContext
  requestedProviderTargetId?: string
  runtimeKind: RuntimeKind
}): void {
  const latestSession = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  if (!latestSession) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId },
    })
  }
  const latestContext = getSessionRunContext(input.sessionId, {
    providerTargetId: input.requestedProviderTargetId,
  })
  if (!latestContext) {
    throw new AppError({
      code: 'chat_provider_target_not_available',
      status: 409,
      message: 'Provider target is no longer available',
      details: {
        sessionId: input.sessionId,
        providerTargetId:
          input.requestedProviderTargetId ?? input.originalContext.providerTarget?.id ?? null,
      },
    })
  }
  assertRuntimeCompatibleTarget(latestContext, input.requestedProviderTargetId)
  if (latestContext.profile && !latestContext.profile.enabled) {
    throw new AppError({
      code: 'chat_provider_target_not_available',
      status: 409,
      message: 'Provider target is disabled',
      details: {
        providerTargetId: latestContext.providerTarget?.id ?? null,
      },
    })
  }
  if (
    input.requestedProviderTargetId === undefined
    && latestContext.session.providerTargetId !== (input.originalContext.providerTarget?.id ?? null)
  ) {
    throw new AppError({
      code: 'chat_provider_target_changed',
      status: 409,
      message: 'Chat session provider target changed before the run started',
      details: {
        sessionId: input.sessionId,
        previousProviderTargetId: input.originalContext.providerTarget?.id ?? null,
        providerTargetId: latestContext.session.providerTargetId,
      },
    })
  }
}

export function readSessionRequestedModelId(input: {
  session: Session
  requestedProviderTargetId?: string
}): string | undefined {
  if (
    input.requestedProviderTargetId
    && runtimeOwnsProviderTarget(input.session.runtimeKind ?? 'standard', input.requestedProviderTargetId)
    && input.session.providerTargetId === null
  ) {
    return SessionService.readSessionModelPreference(input.session.configJson) ?? undefined
  }
  if (
    input.requestedProviderTargetId
    && input.requestedProviderTargetId !== input.session.providerTargetId
  ) {
    return undefined
  }
  return SessionService.readSessionModelPreference(input.session.configJson) ?? undefined
}

export function readSessionRequestedThinkingEffort(input: {
  session: Session
  requestedProviderTargetId?: string
}): ChatThinkingEffort | undefined {
  if (
    input.requestedProviderTargetId
    && runtimeOwnsProviderTarget(input.session.runtimeKind ?? 'standard', input.requestedProviderTargetId)
    && input.session.providerTargetId === null
  ) {
    return SessionService.readSessionThinkingEffortPreference(input.session.configJson) ?? undefined
  }
  if (
    input.requestedProviderTargetId
    && input.requestedProviderTargetId !== input.session.providerTargetId
  ) {
    return undefined
  }
  return SessionService.readSessionThinkingEffortPreference(input.session.configJson) ?? undefined
}

export function assertRunnableSession(sessionId: string): SessionRunContext {
  const remoteLink = getRemoteSessionLink(sessionId)
  if (remoteLink) {
    throw new AppError({
      code: 'chat_session_executes_on_remote_host',
      status: 409,
      message: 'This session executes on a remote Cradle Server; use the remote-host upstream APIs.',
      details: {
        sessionId,
        hostId: remoteLink.hostId,
        remoteSessionId: remoteLink.remoteSessionId,
      },
    })
  }
  const context = getSessionRunContext(sessionId)
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }
  return context
}

export function assertStoredSession(sessionId: string): Session {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }
  return session
}

export function assertRuntimeCompatibleTarget(
  context: SessionRunContext,
  requestedProviderTargetId?: string,
): SessionRunContext {
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  if (!context.profile) {
    if (runtimeSkipsProviderTarget(runtimeKind)) {
      return context
    }
    throw new AppError({
      code: 'chat_provider_target_required',
      status: 400,
      message: 'Chat runtime requires a provider target',
      details: {
        runtimeKind,
        providerTargetId: requestedProviderTargetId ?? null,
      },
    })
  }
  if (readRuntimeProviderBinding(runtimeKind) === 'none') {
    // Binding-'none' profiles are synthesized from runtime config or wrap legacy launch
    // config; there is no provider kind to check compatibility against.
    return context
  }
  if (context.profile.providerKind && runtimeSupportsProviderKind(runtimeKind, context.profile.providerKind)) {
    return context
  }

  throw new AppError({
    code: 'chat_profile_runtime_incompatible',
    status: 400,
    message: 'Agent profile is not compatible with the chat runtime',
    details: {
      runtimeKind,
      providerKind: context.profile.providerKind,
      providerTargetId: requestedProviderTargetId ?? context.providerTarget?.id ?? null,
    },
  })
}

// ── runtime session resolution (used by the turn pump + read-only capability probes) ──

export interface ResolvedRuntimeSessionContext {
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  modelId: string | undefined
}

/**
 * Resolve a chat session to a runnable runtime session. Reuses the active
 * run's runtime handle when one is in flight for the same runtime kind;
 * otherwise resolves an existing durable runtime session. Throws if the
 * session has no resolvable runtime context or no started provider session.
 */
export async function resolveRuntimeSessionContext(
  sessionId: string,
): Promise<ResolvedRuntimeSessionContext> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    assertStoredSession(sessionId)
    throw new AppError({
      code: 'chat_session_not_runnable',
      status: 404,
      message: 'Chat session runtime context was not found',
      details: { sessionId },
    })
  }

  const registry = getRuntimeRegistry()
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = registry.get(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`,
    })
  }

  const activeRunId = runRegistry.getActiveRunIdForSession(sessionId)
  const activeRun: ActiveRun | undefined = activeRunId
    ? runRegistry.getActiveRun(activeRunId)
    : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    return {
      context,
      runtimeKind,
      runtime: activeRun.runtime,
      runtimeSession: activeRun.runtimeSession,
      modelId:
        readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models.currentModelId ?? undefined,
    }
  }

  const resolved = await resolveExistingRuntimeSessionForContext({
    sessionId,
    context,
    runtimeKind,
    runtime,
  })
  if (!resolved) {
    throw new AppError({
      code: 'chat_runtime_session_not_started',
      status: 404,
      message: 'Chat session has no provider runtime session',
      details: { sessionId, runtimeKind },
    })
  }

  const modelId
    = resolved.requestedModelId
      ?? readProviderStateSnapshot(resolved.runtimeSession.providerStateSnapshot).models.currentModelId
      ?? undefined

  return {
    context,
    runtimeKind,
    runtime,
    runtimeSession: resolved.runtimeSession,
    modelId,
  }
}

/**
 * Flatten a resolved runtime session context into the provider input shape
 * shared by streamTurn, capability probes, title generation, etc.
 */
export function buildRuntimeProviderInput(resolved: ResolvedRuntimeSessionContext) {
  return {
    runtimeSession: resolved.runtimeSession,
    profile: resolved.context.profile,
    workspaceId: resolved.context.session.workspaceId,
    workspacePath: resolved.context.workspacePath,
    agentId: resolved.context.session.agentId,
    modelId: resolved.modelId,
    systemPrompt: resolveSessionSystemPrompt(resolved.context.session),
  }
}
