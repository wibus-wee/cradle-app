import { Elysia } from 'elysia'

import { AppError } from '../../errors/app-error'
import { getCodexAppServerCapabilities } from '../chat-runtime-providers/codex/app-server/bridge'
import { releaseSideConversation } from '../provider-runtime/side-conversation-registry'
import {
  getRuntimeRegistry,
  listRuntimeCatalog,
  listRuntimeHealth
} from './chat-runtime-provider-registry'
import { invokeCodexAppServer, openCodexAppServerStream } from './codex/host'
import { ChatRuntimeModel } from './model'
import { submitRuntimeToolApproval } from './pending-tool-approval'
import { submitRuntimeUserInput } from './pending-user-input'
import { getRunSnapshot, getRunSnapshots } from './run-snapshot'
import { createEmptyRuntimePresentation } from './runtime-provider-types'
import { listRuntimeModels } from './runtime-model-catalog'
import { bindReadableStreamToAbortSignal } from './stream/sse'
import { listChatSessionTraceDtos, readChatRunTraceDto } from './stream-trace'
import type { ChatThinkingEffort, ProviderThreadSourceKind } from './runtime-provider-types'

type QueueThinkingEffort = Extract<ChatThinkingEffort, 'low' | 'medium' | 'high' | 'xhigh'>

type ChatRuntimeService = typeof import('./service')
type StreamResponseInput = Parameters<ChatRuntimeService['streamResponse']>[0]

let chatRuntimeService: Promise<ChatRuntimeService> | null = null
async function loadChatRuntime(): Promise<ChatRuntimeService> {
  chatRuntimeService ??= import('./service')
  return await chatRuntimeService
}

const PROVIDER_THREAD_SOURCE_KINDS = new Set<ProviderThreadSourceKind>([
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
  'unknown'
])

function parseProviderThreadSourceKinds(
  value: string | undefined
): ProviderThreadSourceKind[] | undefined {
  const kinds = value
    ?.split(',')
    .map((kind) => kind.trim())
    .filter((kind): kind is ProviderThreadSourceKind =>
      PROVIDER_THREAD_SOURCE_KINDS.has(kind as ProviderThreadSourceKind)
    )
  return kinds && kinds.length > 0 ? kinds : undefined
}

function readChatThinkingEffort(value: unknown): QueueThinkingEffort | undefined {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : undefined
}

function readOptionalModelId(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null
  }
  return value?.trim() || undefined
}

