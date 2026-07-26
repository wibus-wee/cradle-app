import { t } from 'elysia'

const connectionState = t.Union([
  t.Literal('unconfigured'),
  t.Literal('disconnected'),
  t.Literal('pending'),
  t.Literal('connected'),
  t.Literal('expired'),
  t.Literal('error'),
])

const loginState = t.Union([
  t.Literal('pending'),
  t.Literal('completed'),
  t.Literal('failed'),
  t.Literal('cancelled'),
])

export const GitHubAuthModel = {
  viewer: t.Object({
    login: t.String(),
    avatarUrl: t.Union([t.String(), t.Null()]),
    profileUrl: t.Union([t.String(), t.Null()]),
  }),
  connection: t.Object({
    state: connectionState,
    appName: t.Union([t.String(), t.Null()]),
    appSlug: t.Union([t.String(), t.Null()]),
    installationUrl: t.Union([t.String(), t.Null()]),
    viewer: t.Union([
      t.Object({
        login: t.String(),
        avatarUrl: t.Union([t.String(), t.Null()]),
        profileUrl: t.Union([t.String(), t.Null()]),
      }),
      t.Null(),
    ]),
    expiresAt: t.Union([t.Number(), t.Null()]),
    refreshTokenExpiresAt: t.Union([t.Number(), t.Null()]),
    error: t.Union([t.String(), t.Null()]),
  }),
  deviceLoginStart: t.Object({
    loginId: t.String(),
    verificationUri: t.String(),
    userCode: t.String(),
    expiresAt: t.Number(),
    pollInterval: t.Number(),
  }),
  deviceLogin: t.Object({
    loginId: t.String(),
    state: loginState,
    startedAt: t.Number(),
    completedAt: t.Union([t.Number(), t.Null()]),
    error: t.Union([t.String(), t.Null()]),
  }),
  loginParams: t.Object({ loginId: t.String({ minLength: 1 }) }),
  ok: t.Object({ ok: t.Literal(true) }),
}
