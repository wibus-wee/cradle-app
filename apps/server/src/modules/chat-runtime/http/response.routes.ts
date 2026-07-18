import { Elysia } from 'elysia'

import { createChildLogger } from '../../../logging/logger'
import { buildAiTelemetryCorrelationIds } from '../../../telemetry/ai-correlation'
import { ChatRuntimeModel } from '../model'
import { bindReadableStreamToAbortSignal } from '../stream/sse'
import { readChatThinkingEffort, readOptionalModelId } from './request-normalizers'
import type { ChatRuntimeService } from './runtime-loader'
import { loadChatRuntime } from './runtime-loader'

type StreamResponseInput = Parameters<ChatRuntimeService['streamResponse']>[0]

const DESKTOP_UPSTREAM_REQUEST_ID_HEADER = 'x-cradle-desktop-chat-upstream-id'
const DESKTOP_UPSTREAM_MODE_HEADER = 'x-cradle-desktop-chat-upstream-mode'
const responseLogger = createChildLogger({ module: 'chat-runtime.response' })

export const chatRuntimeResponseRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] },
})
  // POST /chat/sessions/:sessionId/response -> SSE stream (send message and get streaming response)
  .post(
    '/sessions/:sessionId/response',
    async ({ params, body, request }) => {
      const startedAtMs = performance.now()
      const desktopUpstreamRequestId = request.headers.get(DESKTOP_UPSTREAM_REQUEST_ID_HEADER)?.trim() || null
      const desktopUpstreamMode = request.headers.get(DESKTOP_UPSTREAM_MODE_HEADER)?.trim() || null
      let accepted = false
      const baseFields = {
        sessionId: params.sessionId,
        desktopUpstreamRequestId,
        desktopUpstreamMode,
      }

      const logAbortBeforeHeaders = () => {
        if (accepted) {
          return
        }
        responseLogger.warn('chat response request aborted before headers', {
          ...baseFields,
          durationMs: Math.round(performance.now() - startedAtMs),
        })
      }
      request.signal.addEventListener('abort', logAbortBeforeHeaders, { once: true })

      responseLogger.info('chat response request received', baseFields)

      try {
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
          runtimeSettings: body.runtimeSettings,
        })
        accepted = true
        request.signal.removeEventListener('abort', logAbortBeforeHeaders)
        responseLogger.info('chat response request accepted', {
          ...baseFields,
          runId: response.runId,
          assistantMessageId: response.assistantMessageId,
          userMessageId: response.userMessageId,
          durationMs: Math.round(performance.now() - startedAtMs),
        })
        const telemetryCorrelation = buildAiTelemetryCorrelationIds({
          sessionId: params.sessionId,
          runId: response.runId,
        })
        return new Response(bindReadableStreamToAbortSignal(response.stream, request.signal), {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
            'x-cradle-run-id': response.runId,
            'x-cradle-assistant-message-id': response.assistantMessageId,
            'x-cradle-user-message-id': response.userMessageId,
            'x-cradle-telemetry-session-id': telemetryCorrelation.sessionId,
            'x-cradle-telemetry-run-id': telemetryCorrelation.runId,
          },
        })
      }
 catch (err) {
        request.signal.removeEventListener('abort', logAbortBeforeHeaders)
        responseLogger.error('chat response request failed before headers', {
          ...baseFields,
          durationMs: Math.round(performance.now() - startedAtMs),
          err,
        })
        throw err
      }
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
                  type: 'string',
                },
                example:
                  'data: {"type":"start","messageId":"msg_main"}\n\ndata: {"type":"text-start","id":"text_1"}\n\ndata: {"type":"text-delta","id":"text_1","delta":"Hello"}\n\ndata: {"type":"text-end","id":"text_1"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n',
              },
            },
          },
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.responseBody,
    },
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
        runtimeSettings: body.runtimeSettings,
      })
      const telemetryCorrelation = buildAiTelemetryCorrelationIds({
        sessionId: params.sideConversationId,
        runId: response.runId,
      })
      return new Response(response.stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
          'x-cradle-run-id': response.runId,
          'x-cradle-assistant-message-id': response.assistantMessageId,
          'x-cradle-user-message-id': response.userMessageId,
          'x-cradle-telemetry-session-id': telemetryCorrelation.sessionId,
          'x-cradle-telemetry-run-id': telemetryCorrelation.runId,
        },
      })
    },
    {
      detail: {
        summary: 'Send message and stream response for a live-only side conversation',
      },
      params: ChatRuntimeModel.sideConversationParams,
      body: ChatRuntimeModel.responseBody,
    },
  )
