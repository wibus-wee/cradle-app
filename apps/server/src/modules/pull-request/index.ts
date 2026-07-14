import { Elysia } from 'elysia'

import { AppError } from '../../errors/app-error'
import { PullRequestModel } from './model'
import * as PullRequest from './service'

export const pullRequest = new Elysia({
  prefix: '/sessions',
  detail: { tags: ['session', 'pull-request'] },
})
  .get('/:id/pull-request', async ({ params }) => {
    const view = await PullRequest.getPullRequest(params.id)
    return { pullRequest: view }
  }, {
    detail: {
      'summary': 'Get session-bound GitHub pull request',
      'x-cradle-cli': {
        command: ['session', 'pull-request', 'get'],
        defaultChatSessionId: true,
      },
    },
    params: PullRequestModel.idParams,
    response: { 200: PullRequestModel.getResponse },
  })
  .get('/:id/pull-request/detail', async ({ params }) => {
    return await PullRequest.getPullRequestDetail(params.id)
  }, {
    detail: {
      'summary': 'Get live GitHub pull request details for a session-bound pull request',
      'x-cradle-cli': {
        command: ['session', 'pull-request', 'detail'],
        defaultChatSessionId: true,
      },
    },
    params: PullRequestModel.idParams,
    response: { 200: PullRequestModel.detailResponse },
  })
  .post('/:id/pull-request', async ({ params, body }) => {
    const pullRequest = await PullRequest.createDraftPullRequest({
      sessionId: params.id,
      title: body.title,
      body: body.body,
      base: body.base,
    })
    return { pullRequest }
  }, {
    detail: {
      'summary': 'Create a draft GitHub pull request for an isolated session',
      'x-cradle-cli': {
        command: ['session', 'pull-request', 'create'],
        defaultChatSessionId: true,
      },
    },
    params: PullRequestModel.idParams,
    body: PullRequestModel.createBody,
    response: { 200: PullRequestModel.mutationResponse },
  })
  .post('/:id/pull-request/ready', async ({ params }) => {
    const pullRequest = await PullRequest.markPullRequestReady(params.id)
    return { pullRequest }
  }, {
    detail: {
      'summary': 'Mark the session-bound pull request ready for review',
      'x-cradle-cli': {
        command: ['session', 'pull-request', 'ready'],
        defaultChatSessionId: true,
      },
    },
    params: PullRequestModel.idParams,
    response: { 200: PullRequestModel.mutationResponse },
  })

export const pullRequestFeed = new Elysia({
  prefix: '/pull-requests',
  detail: { tags: ['pull-request'] },
})
  .get('/viewer', async () => ({ viewer: await PullRequest.getViewerIdentity() }), {
    detail: {
      'summary': 'Get the authenticated GitHub identity the pull request feeds are scoped to',
      'x-cradle-cli': { command: ['pull-request', 'viewer'] },
    },
    response: { 200: PullRequestModel.viewerResponse },
  })
  .get('/authored', async ({ query }) => await PullRequest.listAuthoredPullRequests(query.login, query.after), {
    detail: {
      'summary': 'List pull requests authored by the given GitHub login, most recently updated first, paginated via `after`',
      'x-cradle-cli': { command: ['pull-request', 'authored'] },
    },
    query: PullRequestModel.searchPageQuery,
    response: { 200: PullRequestModel.searchPageResponse },
  })
  .get('/reviewing', async ({ query }) => await PullRequest.listReviewRequestedPullRequests(query.login, query.after), {
    detail: {
      'summary': 'List pull requests where the given GitHub login is a requested reviewer, most recently updated first, paginated via `after`',
      'x-cradle-cli': { command: ['pull-request', 'reviewing'] },
    },
    query: PullRequestModel.searchPageQuery,
    response: { 200: PullRequestModel.searchPageResponse },
  })
  .get('/:owner/:repo/:number/detail', async ({ params }) => {
    const number = Number(params.number)
    if (!Number.isInteger(number) || number <= 0) {
      throw new AppError({ code: 'invalid_pull_request_number', status: 400, message: 'Invalid pull request number.' })
    }
    return await PullRequest.fetchPullRequestDetailByRef(params.owner, params.repo, number)
  }, {
    detail: {
      'summary': 'Get live GitHub pull request details by owner/repo/number, independent of any Cradle session',
      'x-cradle-cli': { command: ['pull-request', 'detail'] },
    },
    params: PullRequestModel.refParams,
    response: { 200: PullRequestModel.detailResponse },
  })
