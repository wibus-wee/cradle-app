import { Elysia } from 'elysia'

import { buildAiTelemetryCorrelationIds } from '../../../telemetry/ai-correlation'
import { ChatRuntimeModel } from '../model'
import { bindReadableStreamToAbortSignal } from '../stream/sse'
import { loadChatRuntime } from './runtime-loader'

export const chatRuntimeStreamRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] },
})
  // GET /chat/sessions/:sessionId/stream -> join the active run SSE stream
  .get(
    '/sessions/:sessionId/stream',
    async ({ params, request }) => {
      const runtime = await loadChatRuntime()
      const stream = await runtime.openSessionRunStream(params.sessionId)
      const activeRun = runtime.getActiveSessionRun(params.sessionId)
      const telemetryCorrelation = activeRun
        ? buildAiTelemetryCorrelationIds({ sessionId: params.sessionId, runId: activeRun.runId })
        : null
      return new Response(bindReadableStreamToAbortSignal(stream, request.signal), {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
          ...(activeRun ? { 'x-cradle-run-id': activeRun.runId } : {}),
          ...(telemetryCorrelation
            ? {
                'x-cradle-telemetry-session-id': telemetryCorrelation.sessionId,
                'x-cradle-telemetry-run-id': telemetryCorrelation.runId,
              }
            : {}),
        },
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
                  type: 'string',
                },
                example:
                  'data: {"type":"text-delta","id":"text_1","delta":" world"}\n\ndata: {"type":"text-end","id":"text_1"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n',
              },
            },
          },
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
    },
  )
