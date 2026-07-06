import { Elysia } from 'elysia'

import { ChatRuntimeModel } from '../model'
import { readChatThinkingEffort, readOptionalModelId } from './request-normalizers'
import { loadChatRuntime } from './runtime-loader'

export const chatRuntimeLifecycleRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] },
})
  // POST /chat/sessions/:sessionId/rollback-last-turn -> drop the last completed provider turn from runtime and Cradle transcript
  .post(
    '/sessions/:sessionId/rollback-last-turn',
    async ({ params }) => {
      return await (await loadChatRuntime()).rollbackLastTurn(params.sessionId)
    },
    {
      detail: {
        'summary': 'Roll back the last completed chat turn',
        'x-cradle-cli': {
          command: ['chat', 'session', 'rollback-last-turn'],
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.rollbackLastTurnResponse },
    },
  )
  // GET /chat/sessions/:sessionId/queue -> durable continuation queue
  .get(
    '/sessions/:sessionId/queue',
    async ({ params }) => {
      return { items: (await loadChatRuntime()).listSessionQueueItems(params.sessionId) }
    },
    {
      detail: {
        'summary': 'List pending and historical chat continuation queue items',
        'x-cradle-cli': {
          command: ['chat', 'queue'],
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.queueListResponse },
    },
  )
  // POST /chat/sessions/:sessionId/queue -> enqueue busy-session follow-up
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
        runtimeSettings: body.runtimeSettings,
      })
    },
    {
      detail: {
        'summary': 'Enqueue a chat continuation for the session',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'add'],
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.queueEnqueueBody,
      response: { 200: ChatRuntimeModel.queueItem },
    },
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
        providerTargetId: body.providerTargetId?.trim() || undefined,
      })
    },
    {
      detail: {
        summary: 'Steer the currently active chat runtime turn',
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.steerBody,
      response: { 200: ChatRuntimeModel.steerResponse },
    },
  )
  // POST /chat/sessions/:sessionId/queue/reorder -> reorder pending queue items
  .post(
    '/sessions/:sessionId/queue/reorder',
    async ({ params, body }) => {
      return {
        items: await (
          await loadChatRuntime()
        ).reorderSessionQueueItems(params.sessionId, body.queueItemIds),
      }
    },
    {
      detail: {
        'summary': 'Reorder pending chat continuation queue items',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'reorder'],
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.queueReorderBody,
      response: { 200: ChatRuntimeModel.queueListResponse },
    },
  )
  // DELETE /chat/sessions/:sessionId/queue/:queueItemId -> cancel pending queue item
  .delete(
    '/sessions/:sessionId/queue/:queueItemId',
    async ({ params }) => {
      return await (
        await loadChatRuntime()
      ).cancelSessionQueueItem(params.sessionId, params.queueItemId)
    },
    {
      detail: {
        'summary': 'Cancel a pending chat continuation queue item',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'cancel'],
        },
      },
      params: ChatRuntimeModel.queueItemParams,
      response: { 200: ChatRuntimeModel.queueItem },
    },
  )
  // PATCH /chat/sessions/:sessionId/queue/:queueItemId -> edit a pending queue item in place
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
        runtimeSettings: body.runtimeSettings,
      })
    },
    {
      detail: {
        'summary': 'Edit a pending chat continuation queue item in place',
        'x-cradle-cli': {
          command: ['chat', 'queue', 'update'],
        },
      },
      params: ChatRuntimeModel.queueItemParams,
      body: ChatRuntimeModel.queueUpdateBody,
      response: { 200: ChatRuntimeModel.queueItem },
    },
  )
  // POST /chat/sessions/:sessionId/cancel -> abort active run
  .post(
    '/sessions/:sessionId/cancel',
    async ({ params }) => {
      await (await loadChatRuntime()).cancelSession(params.sessionId)
      return { ok: true as const }
    },
    {
      detail: {
        'summary': 'Cancel active run for session',
        'x-cradle-cli': {
          command: ['chat', 'cancel'],
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.cancelResponse },
    },
  )
