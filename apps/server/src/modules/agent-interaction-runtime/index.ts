import { Elysia, t } from 'elysia'

import { AgentInteractionRuntimeModel } from './model'
import * as AgentInteractionRuntime from './service'

export const agentInteractionRuntime = new Elysia({
  detail: { tags: ['agent-interaction-runtime'] },
})

  .get('/agent-sessions/:agentSessionId', ({ params }) =>
    AgentInteractionRuntime.requireSession(params.agentSessionId), {
    detail: {
      summary: 'Get agent session',
    },
    params: AgentInteractionRuntimeModel.agentSessionIdParams,
    response: { 200: AgentInteractionRuntimeModel.session },
  })

  .get('/agent-sessions/:agentSessionId/activities', ({ params }) =>
    AgentInteractionRuntime.listActivities(params.agentSessionId), {
    detail: {
      summary: 'List agent session activities',
    },
    params: AgentInteractionRuntimeModel.agentSessionIdParams,
    response: { 200: t.Array(AgentInteractionRuntimeModel.agentActivity) },
  })
