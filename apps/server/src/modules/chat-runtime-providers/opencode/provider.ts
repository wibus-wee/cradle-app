import type { UIMessageChunk } from 'ai'
import type { AssistantMessage as OpencodeAssistantMessage, Config } from '@opencode-ai/sdk'

import type {
  CancelTurnInput,
  ChatRuntime,
  ProviderContext,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
  ListRuntimeModelsInput,
  RuntimeModelCatalog,
} from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { readProviderStateSnapshot } from '../provider-state-snapshot'
import { resolveOpencodeConfig } from './config'
import { OpencodeEventStreamProjector } from './event-stream'
import { projectOpencodePromptParts } from './input-projector'
import { listOpencodeRuntimeModels, OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID } from './model-inventory'
import {
  OPENCODE_RUNTIME_CAPABILITIES,
  OPENCODE_RUNTIME_KIND,
  OPENCODE_RUNTIME_METADATA,
} from './metadata'
import { acquireOpencodeRuntimeResource, type OpencodeRuntimeResource } from './runtime-context'

export function createOpencodeProvider(ctx: ProviderContext): ChatRuntime {
  return new OpencodeProvider(ctx)
}

export class OpencodeProvider implements ChatRuntime {
  readonly runtimeKind = OPENCODE_RUNTIME_KIND
  readonly metadata = OPENCODE_RUNTIME_METADATA
  readonly capabilities = OPENCODE_RUNTIME_CAPABILITIES

  private _lastUsage: TokenUsage | null = null
  private _lastModelId: string | null = null

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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const opencodeSessionId = input.runtimeSession.providerSessionId
    const lease = input.runtimeSession.providerRuntimeLease
    if (!opencodeSessionId || !lease) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    const resolved = await this.resolveRuntimeConfig({
      profile: input.profile,
      requestedModelId: input.modelId,
    })
    this._lastUsage = null
    this._lastModelId = resolved.modelId

    const resource = lease.resource as OpencodeRuntimeResource
    const projector = new OpencodeEventStreamProjector(opencodeSessionId)
    const chunks = new AsyncChunkQueue()
    const eventAbortController = new AbortController()

    try {
      const subscription = await resource.client.event.subscribe({
        ...(input.workspacePath ? { query: { directory: input.workspacePath } } : {}),
        signal: eventAbortController.signal,
        sseMaxRetryAttempts: 0,
      })
      void (async () => {
        try {
          for await (const event of subscription.stream) {
            for (const chunk of projector.projectEvent(event)) {
              chunks.push(chunk)
            }
          }
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

    void (async () => {
      const result = await resource.client.session.prompt({
        path: { id: opencodeSessionId },
        query: { directory: input.workspacePath },
        body: {
          ...(resolved.model ? { model: resolved.model } : {}),
          ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
          parts: projectOpencodePromptParts(input.message),
        },
      })

      if (result.error) {
        chunks.fail(new ProviderRuntimeError(
          ProviderErrors.requestFailed(this.runtimeKind, 'session.prompt', formatOpencodeError(result.error)),
        ))
        return
      }
      if (result.data.info.error) {
        chunks.fail(new ProviderRuntimeError(
          ProviderErrors.requestFailed(
            this.runtimeKind,
            'session.prompt',
            formatOpencodeAssistantError(result.data.info.error),
          ),
        ))
        return
      }

      for (const chunk of projector.projectPromptResult(result.data)) {
        chunks.push(chunk)
      }
      this._lastUsage = projector.usage
      chunks.push(projector.finish(result.data.info))
      chunks.close()
    })().catch(error => chunks.fail(error))

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

  private async createNativeSession(
    resource: OpencodeRuntimeResource,
    workspacePath: string,
    chatSessionId: string,
  ) {
    const result = await resource.client.session.create({
      query: { directory: workspacePath },
      body: { title: `Cradle ${chatSessionId}` },
    })
    if (result.error) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'session.create', formatOpencodeError(result.error)),
      )
    }
    return result.data
  }

  private async resolveRuntimeConfig(input: {
    profile: StartChatSessionInput['profile']
    requestedModelId?: string | null
  }): Promise<{
    config: Config
    model: { providerID: string; modelID: string } | null
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

function parseOpenCodeModelRef(modelId: string | null | undefined): { providerID: string; modelID: string } | null {
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
