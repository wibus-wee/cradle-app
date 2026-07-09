import { Elysia } from 'elysia'

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
