import { AppError } from '../../errors/app-error'
import { readProviderStateSnapshot } from '../chat-runtime-providers/kit/state-snapshot'
import type { RuntimeKind } from '../provider-contracts/types'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import { resolveSessionSystemPrompt } from './context/turn-context'
import { appendPendingRuntimeUserInputSlotStates } from './pending-user-input'
import { runRegistry } from './run-registry'
import type {
  BackgroundTerminalListResult,
  BackgroundTerminalTerminateResult,
  ListBackgroundTerminalsInput,
  ProviderThreadDeleteResult,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadResult,
  ProviderThreadSourceKind,
  ProviderThreadTurnsResult,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeUiSlotState,
  TerminateBackgroundTerminalInput,
} from './runtime-provider-types'
import {
  createEmptyRuntimePresentation,
} from './runtime-provider-types'
import {
  assertStoredSession,
  buildRuntimeProviderInput,
  getSessionRunContext,
  resolveExistingRuntimeSessionForContext,
  resolveRuntimeSessionContext,
} from './runtime-session-context'

export interface ChatSessionContextUsageDto {
  sessionId: string
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  usage: RuntimeContextUsage | null
}

export async function getCapabilities(
  sessionId: string,
): Promise<RuntimePresentationCapabilities> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    const session = assertStoredSession(sessionId)
    return createEmptyRuntimePresentation(session.runtimeKind ?? 'standard')
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

  if (!runtime.getPresentation) {
    return createEmptyRuntimePresentation(runtimeKind)
  }

  const activeRunId = runRegistry.getActiveRunIdForSession(sessionId)
  const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    return runtime.getPresentation({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
      agentId: context.session.agentId,
      modelId:
        activeRun.modelId
        ?? readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models.currentModelId
        ?? undefined,
      systemPrompt: resolveSessionSystemPrompt(context.session),
    })
  }

  const resolved = await resolveExistingRuntimeSessionForContext({
    sessionId,
    context,
    runtimeKind,
    runtime,
  })
  if (!resolved) {
    return createEmptyRuntimePresentation(runtimeKind)
  }

  return runtime.getPresentation({
    runtimeSession: resolved.runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId:
      resolved.requestedModelId
      ?? readProviderStateSnapshot(resolved.runtimeSession.providerStateSnapshot).models.currentModelId
      ?? undefined,
    systemPrompt: resolveSessionSystemPrompt(context.session),
  })
}

export async function getUiSlotStates(
  sessionId: string,
): Promise<{ runtimeKind: RuntimeKind, states: RuntimeUiSlotState[] }> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    const session = assertStoredSession(sessionId)
    return {
      runtimeKind: session.runtimeKind ?? 'standard',
      states: [],
    }
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
  const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    const providerStates
      = runtime.capabilities.supportsUiSlotStates && runtime.getUiSlotStates
        ? await runtime.getUiSlotStates({
            runtimeSession: activeRun.runtimeSession,
            profile: context.profile,
            workspaceId: context.session.workspaceId,
            workspacePath: context.workspacePath,
            agentId: context.session.agentId,
            modelId:
              readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models.currentModelId ?? undefined,
            systemPrompt: resolveSessionSystemPrompt(context.session),
          })
        : []
    return {
      runtimeKind,
      states: appendPendingRuntimeUserInputSlotStates(providerStates, {
        sessionId,
        runtimeKind,
        threadId: activeRun.runtimeSession.providerSessionId,
      }),
    }
  }

  if (!runtime.capabilities.supportsUiSlotStates || !runtime.getUiSlotStates) {
    return {
      runtimeKind,
      states: appendPendingRuntimeUserInputSlotStates([], {
        sessionId,
        runtimeKind,
        threadId: null,
      }),
    }
  }

  const resolved = await resolveExistingRuntimeSessionForContext({
    sessionId,
    context,
    runtimeKind,
    runtime,
  })
  if (!resolved) {
    return {
      runtimeKind,
      states: appendPendingRuntimeUserInputSlotStates([], {
        sessionId,
        runtimeKind,
        threadId: null,
      }),
    }
  }

  const states = await runtime.getUiSlotStates({
    runtimeSession: resolved.runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId:
      resolved.requestedModelId
      ?? readProviderStateSnapshot(resolved.runtimeSession.providerStateSnapshot).models.currentModelId
      ?? undefined,
    systemPrompt: resolveSessionSystemPrompt(context.session),
  })
  return {
    runtimeKind,
    states: appendPendingRuntimeUserInputSlotStates(states, {
      sessionId,
      runtimeKind,
      threadId: resolved.runtimeSession.providerSessionId,
    }),
  }
}

