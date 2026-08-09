import { Elysia } from 'elysia'

import { AppError } from '../../errors/app-error'
import * as ConsoleActions from './console-actions'
import { PullRequestModel } from './model'
import * as PullRequest from './service'

function parsePullRequestNumber(raw: string): number {
  const number = Number(raw)
  if (!Number.isInteger(number) || number <= 0) {
    throw new AppError({
      code: 'invalid_pull_request_number',
      status: 400,
      message: 'Invalid pull request number.',
    })
  }
  return number
}

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
  .get('/reviewing', async ({ query }) => await PullRequest.listReviewingPullRequests(query.login, query.after), {
    detail: {
      'summary': 'List pull requests where the given GitHub login is involved as a reviewer (requested or already reviewed), most recently updated first, paginated via `after`',
      'x-cradle-cli': { command: ['pull-request', 'reviewing'] },
    },
    query: PullRequestModel.searchPageQuery,
    response: { 200: PullRequestModel.searchPageResponse },
  })
  .post('/refresh', async ({ body }) => {
    await PullRequest.refreshPullRequestFeeds(body.login)
    return { refreshed: true as const }
  }, {
    detail: {
      'summary': 'Force-refresh the authenticated user\'s pull request feeds from GitHub',
      'x-cradle-cli': { command: ['pull-request', 'refresh'] },
    },
    body: PullRequestModel.feedRefreshBody,
    response: { 200: PullRequestModel.refreshResponse },
  })
  .get('/:owner/:repo/assignable-users', async ({ params }) => {
    return await ConsoleActions.listAssignableUsers(params.owner, params.repo)
  }, {
    detail: {
      'summary': 'List users who can be assigned to pull requests in this repository',
      'x-cradle-cli': { command: ['pull-request', 'assignable-users'] },
    },
    params: PullRequestModel.ownerRepoParams,
    response: { 200: PullRequestModel.assignableUsersResponse },
  })
  .get('/:owner/:repo/:number/detail', async ({ params }) => {
    return await PullRequest.fetchPullRequestDetailByRef(
      params.owner,
      params.repo,
      parsePullRequestNumber(params.number),
    )
  }, {
    detail: {
      'summary': 'Get live GitHub pull request details by owner/repo/number, independent of any Cradle session',
      'x-cradle-cli': { command: ['pull-request', 'detail'] },
    },
    params: PullRequestModel.refParams,
    response: { 200: PullRequestModel.detailResponse },
  })
  .post('/:owner/:repo/:number/refresh', async ({ params, body }) => {
    return await PullRequest.fetchPullRequestDetailByRef(
      params.owner,
      params.repo,
      parsePullRequestNumber(params.number),
      body.force === false ? 'probe' : 'force',
    )
  }, {
    detail: {
      'summary': 'Synchronously refresh pull request details from GitHub',
      'x-cradle-cli': { command: ['pull-request', 'detail', 'refresh'] },
    },
    params: PullRequestModel.refParams,
    body: PullRequestModel.detailRefreshBody,
    response: { 200: PullRequestModel.detailResponse },
  })
  .get('/:owner/:repo/:number/fingerprint', async ({ params }) => {
    return await ConsoleActions.getPullRequestFingerprint(
      params.owner,
      params.repo,
      parsePullRequestNumber(params.number),
    )
  }, {
    detail: {
      'summary': 'Get a cheap GitHub pull request fingerprint for cache-aware refresh',
      'x-cradle-cli': { command: ['pull-request', 'fingerprint'] },
    },
    params: PullRequestModel.refParams,
    response: { 200: PullRequestModel.fingerprintResponse },
  })
  .post('/:owner/:repo/:number/fingerprint/probe', async ({ params, body }) => {
    return await ConsoleActions.probePullRequestFingerprintChange(
      params.owner,
      params.repo,
      parsePullRequestNumber(params.number),
      body.previous ?? null,
    )
  }, {
    detail: {
      'summary': 'Probe GitHub for pull request fingerprint changes while the detail surface is visible',
      'x-cradle-cli': { command: ['pull-request', 'fingerprint', 'probe'] },
    },
    params: PullRequestModel.refParams,
    body: PullRequestModel.fingerprintProbeBody,
    response: { 200: PullRequestModel.fingerprintResponse },
  })
  .post('/:owner/:repo/:number/comment', async ({ params, body }) => {
    return await ConsoleActions.commentOnPullRequest({
      owner: params.owner,
      repo: params.repo,
      number: parsePullRequestNumber(params.number),
      body: body.body,
    })
  }, {
    detail: {
      'summary': 'Post an issue comment on a pull request',
      'x-cradle-cli': { command: ['pull-request', 'comment'] },
    },
    params: PullRequestModel.refParams,
    body: PullRequestModel.commentBody,
    response: { 200: PullRequestModel.commentResponse },
  })
  .post('/:owner/:repo/:number/review', async ({ params, body }) => {
    return await ConsoleActions.submitPullRequestReviewAction({
      owner: params.owner,
      repo: params.repo,
      number: parsePullRequestNumber(params.number),
      event: body.event,
      body: body.body,
    })
  }, {
    detail: {
      'summary': 'Submit a whole-PR GitHub review (approve, request changes, or comment)',
      'x-cradle-cli': { command: ['pull-request', 'review'] },
    },
    params: PullRequestModel.refParams,
    body: PullRequestModel.reviewBody,
    response: { 200: PullRequestModel.reviewResponse },
  })
  .post('/:owner/:repo/:number/merge', async ({ params, body }) => {
    return await ConsoleActions.mergePullRequestByRef({
      owner: params.owner,
      repo: params.repo,
      number: parsePullRequestNumber(params.number),
      mergeMethod: body.mergeMethod,
      commitTitle: body.commitTitle,
      commitMessage: body.commitMessage,
    })
  }, {
    detail: {
      'summary': 'Merge a pull request using a repository-allowed merge method',
      'x-cradle-cli': { command: ['pull-request', 'merge'] },
    },
    params: PullRequestModel.refParams,
    body: PullRequestModel.mergeBody,
    response: { 200: PullRequestModel.mergeResponse },
  })
  .post('/:owner/:repo/:number/assignees', async ({ params, body }) => {
    return await ConsoleActions.updatePullRequestAssignees({
      owner: params.owner,
      repo: params.repo,
      number: parsePullRequestNumber(params.number),
      add: body.add,
      remove: body.remove,
    })
  }, {
    detail: {
      'summary': 'Add or remove pull request assignees',
      'x-cradle-cli': { command: ['pull-request', 'assignees'] },
    },
    params: PullRequestModel.refParams,
    body: PullRequestModel.assigneesBody,
    response: { 200: PullRequestModel.peopleMutationResponse },
  })
  .post('/:owner/:repo/:number/reviewers', async ({ params, body }) => {
    return await ConsoleActions.updatePullRequestReviewers({
      owner: params.owner,
      repo: params.repo,
      number: parsePullRequestNumber(params.number),
      add: body.add,
      remove: body.remove,
    })
  }, {
    detail: {
      'summary': 'Request or remove pull request reviewers',
      'x-cradle-cli': { command: ['pull-request', 'reviewers'] },
    },
    params: PullRequestModel.refParams,
    body: PullRequestModel.reviewersBody,
    response: { 200: PullRequestModel.peopleMutationResponse },
  })
  .post('/:owner/:repo/:number/ready', async ({ params }) => {
    const pullRequest = await ConsoleActions.markPullRequestReadyByRef(
      params.owner,
      params.repo,
      parsePullRequestNumber(params.number),
    )
    return { pullRequest }
  }, {
    detail: {
      'summary': 'Mark a pull request ready for review by owner/repo/number',
      'x-cradle-cli': { command: ['pull-request', 'ready'] },
    },
    params: PullRequestModel.refParams,
    response: { 200: PullRequestModel.mutationResponse },
  })
  .post('/:owner/:repo/:number/draft', async ({ params }) => {
    const pullRequest = await ConsoleActions.markPullRequestDraftByRef(
      params.owner,
      params.repo,
      parsePullRequestNumber(params.number),
    )
    return { pullRequest }
  }, {
    detail: {
      'summary': 'Convert a pull request back to draft by owner/repo/number',
      'x-cradle-cli': { command: ['pull-request', 'draft'] },
    },
    params: PullRequestModel.refParams,
    response: { 200: PullRequestModel.mutationResponse },
  })
