import { Elysia } from 'elysia'

import {
  openGlobalSessionEventTailStream,
  openSessionEventTailStream,
} from '../es/event-tail'
import { ChatRuntimeModel } from '../model'
import { bindReadableStreamToAbortSignal } from '../stream/sse'

const EVENT_STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'connection': 'keep-alive',
} as const

export const chatRuntimeEventRoutes = new Elysia({
  prefix: '/chat',
  detail: { tags: ['chat-runtime'] },
})
  .get(
    '/sessions/:sessionId/events',
    ({ params, query, request }) => {
      const stream = openSessionEventTailStream({
        sessionId: params.sessionId,
        afterVersion: query.afterVersion ?? 0,
        limit: query.limit,
      })
      return new Response(bindReadableStreamToAbortSignal(stream, request.signal), {
        headers: EVENT_STREAM_HEADERS,
      })
    },
    {
      detail: {
        summary: 'Subscribe to slim chat session event tail',
        responses: {
          200: {
            description:
              'Server-sent event stream of slim chat session lifecycle events after the requested aggregate version.',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      query: ChatRuntimeModel.sessionEventsQuery,
    },
  )

export const chatRuntimeGlobalEventRoutes = new Elysia({
  detail: { tags: ['events'] },
})
  .get(
    '/events',
    ({ query, request }) => {
      const stream = openGlobalSessionEventTailStream({
        afterSequenceId: query.afterSequenceId ?? 0,
        workspaceId: query.workspaceId?.trim() || null,
        limit: query.limit,
      })
      return new Response(bindReadableStreamToAbortSignal(stream, request.signal), {
        headers: EVENT_STREAM_HEADERS,
      })
    },
    {
      detail: {
        summary: 'Subscribe to global session summary event tail',
        responses: {
          200: {
            description:
              'Server-sent event stream of slim session lifecycle events after the requested global sequence id.',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
      query: ChatRuntimeModel.globalEventsQuery,
    },
  )
