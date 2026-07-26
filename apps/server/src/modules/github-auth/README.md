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

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/github-auth/connection` | Safe connection and viewer projection |
| `POST` | `/github-auth/device-login` | Starts local Device Flow |
| `GET` | `/github-auth/device-login/:loginId` | Polls the safe login status |
| `POST` | `/github-auth/device-login/:loginId/cancel` | Cancels a pending login |
| `DELETE` | `/github-auth/connection` | Removes only the local credential |