export async function listProviderThreads(
  sessionId: string,
  query: {
    cursor?: string | null
    limit?: number | null
    sortKey?: 'created_at' | 'updated_at' | null
    sortDirection?: 'asc' | 'desc' | null
    sourceKinds?: ProviderThreadSourceKind[] | null
    archived?: boolean | null
    searchTerm?: string | null
  } = {},
): Promise<ProviderThreadListResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.listProviderThreads) {
    return {
      runtimeKind: resolved.runtimeKind,
      providerSessionId: resolved.runtimeSession.providerSessionId,
      threads: [],
      nextCursor: null,
      backwardsCursor: null,
    }
  }
  return await resolved.runtime.listProviderThreads({
    ...buildRuntimeProviderInput(resolved),
    ...query,
  } satisfies ProviderThreadListInput)
}

export async function readProviderThread(
  sessionId: string,
  threadId: string,
): Promise<ProviderThreadReadResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.readProviderThread) {
    throw new AppError({
      code: 'chat_provider_threads_not_supported',
      status: 501,
      message: 'Runtime does not support provider thread reads',
      details: { sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  return await resolved.runtime.readProviderThread({
    ...buildRuntimeProviderInput(resolved),
    threadId,
    includeTurns: false,
  })
}

export async function deleteProviderThread(
  sessionId: string,
  threadId: string,
): Promise<ProviderThreadDeleteResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.deleteProviderThread) {
    throw new AppError({
      code: 'chat_provider_threads_not_supported',
      status: 501,
      message: 'Runtime does not support provider thread deletes',
      details: { sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  return await resolved.runtime.deleteProviderThread({
    ...buildRuntimeProviderInput(resolved),
    threadId,
  })
}

export async function listProviderThreadTurns(
  sessionId: string,
  threadId: string,
  query: {
    cursor?: string | null
    limit?: number | null
    sortDirection?: 'asc' | 'desc' | null
  } = {},
): Promise<ProviderThreadTurnsResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.listProviderThreadTurns) {
    throw new AppError({
      code: 'chat_provider_threads_not_supported',
      status: 501,
      message: 'Runtime does not support provider thread turns',
      details: { sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  return await resolved.runtime.listProviderThreadTurns({
    ...buildRuntimeProviderInput(resolved),
    threadId,
    ...query,
  })
}

export async function listBackgroundTerminals(
  sessionId: string,
  query: {
    cursor?: string | null
    limit?: number | null
  } = {},
): Promise<BackgroundTerminalListResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.listBackgroundTerminals) {
    throw new AppError({
      code: 'chat_background_terminals_not_supported',
      status: 501,
      message: 'Runtime does not support background terminal listing',
      details: { sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  return await resolved.runtime.listBackgroundTerminals({
    ...buildRuntimeProviderInput(resolved),
    ...query,
  } satisfies ListBackgroundTerminalsInput)
}

export async function terminateBackgroundTerminal(
  sessionId: string,
  processId: string,
): Promise<BackgroundTerminalTerminateResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.terminateBackgroundTerminal) {
    throw new AppError({
      code: 'chat_background_terminals_not_supported',
      status: 501,
      message: 'Runtime does not support background terminal termination',
      details: { sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  return await resolved.runtime.terminateBackgroundTerminal({
    ...buildRuntimeProviderInput(resolved),
    processId,
  } satisfies TerminateBackgroundTerminalInput)
}

export async function readContextUsage(sessionId: string): Promise<ChatSessionContextUsageDto> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.getContextUsage) {
    return {
      sessionId,
      runtimeKind: resolved.runtimeKind,
      providerSessionId: resolved.runtimeSession.providerSessionId,
      usage: null,
    }
  }

  return {
    sessionId,
    runtimeKind: resolved.runtimeKind,
    providerSessionId: resolved.runtimeSession.providerSessionId,
    usage: await resolved.runtime.getContextUsage(buildRuntimeProviderInput(resolved)),
  }
}