export const chatRuntime = new Elysia({
  prefix: '/chat',
  detail: { tags: ['chat-runtime'] }
})
  // POST /chat/sessions/:sessionId/response → SSE stream (send message + get streaming response)
  .post(
    '/sessions/:sessionId/response',
    async ({ params, body, request }) => {
      const runtime = await loadChatRuntime()
      const response = await runtime.streamResponse({
        sessionId: params.sessionId,
        text: body.text ?? '',
        files: body.files,
        contextParts: body.contextParts,
        messages: body.messages as StreamResponseInput['messages'],
        providerTargetId: body.providerTargetId?.trim() || undefined,
        modelId: readOptionalModelId(body.modelId),
        thinkingEffort: readChatThinkingEffort(body.thinkingEffort),
        runtimeSettings: body.runtimeSettings
      })
      return new Response(bindReadableStreamToAbortSignal(response.stream, request.signal), {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-cradle-run-id': response.runId,
          'x-cradle-assistant-message-id': response.assistantMessageId,
          'x-cradle-user-message-id': response.userMessageId
        }
      })
    },
    {
      detail: {
        summary: 'Send message and stream response via SSE',
        responses: {
          200: {
            description:
              'Server-sent event stream encoded as AI SDK UIMessageChunk JSON frames. The stream emits chunks such as `start`, `text-start`, `text-delta`, `tool-input-available`, `tool-approval-request`, `tool-output-available`, `finish`, `abort`, and `error`.',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string'
                },
                example:
                  'data: {"type":"start","messageId":"msg_main"}\n\ndata: {"type":"text-start","id":"text_1"}\n\ndata: {"type":"text-delta","id":"text_1","delta":"Hello"}\n\ndata: {"type":"text-end","id":"text_1"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n'
              }
            }
          }
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.responseBody
    }
  )
  // POST /chat/sessions/:sessionId/rollback-last-turn -> drop the last completed provider turn from runtime and Cradle transcript
  .post(
    '/sessions/:sessionId/rollback-last-turn',
    async ({ params }) => {
      return await (await loadChatRuntime()).rollbackLastTurn(params.sessionId)
    },
    {
      detail: {
        summary: 'Roll back the last completed chat turn',
        'x-cradle-cli': {
          command: ['chat', 'session', 'rollback-last-turn']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.rollbackLastTurnResponse }
    }
  )
  // POST /chat/sessions/:sessionId/bang-command -> execute a user-entered shell command through the session runtime and persist transcript context
  .post(
    '/sessions/:sessionId/bang-command',
    async ({ params, body, request }) => {
      return await (
        await loadChatRuntime()
      ).executeBangCommand({
        sessionId: params.sessionId,
        command: body.command,
        signal: request.signal
      })
    },
    {
      detail: {
        summary: 'Execute a user-entered shell command and persist the output as chat context'
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.bangCommandBody,
      response: { 200: ChatRuntimeModel.bangCommandResponse }
    }
  )
  // POST /chat/sessions/:sessionId/title/regenerate -> regenerate the persisted session title through the active runtime
  .post(
    '/sessions/:sessionId/title/regenerate',
    async ({ params }) => {
      return await (await loadChatRuntime()).regenerateSessionTitle(params.sessionId)
    },
    {
      detail: {
        summary: 'Regenerate chat session title'
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.regeneratedTitleResponse }
    }
  )
  // POST /chat/sessions/:sessionId/side-chat -> fork a live-only provider side conversation from the current chat session
  .post(
    '/sessions/:sessionId/side-chat',
    async ({ params, body }) => {
      return await (
        await loadChatRuntime()
      ).createSideChat({
        parentSessionId: params.sessionId,
        providerTargetId: body.providerTargetId?.trim() || undefined,
        modelId: readOptionalModelId(body.modelId)
      })
    },
    {
      detail: {
        summary: 'Create a live-only side conversation from the current session'
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.sideChatBody,
      response: { 200: ChatRuntimeModel.sideChatResponse }
    }
  )
  // POST /chat/sessions/:sessionId/quick-question -> stream a stateless quick question (no tools, not persisted)
  .post(
    '/sessions/:sessionId/quick-question',
    async ({ params, body }) => {
      const stream = await (
        await loadChatRuntime()
      ).streamQuickQuestion({
        sessionId: params.sessionId,
        question: body.question
      })
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        }
      })
    },
    {
      detail: {
        summary: 'Stream a quick question without persisting to history (no tools)',
        responses: {
          200: {
            description: 'Server-sent event stream with AI SDK UIMessageChunk JSON frames',
            content: {
              'text/event-stream': {
                schema: { type: 'string' }
              }
            }
          }
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.quickQuestionBody
    }
  )
  // POST /chat/sessions/:sessionId/user-input/:requestId -> resolve a provider pending user input request
  .post(
    '/sessions/:sessionId/user-input/:requestId',
    async ({ params, body }) => {
      return submitRuntimeUserInput({
        sessionId: params.sessionId,
        requestId: params.requestId,
        answers: body.answers
      })
    },
    {
      detail: {
        summary: 'Submit answers for a pending runtime user input request'
      },
      params: ChatRuntimeModel.userInputParams,
      body: ChatRuntimeModel.userInputBody,
      response: { 200: ChatRuntimeModel.userInputResponse }
    }
  )
  // POST /chat/sessions/:sessionId/tool-approval/:requestId -> resolve a provider pending tool approval request
  .post(
    '/sessions/:sessionId/tool-approval/:requestId',
    async ({ params, body }) => {
      return submitRuntimeToolApproval({
        sessionId: params.sessionId,
        requestId: params.requestId,
        approved: body.approved,
        reason: body.reason
      })
    },
    {
      detail: {
        summary: 'Submit a decision for a pending runtime tool approval request'
      },
      params: ChatRuntimeModel.toolApprovalParams,
      body: ChatRuntimeModel.toolApprovalBody,
      response: { 200: ChatRuntimeModel.toolApprovalResponse }
    }
  )
  // POST /chat/side-conversations/:sideConversationId/response -> stream a live-only side conversation turn
  .post(
    '/side-conversations/:sideConversationId/response',
    async ({ params, body }) => {
      const response = await (
        await loadChatRuntime()
      ).streamSideConversationResponse({
        sideConversationId: params.sideConversationId,
        text: body.text ?? '',
        files: body.files,
        contextParts: body.contextParts,
        modelId: readOptionalModelId(body.modelId),
        thinkingEffort: readChatThinkingEffort(body.thinkingEffort),
        runtimeSettings: body.runtimeSettings
      })
      return new Response(response.stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-cradle-run-id': response.runId,
          'x-cradle-assistant-message-id': response.assistantMessageId,
          'x-cradle-user-message-id': response.userMessageId
        }
      })
    },
    {
      detail: {
        summary: 'Send message and stream response for a live-only side conversation'
      },
      params: ChatRuntimeModel.sideConversationParams,
      body: ChatRuntimeModel.responseBody
    }
  )
  // DELETE /chat/side-conversations/:sideConversationId -> release a live side conversation
  .delete(
    '/side-conversations/:sideConversationId',
    async ({ params }) => {
      releaseSideConversation(params.sideConversationId)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Release a live-only side conversation'
      },
      params: ChatRuntimeModel.sideConversationParams,
      response: { 200: ChatRuntimeModel.cancelResponse }
    }
  )
  // GET /chat/sessions/:sessionId/stream → join the active run SSE stream
  .get(
    '/sessions/:sessionId/stream',
    async ({ params, request }) => {
      const stream = await (await loadChatRuntime()).openSessionRunStream(params.sessionId)
      const activeRun = (await loadChatRuntime()).getActiveSessionRun(params.sessionId)
      return new Response(bindReadableStreamToAbortSignal(stream, request.signal), {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          ...(activeRun ? { 'x-cradle-run-id': activeRun.runId } : {})
        }
      })
    },
    {
      detail: {
        summary: 'Subscribe to the active chat run stream for an existing session',
        responses: {
          200: {
            description:
              'AI SDK UIMessageChunk SSE stream for the currently active chat run. The stream replays buffered protocol chunks before forwarding live chunks, so late subscribers can rebuild the active assistant message through the AI SDK stream reader.',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string'
                },
                example:
                  'data: {"type":"text-delta","id":"text_1","delta":" world"}\n\ndata: {"type":"text-end","id":"text_1"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n'
              }
            }
          }
        }
      },
      params: ChatRuntimeModel.sessionIdParams
    }
  )
  // GET /chat/runtimes -> registered runtime provider catalog for Chat and Jarvis selectors.
  .get(
    '/runtimes',
    () => {
      return { items: listRuntimeCatalog() }
    },
    {
      detail: {
        summary: 'List registered chat runtimes'
      },
      response: { 200: ChatRuntimeModel.runtimeCatalog }
    }
  )
  // GET /chat/runtimes/health -> optional runtime provider health checks.
  .get(
    '/runtimes/health',
    async () => {
      return { items: await listRuntimeHealth() }
    },
    {
      detail: {
        summary: 'List chat runtime health statuses'
      },
      response: { 200: ChatRuntimeModel.runtimeHealth }
    }
  )
  // GET /chat/runtimes/:runtimeKind/models -> runtime-owned native model catalog.
  .get(
    '/runtimes/:runtimeKind/models',
    async ({ params, query }) => {
      return await listRuntimeModels({
        runtimeKind: params.runtimeKind,
        workspaceId: query.workspaceId?.trim() || undefined
      })
    },
    {
      detail: {
        summary: 'List native models exposed by a chat runtime'
      },
      params: ChatRuntimeModel.runtimeKindParams,
      query: ChatRuntimeModel.runtimeModelsQuery,
      response: { 200: ChatRuntimeModel.runtimeModelCatalog }
    }
  )
  // GET /chat/sessions/:sessionId/queue → durable continuation queue
  .get(
    '/sessions/:sessionId/queue',
    async ({ params }) => {
      return { items: (await loadChatRuntime()).listSessionQueueItems(params.sessionId) }
    },
    {
      detail: {
        summary: 'List pending and historical chat continuation queue items',
        'x-cradle-cli': {
          command: ['chat', 'queue']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.queueListResponse }
    }
  )
  // POST /chat/sessions/:sessionId/queue → enqueue busy-session follow-up
  .post(
    '/sessions/:sessionId/queue',
    async ({ params, body }) => {
      return await (
        await loadChatRuntime()
      ).enqueueSessionQueueItem({
        sessionId: params.sessionId,
        text: body.text,
        files: body.files,
        contextParts: body.contextParts,
        providerTargetId: body.providerTargetId?.trim() || undefined,
        modelId: readOptionalModelId(body.modelId),
        thinkingEffort: readChatThinkingEffort(body.thinkingEffort),
        runtimeSettings: body.runtimeSettings
      })
    },
    {
      detail: {
        summary: 'Enqueue a chat continuation for the session',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'add']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.queueEnqueueBody,
      response: { 200: ChatRuntimeModel.queueItem }
    }
  )
  // POST /chat/sessions/:sessionId/steer -> apply same-turn guidance to the active runtime turn
  .post(
    '/sessions/:sessionId/steer',
    async ({ params, body }) => {
      return await (
        await loadChatRuntime()
      ).submitSessionSteerTurn({
        sessionId: params.sessionId,
        text: body.text,
        files: body.files,
        contextParts: body.contextParts,
        providerTargetId: body.providerTargetId?.trim() || undefined
      })
    },
    {
      detail: {
        summary: 'Steer the currently active chat runtime turn'
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.steerBody,
      response: { 200: ChatRuntimeModel.steerResponse }
    }
  )
  // POST /chat/sessions/:sessionId/queue/reorder → reorder pending queue items
  .post(
    '/sessions/:sessionId/queue/reorder',
    async ({ params, body }) => {
      return {
        items: await (
          await loadChatRuntime()
        ).reorderSessionQueueItems(params.sessionId, body.queueItemIds)
      }
    },
    {
      detail: {
        summary: 'Reorder pending chat continuation queue items',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'reorder']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.queueReorderBody,
      response: { 200: ChatRuntimeModel.queueListResponse }
    }
  )
  // DELETE /chat/sessions/:sessionId/queue/:queueItemId → cancel pending queue item
  .delete(
    '/sessions/:sessionId/queue/:queueItemId',
    async ({ params }) => {
      return await (
        await loadChatRuntime()
      ).cancelSessionQueueItem(params.sessionId, params.queueItemId)
    },
    {
      detail: {
        summary: 'Cancel a pending chat continuation queue item',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'cancel']
        }
      },
      params: ChatRuntimeModel.queueItemParams,
      response: { 200: ChatRuntimeModel.queueItem }
    }
  )
  // PATCH /chat/sessions/:sessionId/queue/:queueItemId → edit a pending queue item in place
  .patch(
    '/sessions/:sessionId/queue/:queueItemId',
    async ({ params, body }) => {
      return await (
        await loadChatRuntime()
      ).updateSessionQueueItem({
        sessionId: params.sessionId,
        queueItemId: params.queueItemId,
        text: body.text,
        files: body.files,
        contextParts: body.contextParts,
        providerTargetId: body.providerTargetId?.trim() || undefined,
        modelId: readOptionalModelId(body.modelId),
        thinkingEffort: readChatThinkingEffort(body.thinkingEffort),
        runtimeSettings: body.runtimeSettings
      })
    },
    {
      detail: {
        summary: 'Edit a pending chat continuation queue item in place',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'update']
        }
      },
      params: ChatRuntimeModel.queueItemParams,
      body: ChatRuntimeModel.queueUpdateBody,
      response: { 200: ChatRuntimeModel.queueItem }
    }
  )
  // GET /chat/draft-runtime-capabilities?runtimeKind=... -> provider-owned pre-session composer capabilities
  .get(
    '/draft-runtime-capabilities',
    async ({ query }) => {
      const runtime = getRuntimeRegistry().get(query.runtimeKind)
      if (!runtime) {
        throw new AppError({
          code: 'chat_runtime_not_available',
          status: 501,
          message: `Runtime is not available: ${query.runtimeKind}`
        })
      }
      return runtime.getDraftPresentation
        ? await runtime.getDraftPresentation()
        : createEmptyRuntimePresentation(query.runtimeKind)
    },
    {
      detail: {
        summary: 'Get draft chat runtime capabilities'
      },
      query: ChatRuntimeModel.draftRuntimeCapabilitiesQuery,
      response: { 200: ChatRuntimeModel.capabilities }
    }
  )
  // GET /chat/sessions/:sessionId/capabilities → runtime-native command/skill discovery
  .get(
    '/sessions/:sessionId/capabilities',
    async ({ params }) => {
      return (await loadChatRuntime()).getCapabilities(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat runtime capabilities'
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.capabilities }
    }
  )
  // GET /chat/sessions/:sessionId/ui-slot-states -> provider-owned composer-adjacent state
  .get(
    '/sessions/:sessionId/ui-slot-states',
    async ({ params }) => {
      return (await loadChatRuntime()).getUiSlotStates(params.sessionId)
    },
    {
      detail: {
        summary: 'Get provider-owned chat UI slot states'
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.uiSlotStates }
    }
  )
  // GET /chat/sessions/:sessionId/context-usage -> provider-owned context window usage breakdown
  .get(
    '/sessions/:sessionId/context-usage',
    async ({ params }) => {
      return (await loadChatRuntime()).readContextUsage(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat runtime context window usage'
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.contextUsageResponse }
    }
  )
  // GET /chat/sessions/:sessionId/background-terminals -> provider-owned background terminal process list
  .get(
    '/sessions/:sessionId/background-terminals',
    async ({ params, query }) => {
      return (await loadChatRuntime()).listBackgroundTerminals(params.sessionId, {
        cursor: query.cursor ?? null,
        limit: query.limit ?? null
      })
    },
    {
      detail: {
        summary: 'List background terminals for a chat session'
      },
      params: ChatRuntimeModel.sessionIdParams,
      query: ChatRuntimeModel.backgroundTerminalsQuery,
      response: { 200: ChatRuntimeModel.backgroundTerminals }
    }
  )
  // POST /chat/sessions/:sessionId/background-terminals/:processId/terminate -> terminate a provider-owned background terminal process
  .post(
    '/sessions/:sessionId/background-terminals/:processId/terminate',
    async ({ params }) => {
      return (await loadChatRuntime()).terminateBackgroundTerminal(
        params.sessionId,
        params.processId
      )
    },
    {
      detail: {
        summary: 'Terminate a background terminal for a chat session'
      },
      params: ChatRuntimeModel.backgroundTerminalParams,
      response: { 200: ChatRuntimeModel.backgroundTerminalTerminate }
    }
  )
  // GET /chat/sessions/:sessionId/provider-threads -> provider-native subagent/thread list
  .get(
    '/sessions/:sessionId/provider-threads',
    async ({ params, query }) => {
      return (await loadChatRuntime()).listProviderThreads(params.sessionId, {
        cursor: query.cursor ?? null,
        limit: query.limit ?? null,
        sortKey: query.sortKey ?? null,
        sortDirection: query.sortDirection ?? null,
        sourceKinds: parseProviderThreadSourceKinds(query.sourceKinds) ?? null,
        archived: query.archived ?? null,
        searchTerm: query.searchTerm ?? null
      })
    },
    {
      detail: {
        summary: 'List provider-native threads for a chat session'
      },
      params: ChatRuntimeModel.sessionIdParams,
      query: ChatRuntimeModel.providerThreadsQuery,
      response: { 200: ChatRuntimeModel.providerThreads }
    }
  )
  // GET /chat/sessions/:sessionId/provider-threads/:threadId -> provider-native thread metadata
  .get(
    '/sessions/:sessionId/provider-threads/:threadId',
    async ({ params }) => {
      return (await loadChatRuntime()).readProviderThread(params.sessionId, params.threadId)
    },
    {
      detail: {
        summary: 'Read provider-native thread metadata for a chat session'
      },
      params: ChatRuntimeModel.providerThreadParams,
      response: { 200: ChatRuntimeModel.providerThread }
    }
  )
  // DELETE /chat/sessions/:sessionId/provider-threads/:threadId -> delete a provider-native thread after session-scoped ownership validation
  .delete(
    '/sessions/:sessionId/provider-threads/:threadId',
    async ({ params }) => {
      return (await loadChatRuntime()).deleteProviderThread(params.sessionId, params.threadId)
    },
    {
      detail: {
        summary: 'Delete a provider-native thread for a chat session'
      },
      params: ChatRuntimeModel.providerThreadParams,
      response: { 200: ChatRuntimeModel.providerThreadDelete }
    }
  )
  // GET /chat/sessions/:sessionId/provider-threads/:threadId/turns -> provider-native thread turns and projected UI messages
  .get(
    '/sessions/:sessionId/provider-threads/:threadId/turns',
    async ({ params, query }) => {
      return (await loadChatRuntime()).listProviderThreadTurns(params.sessionId, params.threadId, {
        cursor: query.cursor ?? null,
        limit: query.limit ?? null,
        sortDirection: query.sortDirection ?? null
      })
    },
    {
      detail: {
        summary: 'List provider-native thread turns for a chat session'
      },
      params: ChatRuntimeModel.providerThreadParams,
      query: ChatRuntimeModel.providerThreadTurnsQuery,
      response: { 200: ChatRuntimeModel.providerThreadTurns }
    }
  )
  // GET /chat/sessions/:sessionId/provider-threads/:threadId/stream -> live provider-native thread AI SDK chunk stream
  .get(
    '/sessions/:sessionId/provider-threads/:threadId/stream',
    async ({ params }) => {
      const stream = (await loadChatRuntime()).openProviderThreadStream(
        params.sessionId,
        params.threadId
      )
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        }
      })
    },
    {
      detail: {
        summary: 'Subscribe to provider-native thread live stream',
        responses: {
          200: {
            description:
              'AI SDK UIMessageChunk SSE stream for a provider-native thread such as a Codex subagent thread.',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string'
                }
              }
            }
          }
        }
      },
      params: ChatRuntimeModel.providerThreadParams
    }
  )
  // GET /chat/sessions/:sessionId/runtime-status → server-owned runtime session/run status
  .get(
    '/sessions/:sessionId/runtime-status',
    async ({ params }) => {
      return await (await loadChatRuntime()).getRuntimeSessionStatus(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat runtime session status'
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.runtimeStatus }
    }
  )
  // GET /chat/sessions/:sessionId/codex/app-server/capabilities -> generated Codex app-server surface
  .get(
    '/sessions/:sessionId/codex/app-server/capabilities',
    async ({ params }) => {
      await (await loadChatRuntime()).getRuntimeSessionStatus(params.sessionId)
      if (!getRuntimeRegistry().get('codex')) {
        throw new AppError({
          code: 'chat_runtime_not_available',
          status: 501,
          message: 'Codex app-server capabilities are not available'
        })
      }
      return getCodexAppServerCapabilities()
    },
    {
      detail: {
        summary: 'Get Codex app-server protocol capabilities exposed by Cradle'
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.codexAppServerCapabilities }
    }
  )
  // POST /chat/sessions/:sessionId/codex/app-server/invoke -> invoke any generated app-server method
  .post(
    '/sessions/:sessionId/codex/app-server/invoke',
    async ({ params, body }) => {
      return await invokeCodexAppServer({
        sessionId: params.sessionId,
        method: body.method,
        params: body.params,
        providerTargetId: body.providerTargetId?.trim() || undefined,
        modelId: body.modelId?.trim() || undefined
      })
    },
    {
      detail: {
        summary: 'Invoke a Codex app-server JSON-RPC method through the session runtime'
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.codexAppServerInvokeBody,
      response: { 200: ChatRuntimeModel.codexAppServerInvokeResponse }
    }
  )
  // POST /chat/sessions/:sessionId/codex/app-server/stream -> invoke app-server method and stream notifications
  .post(
    '/sessions/:sessionId/codex/app-server/stream',
    async ({ params, body }) => {
      const stream = await openCodexAppServerStream({
        sessionId: params.sessionId,
        method: body.method,
        params: body.params,
        providerTargetId: body.providerTargetId?.trim() || undefined,
        modelId: body.modelId?.trim() || undefined,
        closeOnMethods: body.closeOnMethods
      })
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        }
      })
    },
    {
      detail: {
        summary: 'Invoke a Codex app-server method and stream raw notifications as SSE',
        responses: {
          200: {
            description:
              'Server-sent events with `request_started`, `notification`, `server_request`, `result`, `error`, and `done` events.',
            content: {
              'text/event-stream': {
                schema: { type: 'string' }
              }
            }
          }
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.codexAppServerStreamBody
    }
  )
  // POST /chat/sessions/:sessionId/messages/:messageId/plan-implementation-approval -> resolve a synthetic provider plan implementation approval
  .post(
    '/sessions/:sessionId/messages/:messageId/plan-implementation-approval',
    async ({ params, body }) => {
      return (await loadChatRuntime()).resolvePlanImplementationApproval({
        sessionId: params.sessionId,
        messageId: params.messageId,
        approvalId: body.approvalId,
        approved: body.approved
      })
    },
    {
      detail: {
        summary: 'Resolve a synthetic provider plan implementation approval'
      },
      params: ChatRuntimeModel.planImplementationApprovalParams,
      body: ChatRuntimeModel.planImplementationApprovalBody,
      response: { 200: ChatRuntimeModel.planImplementationApprovalResponse }
    }
  )
  // GET /chat/sessions/:sessionId/messages → historical message snapshot rows
  .get(
    '/sessions/:sessionId/messages',
    async ({ params }) => {
      return await (await loadChatRuntime()).getMessageGroups(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat message snapshot rows',
        'x-cradle-cli': {
          command: ['chat', 'messages']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.chatMessages }
    }
  )
  // GET /chat/runs/:runId/trace → dev-mode stream trace JSONL decoded as records
  .get(
    '/runs/completed',
    async ({ query }) => {
      return (await loadChatRuntime()).listCompletedRuns({
        since: query.since ?? null,
        limit: query.limit ?? null
      })
    },
    {
      detail: {
        summary: 'List recently completed chat runs'
      },
      query: ChatRuntimeModel.completedRunsQuery,
      response: { 200: ChatRuntimeModel.completedRuns }
    }
  )
  // GET /chat/runs/:runId/trace → dev-mode stream trace JSONL decoded as records
  .get(
    '/runs/:runId/trace',
    async ({ params }) => {
      return readChatRunTraceDto(params.runId)
    },
    {
      detail: {
        summary: 'Get chat stream trace records for a run',
        'x-cradle-cli': {
          command: ['chat', 'trace', 'run']
        }
      },
      params: ChatRuntimeModel.runIdParams,
      response: { 200: ChatRuntimeModel.runTrace }
    }
  )
  // GET /chat/runs/:runId/snapshot → durable backend-run snapshot summary
  .get(
    '/runs/:runId/snapshot',
    async ({ params }) => {
      const snapshot = getRunSnapshot(params.runId)
      if (!snapshot) {
        throw new AppError({
          code: 'chat_run_snapshot_not_found',
          status: 404,
          message: 'Chat run snapshot not found',
          details: { runId: params.runId }
        })
      }
      return snapshot
    },
    {
      detail: {
        summary: 'Get durable chat run snapshot',
        'x-cradle-cli': {
          command: ['chat', 'snapshot', 'run']
        }
      },
      params: ChatRuntimeModel.runIdParams,
      response: { 200: ChatRuntimeModel.runSnapshot }
    }
  )
  // GET /chat/sessions/:sessionId/traces → all dev-mode stream traces for a session
  .get(
    '/sessions/:sessionId/traces',
    async ({ params }) => {
      return listChatSessionTraceDtos(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat stream traces for a session',
        'x-cradle-cli': {
          command: ['chat', 'trace', 'session']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.sessionTraces }
    }
  )
  // GET /chat/sessions/:sessionId/run-snapshots → durable backend-run snapshots for a session
  .get(
    '/sessions/:sessionId/run-snapshots',
    async ({ params }) => {
      return {
        sessionId: params.sessionId,
        snapshots: getRunSnapshots({ chatSessionId: params.sessionId, limit: 200 })
      }
    },
    {
      detail: {
        summary: 'Get durable chat run snapshots for a session',
        'x-cradle-cli': {
          command: ['chat', 'snapshot', 'session']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.sessionRunSnapshots }
    }
  )
  // POST /chat/sessions/:sessionId/cancel → abort active run
  .post(
    '/sessions/:sessionId/cancel',
    async ({ params }) => {
      await (await loadChatRuntime()).cancelSession(params.sessionId)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Cancel active run for session',
        'x-cradle-cli': {
          command: ['chat', 'cancel']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.cancelResponse }
    }
  )
  // GET /chat/sessions/:sessionId/runtime-settings → read Cradle-owned runtime controls
  .get(
    '/sessions/:sessionId/runtime-settings',
    async ({ params }) => {
      return (await loadChatRuntime()).getSessionRuntimeSettings(params.sessionId)
    },
    {
      detail: {
        summary: 'Get runtime settings for a chat session',
        'x-cradle-cli': {
          command: ['chat', 'runtime-settings', 'get']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.runtimeSettingsResponse }
    }
  )
  // PATCH /chat/sessions/:sessionId/runtime-settings → update Cradle-owned runtime controls
  .patch(
    '/sessions/:sessionId/runtime-settings',
    async ({ params, body }) => {
      return await (
        await loadChatRuntime()
      ).updateSessionRuntimeSettings({
        sessionId: params.sessionId,
        patch: body
      })
    },
    {
      detail: {
        summary: 'Update runtime settings for a chat session',
        'x-cradle-cli': {
          command: ['chat', 'runtime-settings', 'set']
        }
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.runtimeSettingsBody,
      response: { 200: ChatRuntimeModel.runtimeSettingsResponse }
    }
  )
