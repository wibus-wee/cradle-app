import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { AgentIdentityModel } from './model'
import * as AgentIdentity from './service'

export const agentIdentity = new Elysia({
  prefix: '/agents',
  detail: { tags: ['agent-identity'] },
})
  .get('/', ({ query }) => {
    const enabled = query.enabled === 'true' ? true : query.enabled === 'false' ? false : undefined
    return AgentIdentity.list({
      enabled,
      providerTargetId: query.providerTargetId,
    })
  }, {
    detail: {
      'summary': 'List agents',
      'x-cradle-cli': {
        command: ['agent', 'list'],
      },
    },
    query: AgentIdentityModel.listQuery,
    response: { 200: t.Array(AgentIdentityModel.agent) },
  })
  .get('/:id', ({ params }) => {
    const agent = AgentIdentity.get(params.id)
    if (!agent) {
      throw new AppError({ code: 'agent_not_found', status: 404, message: 'Agent not found' })
    }
    return agent
  }, {
    detail: {
      'summary': 'Get agent by ID',
      'x-cradle-cli': {
        command: ['agent', 'get'],
      },
    },
    params: AgentIdentityModel.idParams,
    response: { 200: AgentIdentityModel.agent },
  })
  .post('/', ({ body }) => AgentIdentity.create(body), {
    detail: {
      'summary': 'Create agent',
      'x-cradle-cli': {
        command: ['agent', 'create'],
      },
    },
    body: AgentIdentityModel.createBody,
    response: { 200: AgentIdentityModel.agent },
  })
  .post('/import/local-config', ({ body }) => AgentIdentity.importLocalConfig(body ?? {}), {
    detail: {
      summary: 'Import agents from local Claude, Codex, Gemini, Pi, Kimi, and CC Switch config',
    },
    body: AgentIdentityModel.importLocalConfigBody,
    response: { 200: AgentIdentityModel.importLocalConfigResult },
  })
  .post('/import/local-config/preview', ({ body }) => AgentIdentity.previewLocalConfigImport(body ?? {}), {
    detail: {
      summary: 'Preview agents available from local Claude, Codex, Gemini, Pi, Kimi, and CC Switch config',
    },
    body: AgentIdentityModel.importLocalConfigBody,
    response: { 200: AgentIdentityModel.previewLocalConfigImportResult },
  })
  .patch('/:id', ({ params, body }) => {
    const agent = AgentIdentity.update(params.id, body)
    if (!agent) {
      throw new AppError({ code: 'agent_not_found', status: 404, message: 'Agent not found' })
    }
    return agent
  }, {
    detail: {
      'summary': 'Update agent',
      'x-cradle-cli': {
        command: ['agent', 'update'],
      },
    },
    params: AgentIdentityModel.idParams,
    body: AgentIdentityModel.updateBody,
    response: { 200: AgentIdentityModel.agent },
  })
  .delete('/:id', ({ params }) => {
    AgentIdentity.remove(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete agent',
      'x-cradle-cli': {
        command: ['agent', 'delete'],
      },
    },
    params: AgentIdentityModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
