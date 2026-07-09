# Pull Request Module

Owns session-bound GitHub pull request lifecycle for isolated agent work:

1. Push the isolated worktree branch
2. Open a **draft** PR on GitHub
3. Persist PR linkage on `sessions.configJson.github.pullRequest`
4. Refresh status and mark ready for review

Does **not** own merge, CI awaits, or Diff Review sync. Waiting for CI remains a user/agent decision via `session await`.

## Routes

| Method | Path | CLI | Notes |
|--------|------|-----|-------|
| `GET` | `/sessions/:id/pull-request` | `session pull-request get` | Bound PR + live refresh; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `POST` | `/sessions/:id/pull-request` | `session pull-request create` | Requires isolation; always draft; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `POST` | `/sessions/:id/pull-request/ready` | `session pull-request ready` | Converts draft → ready; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |

## Files

- **index.ts**: Elysia routes under `/sessions/:id/pull-request*` with `x-cradle-cli` metadata.
- **model.ts**: TypeBox request/response schemas.
- **service.ts**: Isolation checks, remote resolution, push, GitHub create/ready, `configJson` persistence.
- **github-remote.ts**: Parse `owner/repo` from GitHub HTTPS/SSH remote URLs.
