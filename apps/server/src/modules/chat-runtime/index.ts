import { Elysia } from 'elysia'

import { chatRuntimeDraftRoutes } from './http/draft.routes'
import { chatRuntimeHistoryRoutes } from './http/history.routes'
import { chatRuntimeInteractionRoutes } from './http/interaction.routes'
import { chatRuntimeIntrospectionRoutes } from './http/introspection.routes'
import { chatRuntimeLifecycleRoutes } from './http/lifecycle.routes'
import { chatRuntimeResponseRoutes } from './http/response.routes'
import { chatRuntimeSettingsRoutes } from './http/settings.routes'
import { chatRuntimeStreamRoutes } from './http/stream.routes'

export const chatRuntime = new Elysia({
  prefix: '/chat',
  detail: { tags: ['chat-runtime'] },
})
  .use(chatRuntimeDraftRoutes)
  .use(chatRuntimeIntrospectionRoutes)
  .use(chatRuntimeLifecycleRoutes)
  .use(chatRuntimeSettingsRoutes)
  .use(chatRuntimeResponseRoutes)
  .use(chatRuntimeInteractionRoutes)
  .use(chatRuntimeStreamRoutes)
  .use(chatRuntimeHistoryRoutes)
