import { Elysia } from 'elysia'

import { AppError } from '../../../errors/app-error'
import { getCodexAppServerCapabilities } from '../../chat-runtime-providers/codex/app-server/bridge'
import {
  deleteProviderThread,
  getCapabilities,
  getUiSlotStates,
  listBackgroundTerminals,
  listProviderThreads,
  listProviderThreadTurns,
  readContextUsage,
  readProviderThread,
  terminateBackgroundTerminal,
} from '../capabilities-api'
import {
  getRuntimeRegistry,
  listRuntimeDescriptors,
  listRuntimeHealth,
} from '../chat-runtime-provider-registry'
import { invokeCodexAppServer, openCodexAppServerStream } from '../codex/host'
import { ChatRuntimeModel } from '../model'
import { listRuntimeModels } from '../runtime-model-catalog'
import type { ProviderThreadSourceKind } from '../runtime-provider-types'
import { createEmptyRuntimePresentation } from '../runtime-provider-types'
import { loadChatRuntime } from './runtime-loader'

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
  'unknown',
])

const EVENT_STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'connection': 'keep-alive',
} as const

function parseProviderThreadSourceKinds(
  value: string | undefined,
): ProviderThreadSourceKind[] | undefined {
  const kinds = value
    ?.split(',')
    .map(kind => kind.trim())
    .filter((kind): kind is ProviderThreadSourceKind =>
      PROVIDER_THREAD_SOURCE_KINDS.has(kind as ProviderThreadSourceKind))
  return kinds && kinds.length > 0 ? kinds : undefined
}

export const chatRuntimeIntrospectionRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] },
})
  // GET /chat/runtimes -> registered runtime provider catalog for Chat and Jarvis selectors.
  .get(
    '/runtimes',
    async () => {
      return { items: await listRuntimeDescriptors() }
    },
    {
      detail: {
        summary: 'List registered chat runtimes',
      },
      response: { 200: ChatRuntimeModel.runtimeCatalog },
    },
  )
  // GET /chat/runtimes/health -> optional runtime provider health checks.
  .get(
    '/runtimes/health',
    async () => {
      return { items: await listRuntimeHealth() }
    },
    {
      detail: {
        summary: 'List chat runtime health statuses',
      },
      response: { 200: ChatRuntimeModel.runtimeHealth },
    },
  )
  // GET /chat/runtimes/:runtimeKind/models -> runtime-owned native model catalog.
  .get(
    '/runtimes/:runtimeKind/models',
    async ({ params, query }) => {
      return await listRuntimeModels({
        runtimeKind: params.runtimeKind,
        workspaceId: query.workspaceId?.trim() || undefined,
      })
    },
    {
      detail: {
        summary: 'List native models exposed by a chat runtime',
      },
      params: ChatRuntimeModel.runtimeKindParams,
      query: ChatRuntimeModel.runtimeModelsQuery,
      response: { 200: ChatRuntimeModel.runtimeModelCatalog },
    },
  )
  // GET /chat/draft-runtime-capabilities?runtimeKind=... -> provider-owned pre-session composer capabilities
  .get(
    '/draft-runtime-capabilities',
    async ({ query }) => {
      const runtime = query.runtimeKind === 'standard'
        ? undefined
        : getRuntimeRegistry().get(query.runtimeKind)
      if (!runtime) {
        throw new AppError({
          code: 'chat_runtime_not_available',
          status: 501,
          message: `Runtime is not available: ${query.runtimeKind}`,
        })
      }
      return runtime.getDraftPresentation
        ? await runtime.getDraftPresentation()
        : createEmptyRuntimePresentation(query.runtimeKind)
    },
    {
      detail: {
        summary: 'Get draft chat runtime capabilities',
      },
      query: ChatRuntimeModel.draftRuntimeCapabilitiesQuery,
      response: { 200: ChatRuntimeModel.capabilities },
    },
  )
  // GET /chat/sessions/:sessionId/capabilities -> runtime-native command/skill discovery
  .get(
    '/sessions/:sessionId/capabilities',
    async ({ params }) => {
      return getCapabilities(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat runtime capabilities',
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.capabilities },
    },
  )
  // GET /chat/sessions/:sessionId/ui-slot-states -> provider-owned composer-adjacent state
  .get(
    '/sessions/:sessionId/ui-slot-states',
    async ({ params }) => {
      return getUiSlotStates(params.sessionId)
    },
    {
      detail: {
        summary: 'Get provider-owned chat UI slot states',
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.uiSlotStates },
    },
  )
  // GET /chat/sessions/:sessionId/context-usage -> provider-owned context window usage breakdown
  .get(
    '/sessions/:sessionId/context-usage',
    async ({ params }) => {
      return readContextUsage(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat runtime context window usage',
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.contextUsageResponse },
    },
  )
  // GET /chat/sessions/:sessionId/background-terminals -> provider-owned background terminal process list
  .get(
    '/sessions/:sessionId/background-terminals',
    async ({ params, query }) => {
      return listBackgroundTerminals(params.sessionId, {
        cursor: query.cursor ?? null,
        limit: query.limit ?? null,
      })
    },
    {
      detail: {
        summary: 'List background terminals for a chat session',
      },
      params: ChatRuntimeModel.sessionIdParams,
      query: ChatRuntimeModel.backgroundTerminalsQuery,
      response: { 200: ChatRuntimeModel.backgroundTerminals },
    },
  )
  // POST /chat/sessions/:sessionId/background-terminals/:processId/terminate -> terminate a provider-owned background terminal process
  .post(
    '/sessions/:sessionId/background-terminals/:processId/terminate',
    async ({ params }) => {
      return terminateBackgroundTerminal(
        params.sessionId,
        params.processId,
      )
    },
    {
      detail: {
        summary: 'Terminate a background terminal for a chat session',
      },
      params: ChatRuntimeModel.backgroundTerminalParams,
      response: { 200: ChatRuntimeModel.backgroundTerminalTerminate },
    },
  )
  // GET /chat/sessions/:sessionId/provider-threads -> provider-native subagent/thread list
  .get(
    '/sessions/:sessionId/provider-threads',
    async ({ params, query }) => {
      return listProviderThreads(params.sessionId, {
        cursor: query.cursor ?? null,
        limit: query.limit ?? null,
        sortKey: query.sortKey ?? null,
        sortDirection: query.sortDirection ?? null,
        sourceKinds: parseProviderThreadSourceKinds(query.sourceKinds) ?? null,
        archived: query.archived ?? null,
        searchTerm: query.searchTerm ?? null,
      })
    },
    {
      detail: {
        summary: 'List provider-native threads for a chat session',
      },
      params: ChatRuntimeModel.sessionIdParams,
      query: ChatRuntimeModel.providerThreadsQuery,
      response: { 200: ChatRuntimeModel.providerThreads },
    },
  )
  // GET /chat/sessions/:sessionId/provider-threads/:threadId -> provider-native thread metadata
  .get(
    '/sessions/:sessionId/provider-threads/:threadId',
    async ({ params }) => {
      return readProviderThread(params.sessionId, params.threadId)
    },
    {
      detail: {
        summary: 'Read provider-native thread metadata for a chat session',
      },
      params: ChatRuntimeModel.providerThreadParams,
      response: { 200: ChatRuntimeModel.providerThread },
    },
  )
  // DELETE /chat/sessions/:sessionId/provider-threads/:threadId -> delete a provider-native thread after session-scoped ownership validation
  .delete(
    '/sessions/:sessionId/provider-threads/:threadId',
    async ({ params }) => {
      return deleteProviderThread(params.sessionId, params.threadId)
    },
    {
      detail: {
        summary: 'Delete a provider-native thread for a chat session',
      },
      params: ChatRuntimeModel.providerThreadParams,
      response: { 200: ChatRuntimeModel.providerThreadDelete },
    },
  )
  // GET /chat/sessions/:sessionId/provider-threads/:threadId/turns -> provider-native thread turns and projected UI messages
  .get(
    '/sessions/:sessionId/provider-threads/:threadId/turns',
    async ({ params, query }) => {
      return listProviderThreadTurns(params.sessionId, params.threadId, {
        cursor: query.cursor ?? null,
        limit: query.limit ?? null,
        sortDirection: query.sortDirection ?? null,
      })
    },
    {
      detail: {
        summary: 'List provider-native thread turns for a chat session',
      },
      params: ChatRuntimeModel.providerThreadParams,
      query: ChatRuntimeModel.providerThreadTurnsQuery,
      response: { 200: ChatRuntimeModel.providerThreadTurns },
    },
  )
  // GET /chat/sessions/:sessionId/provider-threads/:threadId/stream -> live provider-native thread AI SDK chunk stream
  .get(
    '/sessions/:sessionId/provider-threads/:threadId/stream',
    async ({ params }) => {
      const stream = (await loadChatRuntime()).openProviderThreadStream(
        params.sessionId,
        params.threadId,
      )
      return new Response(stream, {
        headers: EVENT_STREAM_HEADERS,
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
                  type: 'string',
                },
              },
            },
          },
        },
      },
      params: ChatRuntimeModel.providerThreadParams,
    },
  )
  // GET /chat/sessions/:sessionId/runtime-status -> server-owned runtime session/run status
  .get(
    '/sessions/:sessionId/runtime-status',
    async ({ params }) => {
      return await (await loadChatRuntime()).getRuntimeSessionStatus(params.sessionId)
    },
    {
      detail: {
        summary: 'Get chat runtime session status',
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.runtimeStatus },
    },
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
          message: 'Codex app-server capabilities are not available',
        })
      }
      return getCodexAppServerCapabilities()
    },
    {
      detail: {
        summary: 'Get Codex app-server protocol capabilities exposed by Cradle',
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.codexAppServerCapabilities },
    },
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
        modelId: body.modelId?.trim() || undefined,
      })
    },
    {
      detail: {
        summary: 'Invoke a Codex app-server JSON-RPC method through the session runtime',
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.codexAppServerInvokeBody,
      response: { 200: ChatRuntimeModel.codexAppServerInvokeResponse },
    },
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
        closeOnMethods: body.closeOnMethods,
      })
      return new Response(stream, {
        headers: EVENT_STREAM_HEADERS,
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
                schema: { type: 'string' },
              },
            },
          },
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.codexAppServerStreamBody,
    },
  )
