# GitHub Auth Module

Owns the local GitHub App user connection: Device Flow lifecycle, encrypted
credential persistence, token refresh, selected-user identity, and safe
connection projections. Credentials are stored only through the Secrets module
under the fixed hidden `system:github-app-user` record.

The module never returns access tokens, refresh tokens, device codes, or
encrypted credential data. It is composed into the generic GitHub client via
the technical auth-provider port in `app.ts`; Pull Request, Diff Review,
Session Await, and GitHub Issues consume that shared client and do not own
credentials.

The shared client checks the connected App user's installations before a
repository-scoped operation. If the App installation does not include that
repository, Cradle uses the local `GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth token`
credential for that repository. An expired or revoked App user connection
still fails closed and requires reconnection.

## Ambient local credential projection

`local-credential.ts` probes whether an ambient local GitHub credential exists
(env `GH_TOKEN`/`GITHUB_TOKEN`, or an authenticated gh CLI) and resolves the
owning login through `gh api user`. The connection projection carries only
`available` / `login` / `source` so web clients can unlock GitHub-backed
features without the App user connection. The probe never returns the token
itself, caches for 30 seconds, and treats network failure during login
resolution as unknown-login rather than unavailable.

When no App user is connected, GitHub operations run as the ambient local
credential and appear on GitHub as plain user actions without the Cradle App
badge.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/github-auth/connection` | Safe connection and viewer projection |
| `POST` | `/github-auth/device-login` | Starts local Device Flow |
| `GET` | `/github-auth/device-login/:loginId` | Polls the safe login status |
| `POST` | `/github-auth/device-login/:loginId/cancel` | Cancels a pending login |
| `DELETE` | `/github-auth/connection` | Removes only the local credential |
