import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { AcpModel } from './model'
import * as Acp from './service'

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_acp_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

export const acp = new Elysia({
  prefix: '/acp',
  detail: { tags: ['acp'] },
})
  .get('/registry', () => Acp.fetchRegistry(), {
    detail: {
      'summary': 'List registry agents',
      'x-cradle-cli': {
        command: ['acp', 'registry', 'list'],
      },
    },
    response: { 200: t.Array(AcpModel.registryAgent) },
  })
  .get('/registry/:agentId/distribution-types', ({ params }) => {
    return Acp.getDistributionTypes(requireNonBlankString(params.agentId, 'agentId'))
  }, {
    detail: {
      'summary': 'Get distribution types for a registry agent',
      'x-cradle-cli': {
        command: ['acp', 'registry', 'distribution-types'],
      },
    },
    params: AcpModel.agentIdParams,
    response: { 200: AcpModel.distributionTypesResult },
  })
  .get('/agents', () => Acp.listInstalled(), {
    detail: {
      'summary': 'List installed agents',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'list'],
      },
    },
    response: { 200: t.Array(AcpModel.acpAgent) },
  })
  .get('/agents/:agentId', ({ params }) => {
    const agent = Acp.getInstalled(requireNonBlankString(params.agentId, 'agentId'))
    if (!agent) {
      throw new AppError({ code: 'acp_agent_not_found', status: 404, message: 'Agent not installed' })
    }
    return agent
  }, {
    detail: {
      'summary': 'Get installed agent',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'get'],
      },
    },
    params: AcpModel.agentIdParams,
    response: { 200: AcpModel.acpAgent },
  })
  .put('/agents/:agentId/installation', ({ params, body }) => {
    return Acp.install(
      requireNonBlankString(params.agentId, 'agentId'),
      body.distributionType,
    )
  }, {
    detail: {
      'summary': 'Install an agent',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'install'],
      },
    },
    params: AcpModel.agentIdParams,
    body: AcpModel.installBody,
    response: { 200: AcpModel.acpAgent },
  })
  .delete('/agents/:agentId/installation', ({ params }) => {
    Acp.cancelInstall(requireNonBlankString(params.agentId, 'agentId'))
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Cancel agent installation',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'cancel-install'],
      },
    },
    params: AcpModel.agentIdParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .delete('/agents/:agentId', async ({ params }) => {
    await Acp.uninstall(requireNonBlankString(params.agentId, 'agentId'))
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Uninstall an agent',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'uninstall'],
      },
    },
    params: AcpModel.agentIdParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/audit', ({ query }) => {
    const agentId = query.agentId?.trim() || undefined
    return Acp.getAuditLog(agentId)
  }, {
    detail: {
      'summary': 'Get ACP audit log',
      'x-cradle-cli': {
        command: ['acp', 'audit'],
      },
    },
    query: AcpModel.auditQuery,
    response: { 200: t.Array(AcpModel.acpAuditEntry) },
  })
  .get('/agents/:agentId/install-path', ({ params }) => {
    return { path: Acp.getAgentInstallPath(requireNonBlankString(params.agentId, 'agentId')) }
  }, {
    detail: {
      'summary': 'Get agent install path',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'install-path'],
      },
    },
    params: AcpModel.agentIdParams,
    response: { 200: t.Object({ path: t.String() }) },
  })
