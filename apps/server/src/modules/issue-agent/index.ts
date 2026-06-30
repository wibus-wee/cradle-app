import { Elysia, t } from 'elysia'

import { IssueAgentModel } from './model'
import * as IssueAgent from './service'

export const issueAgent = new Elysia({
  detail: { tags: ['issue-agent'] },
})

  // ── issue delegation ──

  .get('/issues/:id/delegation', ({ params }) =>
    IssueAgent.getDelegation(params.id), {
    detail: {
      'summary': 'Get delegation state',
      'x-cradle-cli': {
        command: ['issue', 'delegation'],
      },
    },
    params: IssueAgentModel.issueIdParams,
    response: { 200: IssueAgentModel.delegationState },
  })

  .post('/issues/:id/delegation', ({ params, body }) =>
    IssueAgent.delegateIssue({
      issueId: params.id,
      agentId: body.agentId,
      providerTargetId: body.providerTargetId,
    }), {
    detail: {
      'summary': 'Delegate issue',
      'x-cradle-cli': {
        command: ['issue', 'delegate'],
      },
    },
    params: IssueAgentModel.issueIdParams,
    body: IssueAgentModel.delegateBody,
    response: { 200: IssueAgentModel.sessionView },
  })

  .delete('/issues/:id/delegation', async ({ params }) => {
    await IssueAgent.undelegateIssue(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Undelegate issue',
      'x-cradle-cli': {
        command: ['issue', 'undelegate'],
      },
    },
    params: IssueAgentModel.issueIdParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  .get('/issues/:id/agent-sessions', ({ params }) =>
    IssueAgent.listSessions(params.id), {
    detail: {
      'summary': 'List agent sessions',
      'x-cradle-cli': {
        command: ['issue', 'sessions'],
      },
    },
    params: IssueAgentModel.issueIdParams,
    response: { 200: t.Array(IssueAgentModel.sessionView) },
  })

  // ── agent sessions ──

  .get('/issue-agent-sessions/:agentSessionId/activities', ({ params }) =>
    IssueAgent.listActivities(params.agentSessionId), {
    detail: {
      'summary': 'List activities',
      'x-cradle-cli': {
        command: ['issue-agent-session', 'activities'],
      },
    },
    params: IssueAgentModel.agentSessionIdParams,
    response: { 200: t.Array(IssueAgentModel.agentActivity) },
  })

  .post('/issue-agent-sessions/:agentSessionId/continuation', ({ params, body }) =>
    IssueAgent.enqueueContinuation({
      agentSessionId: params.agentSessionId,
      mode: body.mode,
      text: body.text,
    }), {
    detail: {
      summary: 'Enqueue a Chat Session continuation for an issue agent session',
    },
    params: IssueAgentModel.agentSessionIdParams,
    body: IssueAgentModel.continuationBody,
    response: { 200: IssueAgentModel.continuationResponse },
  })

  .post('/issue-agent-sessions/:agentSessionId/rerun', ({ params }) =>
    IssueAgent.rerunSession({
      agentSessionId: params.agentSessionId,
    }), {
    detail: {
      'summary': 'Rerun session',
      'x-cradle-cli': {
        command: ['issue-agent-session', 'rerun'],
      },
    },
    params: IssueAgentModel.agentSessionIdParams,
    body: t.Optional(IssueAgentModel.rerunBody),
    response: { 200: IssueAgentModel.sessionView },
  })

  .delete('/issue-agent-sessions/:agentSessionId', async ({ params }) => {
    await IssueAgent.stopSession(params.agentSessionId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Stop agent session',
      'x-cradle-cli': {
        command: ['issue-agent-session', 'stop'],
      },
    },
    params: IssueAgentModel.agentSessionIdParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
