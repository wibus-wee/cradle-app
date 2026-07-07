import { randomUUID } from 'node:crypto'

import type { BackendSessionBinding, Session } from '@cradle/db'
import type { UIMessage } from 'ai'

import { AppError } from '../../../errors/app-error'
import { createChildLogger } from '../../../logging/logger'
import { readProviderStateSnapshot } from '../../chat-runtime-providers/kit/state-snapshot'
import type { RuntimeKind } from '../../provider-contracts/types'
import { ProviderRuntimeLease } from '../../provider-runtime/host-manager'
import {
  registerSideConversation,
  reserveSideConversationHostLease,
} from '../../provider-runtime/side-conversation-registry'
import type {
  ChatRuntime,
  RuntimeProviderTargetProfile,
  RuntimeSession,
} from '../runtime-provider-types'

const sideChatLogger = createChildLogger({ module: 'chat-runtime.side-chat' })

export interface CreateSideChatInput {
  parentSessionId: string
  providerTargetId?: string
  modelId?: string | null
}

export interface SideChatSessionDto {
  sideConversationId: string
  parentSessionId: string
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  providerSessionId: string | null
  title: string
}

export interface SideChatRunContext {
  session: Session
  workspacePath: string
  profile: RuntimeProviderTargetProfile
  providerTarget: { id: string, kind: 'manual' | 'external' }
}

export interface ActiveParentRuntimeSession {
  providerTargetId: string
  runtimeSession: RuntimeSession
  modelId: string | null
}

export interface CreateSideChatDeps {
  getParentSession: (parentSessionId: string) => Session
  getParentContext: (parentSessionId: string, providerTargetId?: string) => SideChatRunContext
  getRuntime: (runtimeKind: RuntimeKind) => ChatRuntime | undefined
  getActiveParentRuntimeSession: (parentSessionId: string) => ActiveParentRuntimeSession | undefined
  readReusableBinding: (input: {
    parentSessionId: string
    providerTargetId: string
    runtimeKind: RuntimeKind
  }) => BackendSessionBinding | undefined
  readTranscript: (parentSessionId: string) => Promise<UIMessage[]>
  resolveSystemPrompt: (session: Session) => string | undefined
  normalizeTitle: (title: string) => string | null
}

