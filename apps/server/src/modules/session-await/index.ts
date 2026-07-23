import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { GitHubTargetValidationError } from '../../lib/github-api'
import { SessionAwaitModel } from './model'
import * as Poller from './poller'
import * as SessionAwait from './service'
import { cradleIssueAgentSource } from './sources/cradle-issue-agent'
import { cradleIssueStatusSource } from './sources/cradle-issue-status'
import { fetchLiveCIStatus, githubCISource } from './sources/github-ci'
import { fetchLiveReviewStatus, githubReviewSource } from './sources/github-review'
import { javascriptAwaitSource } from './sources/javascript'

export const sessionAwait = new Elysia({
  prefix: '/session-awaits',
  detail: { tags: ['session-await'] },
})
  .onStart(() => {
    Poller.registerSource(githubCISource)
    Poller.registerSource(githubReviewSource)
    Poller.registerSource(cradleIssueAgentSource)
    Poller.registerSource(cradleIssueStatusSource)
    Poller.registerSource(javascriptAwaitSource)
    Poller.start()
  })
  .onStop(() => { Poller.stop() })
  .post('/', async ({ body }) => {
    const row = await SessionAwait.register(body)
    Poller.requestRun()
    return row
  }, {
    detail: {
      'summary': 'Register a new session await',
      'x-cradle-cli': {
        command: ['session', 'await-create'],
        defaultChatSessionId: true,
      },
    },
    body: SessionAwaitModel.createBody,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .get('/:id', ({ params }) => {
    const row = SessionAwait.get(params.id)
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found' })
    }
    return row
  }, {
    detail: {
      'summary': 'Get session await by ID',
      'x-cradle-cli': {
        command: ['session', 'await-get'],
      },
    },
    params: SessionAwaitModel.idParams,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .get('/', ({ query }) => SessionAwait.listBySession(query.sessionId), {
    detail: {
      'summary': 'List session awaits',
      'x-cradle-cli': {
        command: ['session', 'await-list'],
        defaultChatSessionId: true,
      },
    },
    query: SessionAwaitModel.listQuery,
    response: { 200: t.Array(SessionAwaitModel.sessionAwait) },
  })
  .post('/:id/cancel', ({ params }) => {
    const row = SessionAwait.cancel(params.id)
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found or not pending' })
    }
    return row
  }, {
    detail: {
      'summary': 'Cancel a pending session await',
      'x-cradle-cli': {
        command: ['session', 'await-cancel'],
      },
    },
    params: SessionAwaitModel.idParams,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .post('/:id/trigger', async ({ params, body }) => {
    const row = await SessionAwait.trigger({
      awaitId: params.id,
      resumeText: body.resumeText,
      resumePayloadJson: body.resumePayloadJson,
    })
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found or not pending' })
    }
    return row
  }, {
    detail: {
      'summary': 'Manually trigger a session await',
      'x-cradle-cli': {
        command: ['session', 'await-trigger'],
      },
    },
    params: SessionAwaitModel.idParams,
    body: SessionAwaitModel.triggerBody,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .post('/:id/retry-delivery', async ({ params, body }) => {
    const row = await SessionAwait.retryDelivery({
      awaitId: params.id,
      resumeText: body.resumeText,
      resumePayloadJson: body.resumePayloadJson,
    })
    if (!row) {
      throw new AppError({ code: 'session_await_delivery_not_retryable', status: 409, message: 'Session await delivery is not retryable' })
    }
    return row
  }, {
    detail: {
      'summary': 'Retry delivery for a failed session await',
      'x-cradle-cli': {
        command: ['session', 'await-retry-delivery'],
      },
    },
    params: SessionAwaitModel.idParams,
    body: SessionAwaitModel.retryDeliveryBody,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .get('/summary', ({ query }) => SessionAwait.getSessionSummary(query.sessionId), {
    detail: {
      'summary': 'Get await summary for a session',
      'x-cradle-cli': {
        command: ['session', 'await-summary'],
        defaultChatSessionId: true,
      },
    },
    query: SessionAwaitModel.summaryQuery,
    response: { 200: SessionAwaitModel.summary },
  })
  .get('/discovered-repos', ({ query }) => SessionAwait.listDiscoveredRepos(query.workspaceId), {
    detail: { summary: 'List repos discovered from session awaits' },
    query: SessionAwaitModel.discoveredReposQuery,
    response: { 200: t.Array(t.String()) },
  })
  .get('/available-checks', async ({ query }) => SessionAwait.fetchAvailableChecks(query.owner, query.repo), {
    detail: { summary: 'Fetch available CI checks for a repo from GitHub' },
    query: SessionAwaitModel.availableChecksQuery,
    response: { 200: SessionAwaitModel.availableChecksResponse },
  })
  .post('/:id/bypass-check', ({ params, body }) => {
    const row = SessionAwait.bypassCheck(params.id, body.checkName)
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found or not pending' })
    }
    return row
  }, {
    detail: {
      summary: 'Bypass a non-required CI check for a session await',
    },
    params: SessionAwaitModel.idParams,
    body: SessionAwaitModel.bypassCheckBody,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .get('/:id/live-status', async ({ params }) => {
    const row = SessionAwait.get(params.id)
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found' })
    }
    try {
      if (row.source === 'github-ci') {
        const status = await fetchLiveCIStatus(row.filterJson)
        return status ? { supported: true as const, ...status } : { supported: false as const }
      }
      if (row.source === 'github-review') {
        const status = await fetchLiveReviewStatus(row.filterJson)
        return status ? { supported: true as const, ...status } : { supported: false as const }
      }
    }
    catch (err) {
      if (err instanceof GitHubTargetValidationError && err.category === 'invalid') {
        SessionAwait.markFailed(row.id, err.message)
        return {
          supported: false as const,
          error: {
            code: 'github_await_target_invalid',
            message: err.message,
          },
        }
      }
      throw err
    }
    return { supported: false as const }
  }, {
    detail: {
      summary: 'Get live status for a session await',
    },
    params: SessionAwaitModel.idParams,
  })
  // ── bypass rules ──
  .get('/bypass-rules', ({ query }) => SessionAwait.listBypassRules(query.workspaceId), {
    detail: { summary: 'List bypass rules for a workspace' },
    query: SessionAwaitModel.bypassRulesQuery,
    response: { 200: t.Array(SessionAwaitModel.bypassRule) },
  })
  .post('/bypass-rules', ({ body }) => SessionAwait.createBypassRule(body.workspaceId, body.repo, body.checkPattern), {
    detail: { summary: 'Create a bypass rule' },
    body: SessionAwaitModel.createBypassRuleBody,
    response: { 200: SessionAwaitModel.bypassRule },
  })
  .delete('/bypass-rules/:id', ({ params }) => {
    const deleted = SessionAwait.deleteBypassRule(params.id)
    if (!deleted) {
      throw new AppError({ code: 'bypass_rule_not_found', status: 404, message: 'Bypass rule not found' })
    }
    return { success: true }
  }, {
    detail: { summary: 'Delete a bypass rule' },
    params: SessionAwaitModel.idParams,
  })
  .patch('/bypass-rules/:id', ({ params, body }) => {
    const row = SessionAwait.toggleBypassRule(params.id, body.enabled)
    if (!row) {
      throw new AppError({ code: 'bypass_rule_not_found', status: 404, message: 'Bypass rule not found' })
    }
    return row
  }, {
    detail: { summary: 'Toggle a bypass rule' },
    params: SessionAwaitModel.idParams,
    body: SessionAwaitModel.toggleBypassRuleBody,
    response: { 200: SessionAwaitModel.bypassRule },
  })
