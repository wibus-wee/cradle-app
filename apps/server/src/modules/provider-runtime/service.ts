import type { BackendSessionBinding } from '@cradle/db'

import type {
  ChatRuntime,
  RuntimeProviderTargetProfile,
  RuntimeSession,
} from '../chat-runtime/runtime-provider-types'
import { readProviderStateSnapshot } from '../chat-runtime-providers/provider-state-snapshot'
import type { RuntimeKind } from '../provider-contracts/types'
import type { ProviderRuntimeBindingDirectoryWriter } from './directory'
import {
  clearProviderTargetFromProviderRuntimeBindings,
  deleteProviderRuntimeBinding,
  isResumableProviderRuntimeBinding,
  listProviderRuntimeBindingsByProviderSession,
  readProviderRuntimeBinding,
  readReusableProviderRuntimeBinding,
  writeProviderRuntimeBinding,
} from './directory'
import type { SideConversationRecord } from './side-conversation-registry'
import {
  readSideConversation,
  refreshSideConversation,
  releaseSideConversationsByProviderTargetId,
} from './side-conversation-registry'

export type ProviderRuntimeSessionSource = 'live-side' | 'durable-binding' | 'new-session'

export interface ProviderRuntimeSessionRequest {
  chatSessionId: string
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  profile: RuntimeProviderTargetProfile | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
}

export interface ProviderRuntimeSessionResolution {
  runtimeSession: RuntimeSession
  binding: BackendSessionBinding | undefined
  source: ProviderRuntimeSessionSource
  requestedModelId: string | null
}

interface ExistingRuntimeCandidate {
  liveSide: SideConversationRecord | undefined
  reusableBinding: BackendSessionBinding | undefined
}

function readSnapshotModelId(providerStateSnapshot: string | null | undefined): string | null {
  return readProviderStateSnapshot(providerStateSnapshot).models.currentModelId ?? null
}

function readRequestedModelId(input: {
  modelId?: string | null
  liveModelId?: string | null
  binding?: BackendSessionBinding
  runtimeSession?: RuntimeSession
}): string | null {
  if (input.modelId !== undefined) {
    return input.modelId
  }
  return input.liveModelId
    ?? input.binding?.requestedModelId
    ?? readSnapshotModelId(input.runtimeSession?.providerStateSnapshot ?? input.binding?.backendStateSnapshot)
    ?? null
}

function readExistingRuntimeCandidate(input: ProviderRuntimeSessionRequest): ExistingRuntimeCandidate {
  const liveSide = readSideConversation(input.chatSessionId)
  const reusableLiveSide
    = input.providerTargetId !== null
      && liveSide?.providerTargetId === input.providerTargetId
      && liveSide.runtimeKind === input.runtimeKind
      ? refreshSideConversation(input.chatSessionId)
      : undefined
  const reusableBinding = readReusableProviderRuntimeBinding(input)

  return {
    liveSide: reusableLiveSide,
    reusableBinding,
  }
}

export function readDurableProviderRuntimeBinding(chatSessionId: string): BackendSessionBinding | undefined {
  const binding = readProviderRuntimeBinding(chatSessionId)
  return isResumableProviderRuntimeBinding(binding) ? binding : undefined
}

export function readReusableDurableProviderRuntimeBinding(input: {
  chatSessionId: string
  providerTargetId: string | null
  runtimeKind: RuntimeKind
}): BackendSessionBinding | undefined {
  return readReusableProviderRuntimeBinding(input)
}

export function listChatSessionIdsByDurableProviderSession(providerSessionId: string): string[] {
  return listProviderRuntimeBindingsByProviderSession({ providerSessionId })
    .map(binding => binding.chatSessionId)
}

export function listDurableProviderRuntimeBindingsByProviderSession(input: {
  providerSessionId: string
  runtimeKind?: RuntimeKind
}): BackendSessionBinding[] {
  return listProviderRuntimeBindingsByProviderSession(input)
}

export function unlinkProviderTargetFromDurableProviderRuntimeBindings(input: {
  providerTargetId: string
  writer?: ProviderRuntimeBindingDirectoryWriter
}): void {
  clearProviderTargetFromProviderRuntimeBindings(input.providerTargetId, input.writer)
}

export function invalidateDurableProviderRuntimeBindingForChatSession(chatSessionId: string): void {
  deleteProviderRuntimeBinding(chatSessionId)
}

export function releaseLiveProviderRuntimeSessionsForProviderTarget(providerTargetId: string): void {
  releaseSideConversationsByProviderTargetId(providerTargetId)
}

async function resolveExistingCandidate(
  input: ProviderRuntimeSessionRequest,
  candidate: ExistingRuntimeCandidate,
): Promise<ProviderRuntimeSessionResolution | null> {
  if (candidate.liveSide) {
    return {
      runtimeSession: candidate.liveSide.runtimeSession,
      binding: undefined,
      source: 'live-side',
      requestedModelId: readRequestedModelId({
        modelId: input.modelId,
        liveModelId: candidate.liveSide.requestedModelId,
        runtimeSession: candidate.liveSide.runtimeSession,
      }),
    }
  }

  if (!candidate.reusableBinding) {
    return null
  }

  const runtimeSession = await input.runtime.resumeChatSession({
    runtimeSession: {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      providerSessionId: candidate.reusableBinding.backendSessionId,
      providerStateSnapshot: candidate.reusableBinding.backendStateSnapshot,
    },
    profile: input.profile,
    workspacePath: input.workspacePath,
    agentId: input.agentId,
    modelId: input.modelId,
  })
  return {
    runtimeSession,
    binding: candidate.reusableBinding,
    source: 'durable-binding',
    requestedModelId: readRequestedModelId({
      modelId: input.modelId,
      binding: candidate.reusableBinding,
      runtimeSession,
    }),
  }
}

export async function resolveProviderRuntimeSession(
  input: ProviderRuntimeSessionRequest,
): Promise<ProviderRuntimeSessionResolution> {
  const candidate = readExistingRuntimeCandidate(input)
  const existing = await resolveExistingCandidate(input, candidate)
  if (existing) {
    return existing
  }

  const runtimeSession = await input.runtime.startChatSession({
    chatSessionId: input.chatSessionId,
    profile: input.profile,
    workspacePath: input.workspacePath,
    agentId: input.agentId,
    modelId: input.modelId,
    previousProviderStateSnapshot: null,
  })

  return {
    runtimeSession,
    binding: undefined,
    source: 'new-session',
    requestedModelId: readRequestedModelId({
      modelId: input.modelId,
      runtimeSession,
    }),
  }
}

export async function resolveExistingProviderRuntimeSession(
  input: ProviderRuntimeSessionRequest,
): Promise<ProviderRuntimeSessionResolution | null> {
  return await resolveExistingCandidate(input, readExistingRuntimeCandidate(input))
}

export function persistProviderRuntimeResolution(input: {
  chatSessionId: string
  providerTargetId: string | null
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
  durable: boolean
}): BackendSessionBinding | undefined {
  if (!input.durable) {
    return undefined
  }
  if (!input.runtimeSession.providerSessionId) {
    deleteProviderRuntimeBinding(input.chatSessionId)
    return undefined
  }

  return writeProviderRuntimeBinding({
    chatSessionId: input.chatSessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    providerSessionId: input.runtimeSession.providerSessionId,
    providerStateSnapshot: input.runtimeSession.providerStateSnapshot,
    requestedModelId: input.requestedModelId,
  })
}
