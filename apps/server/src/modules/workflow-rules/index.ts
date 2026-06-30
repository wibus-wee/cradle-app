import { Elysia, t } from 'elysia'

import { WorkflowRulesModel } from './model'
import * as WorkflowRules from './service'

export const workflowRules = new Elysia({
  prefix: '/workflow-rules',
  detail: { tags: ['workflow-rules'] },
})
  .get('/:workspaceId/list', ({ params }) => WorkflowRules.list(params.workspaceId), {
    detail: {
      'summary': 'List workflow rules',
      'x-cradle-cli': {
        command: ['workflow-rule', 'list'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkflowRulesModel.workspaceIdParams,
    response: { 200: t.Array(WorkflowRulesModel.workflowRuleEntry) },
  })
  .get('/:workspaceId', ({ params, query }) => WorkflowRules.get(params.workspaceId, query.agentId), {
    detail: {
      'summary': 'Get workflow rules',
      'x-cradle-cli': {
        command: ['workflow-rule', 'get'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkflowRulesModel.workspaceIdParams,
    query: WorkflowRulesModel.getQuery,
    response: { 200: WorkflowRulesModel.workflowRules },
  })
  .put('/:workspaceId', async ({ params, body }) => {
    await WorkflowRules.save(params.workspaceId, body.agentId ?? null, body.content)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Save workflow rule',
      'x-cradle-cli': {
        command: ['workflow-rule', 'save'],
        defaultWorkspaceId: true,
      },
    },
    params: WorkflowRulesModel.workspaceIdParams,
    body: WorkflowRulesModel.saveBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .delete('/:workspaceId', async ({ params, query }) => {
    await WorkflowRules.remove(params.workspaceId, query.agentId ?? null)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete workflow rule',
      'x-cradle-cli': {
        command: ['workflow-rule', 'delete'],
      },
    },
    params: WorkflowRulesModel.workspaceIdParams,
    query: WorkflowRulesModel.deleteQuery,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
