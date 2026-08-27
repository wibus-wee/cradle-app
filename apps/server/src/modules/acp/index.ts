import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { getRuntimeRegistry } from '../chat-runtime/chat-runtime-provider-registry'
import { AcpChatProvider } from '../chat-runtime-providers/acp/provider'
import * as Secrets from '../secrets/service'
import * as Workspace from '../workspace/service'
import { AcpModel } from './model'
import type { AcpDownloadCenter } from './service'
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

function requireAcpRuntime(): AcpChatProvider {
  const runtime = getRuntimeRegistry().get('acp-chat')
  if (!(runtime instanceof AcpChatProvider)) {
    throw new AppError({ code: 'acp_runtime_not_available', status: 501, message: 'ACP Chat runtime is not available' })
  }
  return runtime
}

export function createAcpModule(downloadCenter: AcpDownloadCenter) {
  return new Elysia({
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
  .post('/agents', ({ body }) => {
    return Acp.createLocalAgent({
      id: body.id,
      name: body.name,
      cmd: body.cmd,
      args: body.args,
      env: body.env,
      distributionType: body.distributionType,
      version: body.version,
    })
  }, {
    detail: {
      'summary': 'Register a local ACP agent',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'create'],
      },
    },
    body: AcpModel.createLocalAgentBody,
    response: { 200: AcpModel.acpAgent },
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
  .get('/agents/:agentId/auth-methods', async ({ params }) => {
    const agentId = requireNonBlankString(params.agentId, 'agentId')
    const selection = Acp.readAgentAuthConfig(agentId)
    const methods = await requireAcpRuntime().listAgentAuthMethods(agentId)
    return { methods, selectedMethodId: selection.methodId }
  }, {
    detail: {
      'summary': 'List ACP agent authentication methods',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'auth-methods'],
      },
    },
    params: AcpModel.agentIdParams,
    response: { 200: AcpModel.authMethodsResult },
  })
  .put('/agents/:agentId/auth', async ({ params, body }) => {
    const agentId = requireNonBlankString(params.agentId, 'agentId')
    const runtime = requireAcpRuntime()
    Acp.readAgentAuthConfig(agentId)
    const availableSecretIds = body.secretRefs && Object.keys(body.secretRefs).length > 0
      ? new Set(Secrets.listSecrets().map(secret => secret.id))
      : new Set<string>()
    const methods = await runtime.listAgentAuthMethods(agentId)
    const selection = Acp.setAgentAuthSelection(agentId, {
      methodId: body.methodId,
      secretRefs: body.secretRefs,
    }, methods, availableSecretIds)
    await runtime.reconnectAgent(agentId)
    return { selectedMethodId: selection.methodId }
  }, {
    detail: {
      'summary': 'Select and authenticate an ACP agent method',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'auth-set'],
      },
    },
    params: AcpModel.agentIdParams,
    body: AcpModel.authSelectionBody,
    response: { 200: AcpModel.authSelectionResult },
  })
  .delete('/agents/:agentId/auth', async ({ params }) => {
    const agentId = requireNonBlankString(params.agentId, 'agentId')
    const runtime = requireAcpRuntime()
    Acp.clearAgentAuthSelection(agentId)
    await runtime.disconnectAgent(agentId)
    return { selectedMethodId: null }
  }, {
    detail: {
      'summary': 'Clear an ACP agent authentication selection',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'auth-clear'],
      },
    },
    params: AcpModel.agentIdParams,
    response: { 200: AcpModel.authSelectionResult },
  })
  .patch('/agents/:agentId/launch-config', ({ params, body }) => {
    return Acp.updateLaunchConfig(requireNonBlankString(params.agentId, 'agentId'), {
      name: body.name,
      overrideCmd: body.overrideCmd,
      overrideArgs: body.overrideArgs,
      overrideEnv: body.overrideEnv,
      cmd: body.cmd,
      args: body.args,
      env: body.env,
      distributionType: body.distributionType,
      version: body.version,
    })
  }, {
    detail: {
      'summary': 'Update ACP agent launch config (local base or registry overrides)',
      'x-cradle-cli': {
        command: ['acp', 'agent', 'launch-config'],
      },
    },
    params: AcpModel.agentIdParams,
    body: AcpModel.launchConfigBody,
    response: { 200: AcpModel.acpAgent },
  })
  .post('/agents/:agentId/draft-session', ({ params, body }) => {
    const agentId = requireNonBlankString(params.agentId, 'agentId')
    const agent = Acp.getInstalled(agentId)
    if (!agent || agent.status !== 'installed') {
      throw new AppError({ code: 'acp_agent_not_found', status: 404, message: 'Installed ACP agent not found' })
    }
    const workspacePath = body.workspaceId ? Workspace.getLocalWorkspacePath(body.workspaceId) : ''
    if (body.workspaceId && !workspacePath) {
      throw new AppError({
        code: 'acp_workspace_not_available',
        status: 409,
        message: 'ACP draft sessions require a local workspace',
        details: { workspaceId: body.workspaceId },
      })
    }
    const runtime = requireAcpRuntime()
    return runtime.openDraftSession({ agentId, workspacePath: workspacePath ?? '' })
  }, {
    detail: { summary: 'Open an ACP draft session and read its native model choices' },
    params: AcpModel.agentIdParams,
    body: AcpModel.draftSessionBody,
    response: { 200: AcpModel.draftSessionResult },
  })
  .put('/agents/:agentId/installation', ({ params, body }) => {
    return Acp.install(
      requireNonBlankString(params.agentId, 'agentId'),
      body.distributionType,
      downloadCenter,
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
    Acp.cancelInstall(requireNonBlankString(params.agentId, 'agentId'), downloadCenter)
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
}
