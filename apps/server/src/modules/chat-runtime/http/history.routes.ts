import { Elysia } from 'elysia'

import { AppError } from '../../../errors/app-error'
import { getMessageGroups, listCompletedRuns } from '../history-api'
import { ChatRuntimeModel } from '../model'
import { getRunSnapshot, getRunSnapshots } from '../run-snapshot'
import { listChatSessionTraceDtos, readChatRunTraceDto } from '../stream-trace'

export const chatRuntimeHistoryRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] }
})
  // GET /chat/sessions/:sessionId/messages -> historical message snapshot rows
  .get(
    '/sessions/:sessionId/messages',
    async ({ params }) => {
      return await getMessageGroups(params.sessionId)
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
  // GET /chat/runs/completed -> recently completed backend runs
  .get(
    '/runs/completed',
    async ({ query }) => {
      return listCompletedRuns({
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
  // GET /chat/runs/:runId/trace -> dev-mode stream trace JSONL decoded as records
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
  // GET /chat/runs/:runId/snapshot -> durable backend-run snapshot summary
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
  // GET /chat/sessions/:sessionId/traces -> all dev-mode stream traces for a session
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
  // GET /chat/sessions/:sessionId/run-snapshots -> durable backend-run snapshots for a session
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
