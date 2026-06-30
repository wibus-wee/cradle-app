import type { UIMessageChunk } from 'ai'
import type { RemoteAgentTurnEvent } from '@cradle/remote-agent-protocol'
import { z } from 'zod'

import type {
  CancelTurnInput,
  ChatRuntime,
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  ProviderContext,
  ResumeChatSessionInput,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'
import * as RemoteHosts from '../../remote-hosts/service'

const RUNTIME_KIND = 'remote-mock' as RuntimeKind
const DEFAULT_REMOTE_RUNTIME_KIND = 'mock-remote'

const REMOTE_MOCK_RUNTIME_METADATA = {
  label: 'Remote Mock',
  description: 'Development runtime that streams through cradle-agentd.',
  providerKinds: ['universal'],
  iconKey: 'terminal',
  surfaces: ['chat'],
  sortOrder: 90,
} satisfies ChatRuntimeMetadata

const REMOTE_MOCK_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: true,
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  sessionModelSwitch: 'restart-session',
} satisfies ChatRuntimeCapabilities

const remoteMockConfigSchema = z.object({
  remoteHostId: z.string().trim().min(1),
  remoteRuntimeKind: z.string().trim().min(1).default(DEFAULT_REMOTE_RUNTIME_KIND),
  remoteWorkspacePath: z.string().trim().min(1).optional(),
}).passthrough()

interface RemoteMockConfig {
  remoteHostId: string
  remoteRuntimeKind: string
  remoteWorkspacePath?: string
}

interface RemoteMockSnapshot {
  remote?: {
    hostId: string
    agentId: string
    runtimeKind: string
    updatedAt: number
  }
  models?: {
    currentModelId?: string | null
  }
  [key: string]: unknown
}

export function createRemoteMockProvider(_ctx: ProviderContext): ChatRuntime {
  return new RemoteMockProvider()
}

