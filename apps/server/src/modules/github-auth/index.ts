import { Elysia } from 'elysia'

import { GitHubAuthModel } from './model'
import * as GitHubAuth from './service'

export const githubAuth = new Elysia({
  prefix: '/github-auth',
  detail: { tags: ['github-auth'] },
})
  .get('/connection', () => GitHubAuth.getGitHubAppConnection(), {
    detail: { summary: 'Read GitHub App connection' },
    response: { 200: GitHubAuthModel.connection },
  })
  .post('/device-login', () => GitHubAuth.startGitHubDeviceLogin(), {
    detail: { summary: 'Start GitHub App device authorization' },
    response: { 200: GitHubAuthModel.deviceLoginStart },
  })
  .get('/device-login/:loginId', ({ params }) => GitHubAuth.getGitHubDeviceLogin(params.loginId), {
    detail: { summary: 'Read GitHub App device authorization' },
    params: GitHubAuthModel.loginParams,
    response: { 200: GitHubAuthModel.deviceLogin },
  })
  .post('/device-login/:loginId/cancel', ({ params }) => GitHubAuth.cancelGitHubDeviceLogin(params.loginId), {
    detail: { summary: 'Cancel GitHub App device authorization' },
    params: GitHubAuthModel.loginParams,
    response: { 200: GitHubAuthModel.ok },
  })
  .delete('/connection', () => GitHubAuth.disconnectGitHubApp(), {
    detail: { summary: 'Disconnect GitHub App user identity' },
    response: { 200: GitHubAuthModel.ok },
  })