export async function createSideChat(
  input: CreateSideChatInput,
  deps: CreateSideChatDeps,
): Promise<SideChatSessionDto> {
  const parentSession = deps.getParentSession(input.parentSessionId)
  const context = deps.getParentContext(input.parentSessionId, input.providerTargetId)
  if (!context.profile.enabled) {
    throw new AppError({
      code: 'chat_provider_target_not_available',
      status: 409,
      message: 'Provider target is disabled',
      details: {
        providerTargetId: context.providerTarget.id,
      },
    })
  }

  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = deps.getRuntime(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`,
    })
  }

  const parentRuntime = await resolveParentRuntimeSessionForSide({
    parentSessionId: input.parentSessionId,
    context,
    runtimeKind,
    runtime,
    modelId: input.modelId,
    deps,
  })

  const sideConversationId = randomUUID()
  const childAgentId
    = context.session.agentId && context.session.providerTargetId === context.providerTarget.id
      ? context.session.agentId
      : null
  const transcript = await deps.readTranscript(input.parentSessionId)
  const requestedModelId = parentRuntime.requestedModelId ?? input.modelId ?? undefined
  let sideRegistered = false
  let sideHostLease: ReturnType<typeof reserveSideConversationHostLease> | null = null
  try {
    const childRuntimeSession
      = runtime.forkRuntimeSession && parentRuntime.runtimeSession?.providerSessionId
        ? await runtime.forkRuntimeSession({
            sourceRuntimeSession: parentRuntime.runtimeSession,
            childChatSessionId: sideConversationId,
            profile: context.profile,
            workspaceId: context.session.workspaceId,
            workspacePath: context.workspacePath,
            agentId: childAgentId,
            modelId: requestedModelId,
            systemPrompt: deps.resolveSystemPrompt(context.session),
          })
        : await runtime.startChatSession({
            chatSessionId: sideConversationId,
            profile: context.profile,
            workspacePath: context.workspacePath,
            agentId: childAgentId,
            modelId: requestedModelId,
          })

    sideHostLease = childRuntimeSession.providerRuntimeLease instanceof ProviderRuntimeLease
      ? {
          sideConversationId,
          providerTargetId: context.providerTarget.id,
          runtimeKind: childRuntimeSession.runtimeKind,
          pinned: true,
          lease: childRuntimeSession.providerRuntimeLease,
        }
      : reserveSideConversationHostLease({
          sideConversationId,
          runtimeKind: childRuntimeSession.runtimeKind,
          providerTargetId: context.providerTarget.id,
        })

    registerSideConversation({
      sideConversationId,
      parentSessionId: input.parentSessionId,
      runtimeKind: childRuntimeSession.runtimeKind,
      providerTargetId: context.providerTarget.id,
      runtimeSession: childRuntimeSession,
      requestedModelId:
        parentRuntime.requestedModelId
        ?? input.modelId
        ?? readProviderStateSnapshot(childRuntimeSession.providerStateSnapshot).models.currentModelId,
      history: transcript,
      hostLease: sideHostLease,
    })
    sideRegistered = true

    return {
      sideConversationId,
      parentSessionId: input.parentSessionId,
      runtimeKind: childRuntimeSession.runtimeKind,
      providerTargetId: context.providerTarget.id,
      providerSessionId: childRuntimeSession.providerSessionId,
      title: createSideSessionTitle(parentSession.title, deps),
    }
  }
 finally {
    if (!sideRegistered) {
      sideHostLease?.lease.release()
    }
  }
}

async function resolveParentRuntimeSessionForSide(input: {
  parentSessionId: string
  context: SideChatRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  modelId?: string | null
  deps: CreateSideChatDeps
}): Promise<{
  runtimeSession: RuntimeSession | null
  requestedModelId: string | null
  reusableBinding: BackendSessionBinding | undefined
}> {
  const activeRun = input.deps.getActiveParentRuntimeSession(input.parentSessionId)
  if (
    activeRun
    && activeRun.providerTargetId === input.context.providerTarget.id
    && activeRun.runtimeSession.runtimeKind === input.runtimeKind
    && activeRun.runtimeSession.providerSessionId
  ) {
    return {
      runtimeSession: activeRun.runtimeSession,
      reusableBinding: undefined,
      requestedModelId:
        input.modelId
        ?? activeRun.modelId
        ?? readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models.currentModelId
        ?? null,
    }
  }

  const reusableBinding = input.deps.readReusableBinding({
    parentSessionId: input.parentSessionId,
    providerTargetId: input.context.providerTarget.id,
    runtimeKind: input.runtimeKind,
  })

  if (!reusableBinding) {
    return {
      runtimeSession: null,
      reusableBinding: undefined,
      requestedModelId: input.modelId ?? null,
    }
  }

  const requestedModelId
    = input.modelId
      ?? reusableBinding.requestedModelId
      ?? readProviderStateSnapshot(reusableBinding.backendStateSnapshot).models.currentModelId
      ?? null

  let runtimeSession: RuntimeSession
  try {
    runtimeSession = await input.runtime.resumeChatSession({
      runtimeSession: {
        id: input.parentSessionId,
        chatSessionId: input.parentSessionId,
        providerTargetId: input.context.providerTarget.id,
        runtimeKind: input.runtimeKind,
        providerSessionId: reusableBinding.backendSessionId,
        providerStateSnapshot: reusableBinding.backendStateSnapshot,
      },
      profile: input.context.profile,
      workspacePath: input.context.workspacePath,
      agentId: input.context.session.agentId,
      modelId: requestedModelId ?? undefined,
    })
  }
 catch (error) {
    sideChatLogger.warn(
      'parent runtime resume failed for side chat; falling back to Cradle side context',
      {
        error,
        parentSessionId: input.parentSessionId,
        runtimeKind: input.runtimeKind,
      },
    )
    return {
      runtimeSession: null,
      reusableBinding,
      requestedModelId,
    }
  }

  return {
    runtimeSession,
    reusableBinding,
    requestedModelId:
      requestedModelId
      ?? readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId,
  }
}

function createSideSessionTitle(parentTitle: string, deps: CreateSideChatDeps): string {
  const title = deps.normalizeTitle(parentTitle) ?? 'Untitled'
  return `Side from ${title}`
}