export class RemoteMockProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND
  readonly metadata = REMOTE_MOCK_RUNTIME_METADATA
  readonly capabilities = REMOTE_MOCK_RUNTIME_CAPABILITIES

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    return await this.startRemoteSession({
      chatSessionId: input.chatSessionId,
      profile,
      workspacePath: input.workspacePath,
      modelId: input.modelId ?? null,
    })
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readRemoteMockConfig(profile)
    const snapshot = readRemoteMockSnapshot(input.runtimeSession.providerStateSnapshot)
    if (snapshot.remote) {
      RemoteHosts.upsertRemoteHostAgentdSessionLink({
        chatSessionId: input.runtimeSession.chatSessionId,
        remoteHostId: snapshot.remote.hostId,
        remoteAgentId: snapshot.remote.agentId,
        remoteRuntimeKind: snapshot.remote.runtimeKind,
        providerSessionId: input.runtimeSession.providerSessionId,
        stateSnapshotJson: JSON.stringify(snapshot),
      })
    }

    return {
      ...input.runtimeSession,
      runtimeKind: RUNTIME_KIND,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        remote: snapshot.remote ?? null,
        models: {
          currentModelId: input.modelId ?? snapshot.models?.currentModelId ?? null,
        },
        config: {
          remoteHostId: config.remoteHostId,
          remoteRuntimeKind: config.remoteRuntimeKind,
        },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const link = await this.resolveRemoteLink(input)
    try {
      await RemoteHosts.connectRemoteHost(link.remoteHostId)
      const stream = RemoteHosts.openRemoteHostStream(link.remoteHostId, 'agent/turn', {
        remoteAgentId: link.remoteAgentId,
        chatSessionId: input.runtimeSession.chatSessionId,
        runId: input.runId,
        responseMessageId: input.responseMessageId,
        message: input.message,
        transcript: input.transcript,
        originalMessages: input.originalMessages,
        modelId: input.modelId ?? null,
        workspaceId: input.workspaceId ?? null,
        workspacePath: input.workspacePath,
        cradleAgentId: input.agentId ?? null,
        providerOptions: input.providerOptions,
        systemPrompt: input.systemPrompt,
        history: input.history,
      })

      for await (const event of stream) {
        yield* projectRemoteTurnEvent(event, input)
      }
    }
    catch (error) {
      throw toProviderRuntimeError(error, 'streamTurn')
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const link = RemoteHosts.readRemoteHostAgentdSessionLink(input.runtimeSession.chatSessionId)
    if (!link) {
      throw new ProviderRuntimeError(
        ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId),
      )
    }
    try {
      await RemoteHosts.callRemoteHost(link.remoteHostId, 'agent/steer', {
        remoteAgentId: link.remoteAgentId,
        message: input.message,
      })
    }
    catch (error) {
      throw toProviderRuntimeError(error, 'steerTurn')
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const link = RemoteHosts.readRemoteHostAgentdSessionLink(input.runtimeSession.chatSessionId)
    if (!link) {
      return
    }
    try {
      await RemoteHosts.callRemoteHost(link.remoteHostId, 'agent/cancel', {
        remoteAgentId: link.remoteAgentId,
        reason: 'cancelled by Cradle',
      })
    }
    catch (error) {
      throw toProviderRuntimeError(error, 'cancelTurn')
    }
  }

  async healthCheck() {
    return {
      status: 'unknown' as const,
      message: 'Remote mock health is host-specific; use /remote-hosts/:hostId/health.',
      lastCheckedAt: Math.floor(Date.now() / 1000),
    }
  }

  private async resolveRemoteLink(input: StreamTurnInput) {
    const existing = RemoteHosts.readRemoteHostAgentdSessionLink(input.runtimeSession.chatSessionId)
    if (existing) {
      return existing
    }

    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const session = await this.startRemoteSession({
      chatSessionId: input.runtimeSession.chatSessionId,
      profile,
      workspacePath: input.workspacePath ?? '',
      modelId: input.modelId ?? null,
    })
    const link = RemoteHosts.readRemoteHostAgentdSessionLink(session.chatSessionId)
    if (!link) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'streamTurn', 'Remote session link was not created.'),
      )
    }
    return link
  }

  private async startRemoteSession(input: {
    chatSessionId: string
    profile: RuntimeProviderTargetProfile
    workspacePath: string
    modelId: string | null
  }): Promise<RuntimeSession> {
    const config = readRemoteMockConfig(input.profile)
    const workspacePath = config.remoteWorkspacePath ?? input.workspacePath
    if (!workspacePath) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'startChatSession', 'Remote mock requires a workspace path.'),
      )
    }

    try {
      const connection = await RemoteHosts.connectRemoteHost(config.remoteHostId)
      const result = await RemoteHosts.startRemoteAgent(config.remoteHostId, {
        runtimeKind: config.remoteRuntimeKind,
        workspacePath,
        chatSessionId: input.chatSessionId,
        providerSessionId: null,
        modelId: input.modelId,
      })
      const snapshot = createRemoteMockSnapshot({
        remoteHostId: config.remoteHostId,
        remoteAgentId: result.agent.agentId,
        remoteRuntimeKind: config.remoteRuntimeKind,
        modelId: input.modelId,
      })
      RemoteHosts.upsertRemoteHostAgentdSessionLink({
        chatSessionId: input.chatSessionId,
        remoteHostId: config.remoteHostId,
        remoteAgentId: result.agent.agentId,
        remoteRuntimeKind: config.remoteRuntimeKind,
        daemonHostId: connection.daemonHostId,
        providerSessionId: result.agent.agentId,
        stateSnapshotJson: JSON.stringify(snapshot),
      })
      return {
        id: input.chatSessionId,
        chatSessionId: input.chatSessionId,
        providerTargetId: input.profile.providerTargetId,
        runtimeKind: RUNTIME_KIND,
        providerSessionId: result.agent.agentId,
        providerStateSnapshot: JSON.stringify(snapshot),
      }
    }
    catch (error) {
      throw toProviderRuntimeError(error, 'startChatSession')
    }
  }
}

function readRemoteMockConfig(profile: RuntimeProviderTargetProfile): RemoteMockConfig {
  try {
    return remoteMockConfigSchema.parse(JSON.parse(profile.configJson))
  }
  catch (error) {
    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(
        RUNTIME_KIND,
        'readConfig',
        `Remote mock provider target config is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
  }
}

function readRemoteMockSnapshot(raw: string | null | undefined): RemoteMockSnapshot {
  if (!raw) {
    return { models: { currentModelId: null } }
  }
  return JSON.parse(raw) as RemoteMockSnapshot
}

function createRemoteMockSnapshot(input: {
  remoteHostId: string
  remoteAgentId: string
  remoteRuntimeKind: string
  modelId: string | null
}): RemoteMockSnapshot {
  return {
    remote: {
      hostId: input.remoteHostId,
      agentId: input.remoteAgentId,
      runtimeKind: input.remoteRuntimeKind,
      updatedAt: Date.now(),
    },
    models: { currentModelId: input.modelId },
  }
}

async function* projectRemoteTurnEvent(
  event: RemoteAgentTurnEvent,
  input: StreamTurnInput,
): AsyncGenerator<UIMessageChunk, void, void> {
  switch (event.kind) {
    case 'chunk':
      yield event.chunk
      return
    case 'sessionTitle':
      input.reportSessionTitle?.(event.title)
      return
    case 'providerThreadEvent':
      input.onProviderThreadEvent?.(event.event)
  }
}

function toProviderRuntimeError(error: unknown, method: string): ProviderRuntimeError {
  if (error instanceof ProviderRuntimeError) {
    return error
  }
  const detail = error instanceof Error ? error.message : String(error)
  return new ProviderRuntimeError(ProviderErrors.requestFailed(RUNTIME_KIND, method, detail), {
    cause: error,
  })
}
