import type { GithubAppConnection, GithubAppPendingLogin } from '../github-app-connection-view'

export const disconnectedGithubAppConnection: GithubAppConnection = {
  state: 'disconnected',
  appName: 'Cradle',
  appSlug: 'cradleapp',
  installationUrl: 'https://github.com/apps/cradleapp/installations/new',
  viewer: null,
  expiresAt: null,
  error: null,
}

export const pendingGithubAppLogin: GithubAppPendingLogin = {
  loginId: 'login-1',
  verificationUri: 'https://github.com/login/device',
  userCode: 'ABCD-EFGH',
  expiresAt: 1_785_000_000,
}

export const connectedGithubAppConnection: GithubAppConnection = {
  state: 'connected',
  appName: 'Cradle',
  appSlug: 'cradleapp',
  installationUrl: 'https://github.com/apps/cradleapp/installations/new',
  viewer: { login: 'octocat', avatarUrl: null, profileUrl: 'https://github.com/octocat' },
  expiresAt: 1_785_000_000,
  error: null,
}

export const expiredGithubAppConnection: GithubAppConnection = {
  ...connectedGithubAppConnection,
  state: 'expired',
  error: 'Your GitHub connection has expired. Connect again to continue.',
}

export const unconfiguredGithubAppConnection: GithubAppConnection = {
  state: 'unconfigured',
  appName: null,
  appSlug: null,
  installationUrl: null,
  viewer: null,
  expiresAt: null,
  error: 'GitHub App is not configured in this build.',
}
