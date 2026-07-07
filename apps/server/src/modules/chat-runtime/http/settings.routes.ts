import { Elysia } from 'elysia'

import { ChatRuntimeModel } from '../model'
import { getSessionRuntimeSettings, updateSessionRuntimeSettings } from '../runtime-settings-api'
import { regenerateSessionTitle } from '../title-service'

export const chatRuntimeSettingsRoutes = new Elysia({
  detail: { tags: ['chat-runtime'] },
})
  // POST /chat/sessions/:sessionId/title/regenerate -> regenerate the persisted session title through the active runtime
  .post(
    '/sessions/:sessionId/title/regenerate',
    async ({ params }) => {
      return await regenerateSessionTitle(params.sessionId)
    },
    {
      detail: {
        summary: 'Regenerate chat session title',
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.regeneratedTitleResponse },
    },
  )
  // GET /chat/sessions/:sessionId/runtime-settings -> read Cradle-owned runtime controls
  .get(
    '/sessions/:sessionId/runtime-settings',
    async ({ params }) => {
      return getSessionRuntimeSettings(params.sessionId)
    },
    {
      detail: {
        'summary': 'Get runtime settings for a chat session',
        'x-cradle-cli': {
          command: ['chat', 'runtime-settings', 'get'],
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      response: { 200: ChatRuntimeModel.runtimeSettingsResponse },
    },
  )
  // PATCH /chat/sessions/:sessionId/runtime-settings -> update Cradle-owned runtime controls
  .patch(
    '/sessions/:sessionId/runtime-settings',
    async ({ params, body }) => {
      return await updateSessionRuntimeSettings({
        sessionId: params.sessionId,
        patch: body,
      })
    },
    {
      detail: {
        'summary': 'Update runtime settings for a chat session',
        'x-cradle-cli': {
          command: ['chat', 'runtime-settings', 'set'],
        },
      },
      params: ChatRuntimeModel.sessionIdParams,
      body: ChatRuntimeModel.runtimeSettingsBody,
      response: { 200: ChatRuntimeModel.runtimeSettingsResponse },
    },
  )
