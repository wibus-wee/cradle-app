# Plan 064: Connect GitHub through the Cradle App and attribute PR actions to the user

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0557059c..HEAD -- apps/server/src/app.ts apps/server/src/config apps/server/src/lib/github-api-token.ts apps/server/src/lib/github-api.ts apps/server/src/lib/github apps/server/src/modules/github-auth apps/server/src/modules/secrets apps/server/src/modules/pull-request apps/server/src/modules/diff-review apps/server/src/modules/session-await apps/server/src/modules/external-issue-sources plugins/github-issues apps/web/src/features/settings apps/web/src/locales apps/web/src/api-gen`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. This plan was written while the
> working tree already had uncommitted Pull Request Console and generated-web
> changes. Do not overwrite, fold in, or discard those changes; execute only
> after their owner has committed them or deliberately rebased this plan.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none; the current uncommitted PR Console work must first be reconciled
- **Category**: direction
- **Planned at**: commit `0557059c`, 2026-07-25

## Why this matters

Cradle can already create PRs, comments, reviews, inline review threads,
await GitHub CI/reviews, and refresh GitHub Issues, but it authenticates those
operations from `GH_TOKEN`, `GITHUB_TOKEN`, or the local `gh` CLI. That makes
product actions ordinary user/PAT actions; GitHub has no way to display the
Cradle App badge beside the user's avatar.

Registering Cradle as a GitHub App and using a GitHub App **user-to-server**
token changes the attribution without centralizing user credentials: the
Desktop-owned local server runs GitHub's Device Flow, stores the credential
locally, and talks directly to GitHub. GitHub then attributes comments and
reviews to the user together with the Cradle App badge. The token must remain
local and must never enter an HTTP response, generated client, renderer state,
log, cache key, or plugin diagnostics.

## Current state

All paths are relative to repo root. The product is a TypeScript pnpm
monorepo: `apps/server` is an Elysia server, `apps/web` is React + TanStack
Query, and Desktop starts the server locally. Root verification commands are
declared in `package.json`; server modules use Elysia + TypeBox and a
`model.ts` / `service.ts` / `index.ts` ownership split. The product statement
in `README.md` promises desktop-first, local control and no cloud dependency;
do not add a Cradle-hosted OAuth callback, token store, webhook receiver, or
background worker.

- `apps/server/src/lib/github-api-token.ts` owns the current implicit token
  lookup. Its complete behavior is: process `GH_TOKEN` / `GITHUB_TOKEN`, then
  `gh auth token`, then a process-global null cache. This is the identity path
  that must be superseded for connected users.
  ```ts
  export function resolveGitHubToken(): string | null {
    const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
    // otherwise: execSync('gh auth token', ...)
  }
  ```
- `apps/server/src/lib/github/client.ts` constructs one cached Octokit with a
  synchronous token resolver. `getOctokit({ requireToken: true })` currently
  throws a GitHub auth error before every authenticated GraphQL/mutation call.
  A Device Flow credential can need a refresh, so this boundary must become
  asynchronous and credential-aware; do not import a business module into this
  low-level library.
- `apps/server/src/lib/github-api.ts` is the shared GitHub REST/GraphQL API
  boundary. It is consumed by Pull Request, Diff Review, Session Await and
  external issue source code. `fetchAuthenticatedUser` currently derives a
  cache key from the first characters of the token:
  ```ts
  cacheKey: `viewer:${resolveGitHubToken()?.slice(0, 8) ?? 'anon'}`
  ```
  Replace this with a non-secret credential/identity key.
- `apps/server/src/modules/pull-request/console-actions.ts` already posts the
  PR conversation comment through `createPullRequestIssueComment`; the route
  exists at `apps/server/src/modules/pull-request/index.ts` as
  `POST /pull-requests/:owner/:repo/:number/comment`. Once the shared client
  chooses an App user token, no separate comment implementation is needed.
- `apps/server/src/modules/diff-review/service.ts`,
  `apps/server/src/modules/session-await/sources/github-ci.ts`,
  `apps/server/src/modules/session-await/sources/github-review.ts`, and
  `apps/server/src/modules/external-issue-sources/service.ts` call the same
  shared GitHub boundary. The external-issue service currently injects a
  synchronous `resolveGitHubToken()` result into the `github-issues` plugin's
  `GITHUB_ISSUES_TOKEN` shared config; its call site is already inside an async
  refresh operation and can await a token provider.
- `apps/server/src/modules/secrets/service.ts` persists encrypted local
  credentials in `agent_credentials`; its existing ChatGPT device-login flow
  is the correct storage pattern. `apps/server/src/modules/chat-runtime-providers/codex/app-server/account-service.ts`
  demonstrates a local `start → poll → completed/failed/cancelled` Device Flow
  service with a test-only fetch seam. It is an interaction exemplar only;
  GitHub auth belongs in its own module, not under a Chat runtime provider.
- `apps/desktop/src/main/server-process.ts` starts the local server and gives
  it `CRADLE_CREDENTIAL_SECRET`. `apps/web/src/features/agent-management/use-chatgpt-credential-login.ts`
  demonstrates opening a verification URL through `nativeIpc.native.openExternal`
  with a safe browser fallback. Reuse that browser-opening behavior, not an
  OAuth redirect callback.
- Settings is owned by `apps/web/src/features/settings`. The existing
  `IntegrationsSettings` container is large; do not add more product logic to
  it. Add a props-only `*View`, fixtures, and Storybook story, then let a small
  settings container own generated-client queries/mutations. This follows the
  repository's fixture-driven rendering seam convention. Reuse
  `SettingsPage`/`SettingsGroup` from `settings-container.tsx`, static Tailwind
  classes, and `cn()` for class composition.
- Server routes are composed in `apps/server/src/app.ts`. Any new Elysia route
  must use TypeBox request/response models and appears in the Web client only
  after `pnpm generate:web`. Do not hand-edit `apps/web/src/api-gen/**`.

Git history uses conventional commits (for example,
`45eaaf3e feat(diffs): complete local and GitHub review workflows`). The
server's error convention is `throw new AppError({ code, status, message,
details? })`; match it exactly.

## Commands you will need

Run all commands from the repository root.

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0, no TypeScript or boundary errors |
| Focused server tests | `pnpm exec vitest run apps/server/src/modules/github-auth apps/server/src/lib/github-api.test.ts apps/server/src/modules/pull-request/service.test.ts apps/server/tests/diff-review.test.ts apps/server/tests/session-await-github.test.ts apps/server/tests/external-issue-sources.test.ts` | all selected tests pass |
| Generate Web API client | `pnpm generate:web` | exit 0; only generated OpenAPI client files change |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Focused Web tests | `pnpm --filter @cradle/web test -- src/features/settings/github-app-connection-view.test.tsx` | all selected tests pass |
| Web localization checks | `pnpm --filter @cradle/web i18n:ci` | exit 0 |
| Changed-area lint | `pnpm exec eslint apps/server/src/config apps/server/src/lib/github-api.ts apps/server/src/lib/github apps/server/src/modules/github-auth apps/server/src/modules/pull-request apps/server/src/modules/diff-review apps/server/src/modules/session-await apps/server/src/modules/external-issue-sources apps/web/src/features/settings` | exit 0 |
| Full verification | `pnpm test && pnpm --filter @cradle/web test && pnpm typecheck` | all suites/typechecks exit 0 |

## Suggested executor toolkit

- Use `server-app-development` for the Elysia module, TypeBox contracts,
  OpenAPI route registration, and module README.
- Use `vercel-react-best-practices` and `make-interfaces-feel-better` when
  implementing the fixture-driven settings surface.
- Read GitHub's official [GitHub App Device Flow guide](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app), [user access token guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), and [user-to-server attribution guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user) before writing request code.

## Scope

**In scope** (the only files you should modify or create):

- `apps/server/src/app.ts`
- `apps/server/src/config/github-app.ts` (new, non-secret App configuration)
- `apps/server/src/lib/github-api-token.ts`
- `apps/server/src/lib/github-api.ts` and `apps/server/src/lib/github-api.test.ts`
- `apps/server/src/lib/github/client.ts` and `apps/server/src/lib/github/cache-gate.ts`
- `apps/server/src/lib/github/auth-provider.ts` (new technical port)
- `apps/server/src/modules/github-auth/index.ts` (new)
- `apps/server/src/modules/github-auth/model.ts` (new)
- `apps/server/src/modules/github-auth/service.ts` (new)
- `apps/server/src/modules/github-auth/service.test.ts` (new)
- `apps/server/src/modules/github-auth/README.md` (new)
- `apps/server/src/modules/pull-request/service.ts`, `console-actions.ts`, and `README.md`
- `apps/server/src/modules/diff-review/service.ts` and `README.md`
- `apps/server/src/modules/session-await/sources/github-ci.ts`, `sources/github-review.ts`, and `README.md`
- `apps/server/src/modules/external-issue-sources/service.ts` and `README.md`
- `plugins/github-issues/README.md`
- `apps/web/src/features/settings/integrations-settings.tsx`
- `apps/web/src/features/settings/github-app-connection.tsx` (new Container)
- `apps/web/src/features/settings/github-app-connection-view.tsx` (new View)
- `apps/web/src/features/settings/github-app-connection-view.stories.tsx` (new)
- `apps/web/src/features/settings/github-app-connection-view.test.tsx` (new)
- `apps/web/src/features/settings/fixtures/github-app-connection.ts` (new)
- `apps/web/src/locales/default/settings.ts` and every shipped `apps/web/src/locales/*/settings.json`
- `apps/web/src/api-gen/**` (generated only, through `pnpm generate:web`)
- `plans/README.md`

**Out of scope** (do NOT touch):

- GitHub App private keys, client secrets, webhooks, Marketplace publishing,
  a hosted callback endpoint, or any Cradle cloud credential storage. Device
  Flow needs the public client ID only.
- Git remote URL rewriting, Git credential-helper configuration, SSH keys, or
  local `git push` authentication. The badge applies to API actions; existing
  branch pushes remain local Git behavior.
- New database tables or Drizzle migrations. Store one encrypted,
  versioned `github-app-user` credential in the existing `agent_credentials`
  owner, as ChatGPT auth does today.
- Changes to the existing generic Secrets UI or any endpoint that reveals raw
  credentials.
- Changes to the unrelated uncommitted Chat transcript or PR Console work.
- Automatic/background PR reviewing while Cradle is closed. That is a separate
  server-to-server bot/webhook product and would not have user-plus-App badge
  attribution.

## Git workflow

- Branch: `feat/github-app-user-identity`.
- Keep the external GitHub App registration/configuration in a separate first
  commit or an operator-run prerequisite record; then use conventional commits
  such as `feat(github): add app device authorization` and
  `feat(settings): connect GitHub App identity`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Register and configure the external GitHub App before code integration

An organization owner must register a **public** GitHub App owned by
`cradleagent` (Marketplace listing is not required). Name it `Cradle` unless
that name is unavailable; record its App slug and public client ID. Upload the
Cradle logo and set the badge background in GitHub App settings. Enable Device
Flow and opt in to expiring user-to-server tokens. Grant only:

- mandatory `Metadata: read`;
- `Contents: read` for PR head commit identity and check-rollup status in the
  global pull request feeds;
- `Issues: read/write` for PR conversation comments and assignees;
- `Pull requests: read/write` for reviews, inline threads, reviewers, draft
  changes, and PR mutations.

Do not create a private key, do not configure a webhook URL, and do not put a
client secret in a release artifact. Store the public client ID and app slug
in the new typed server config with an environment override only for local
development/test. Production Desktop must ship the public client ID as normal
application configuration, not require the user to set an environment
variable.

**Verify**: From GitHub App settings, confirm Device Flow is enabled, the App
is installable by an external organization, the permission list matches the
four entries above, and the App profile shows the intended badge. Record only
the App slug/client ID in the implementation notes; never record a secret.

### Step 2: Add a GitHub-auth owner with Device Flow and encrypted local state

Create `modules/github-auth` as the sole owner of Cradle GitHub App connection
semantics. Its route contract should expose only safe projections:

- `GET /github-auth/connection` returns configured/disconnected/pending/
  connected/expired/error state, the public app name/slug, installation URL,
  current GitHub login/avatar/profile URL when known, token expiry metadata,
  and a user-actionable error string. It never returns device codes, access
  tokens, refresh tokens, or encrypted values.
- `POST /github-auth/device-login` starts one local pending login and returns
  `loginId`, `verificationUri`, `userCode`, `expiresAt`, and poll interval.
- `GET /github-auth/device-login/:loginId` returns only the pending/completed/
  failed/cancelled status projection.
- `POST /github-auth/device-login/:loginId/cancel` aborts a pending flow.
- `DELETE /github-auth/connection` deletes the selected local credential and
  invalidates the GitHub client/cache. It must not revoke an App installation
  on GitHub.

Use `POST https://github.com/login/device/code` with the configured public
client ID; poll `POST https://github.com/login/oauth/access_token` with the
device-code grant and GitHub's supplied interval. Correctly handle
`authorization_pending`, `slow_down`, expiry, cancellation, denial, and
network errors. On completion, fetch `/user`/viewer identity using the new
token before reporting success. Persist a versioned JSON value under the
existing encrypted Secrets store with kind `github-app-user`, containing only
the access token, optional refresh token, expiry times, and non-secret viewer
metadata. Replace an existing selected GitHub App credential atomically rather
than accumulating ambiguous active credentials.

Use the fixed local credential ID `system:github-app-user` and the hidden
Secrets kind `system-github-app-user`; call the existing
`Secrets.upsertSecret` / `Secrets.readSecret` / `Secrets.removeSecret`
operations instead of querying or encrypting `agent_credentials` directly.
The fixed ID makes replacement and removal unambiguous without a schema
migration, and the `system-` kind prevents this internal credential from
appearing in the generic Secrets list.

When a token is near expiry, refresh it with the device-flow refresh grant and
the public client ID. Persist the rotated value with that same fixed ID before
returning it. If refresh is rejected, mark the connection expired and require
a new Device Flow; do not silently fall back to another identity for a
user-initiated API write.

Follow the test seam in `account-service.ts`: inject a fetch implementation
only via an explicit test setter and clear pending state after every test. Add
`AppError` codes for unavailable App configuration, missing connection,
expired/revoked connection, duplicate active flow, and invalid login ID.

**Verify**: `pnpm exec vitest run apps/server/src/modules/github-auth/service.test.ts`
passes tests for start payload, pending/slow-down polling, cancellation,
expiry, success persistence, refresh rotation, refresh rejection, disconnect,
and a guarantee that status responses contain no token-shaped values.

### Step 3: Make the shared GitHub client consume an explicit asynchronous auth port

Add `lib/github/auth-provider.ts` as a technology-layer port, not a dependency
on `modules/github-auth`. The port must return an asynchronous
`{ accessToken, cacheKey, source }` identity or `null`, where `cacheKey` is a
stable non-secret credential ID/version. `app.ts` wires the GitHub-auth module
implementation into this port after the database is initialized. Tests reset
the provider explicitly.

Refactor `github-api-token.ts`, `github/client.ts`, `github/cache-gate.ts`,
and `github-api.ts` so every authenticated Octokit request awaits this port.
Keep existing `GH_TOKEN` / `GITHUB_TOKEN` / `gh auth` lookup as an explicit
legacy-development fallback only when no Cradle App connection exists. Never
fall back after a connected App credential has expired, been revoked, or
failed refresh: return `github_auth_required` with a Connect GitHub App
message instead. This preserves existing headless development and plugin
setup without allowing a stale App connection to silently lose badge
attribution.

Make cache/rate-limit state identity-safe:

- replace `viewer:${token.slice(...)}` with the port's non-secret cache key;
- namespace all authenticated GitHub cache and in-flight keys by that same
  identity key, or clear every GitHub cache/in-flight entry on connect,
  refresh, disconnect, and identity change;
- cache no bearer token or request authorization header;
- preserve unauthenticated public reads when no identity is configured.

Update all callers of synchronous `hasGitHubToken`/`resolveGitHubToken` to
await an explicit availability/access-token operation. Cover Pull Request,
Diff Review, both GitHub Session Await sources, and External Issue Sources.
Make `createExternalIssueSourceSharedConfig` asynchronous so the GitHub Issues
plugin receives the App user token when connected; its explicit
`CRADLE_GITHUB_ISSUES_TOKEN` configuration must retain documented precedence.

Do not let `github-api` import `modules/github-auth`; the application
composition root is the only place where the owner implementation crosses into
the generic API boundary.

**Verify**: Run the focused server test command. Add assertions that a
connected App token is selected ahead of a legacy environment token, an expired
App token produces an auth-required error rather than fallback, cache keys
contain neither token fragments nor `Authorization` values, and each existing
GitHub consumer still observes its documented no-auth state.

### Step 4: Connect the server contract to a fixture-driven Settings surface

Register the `github-auth` Elysia module in `app.ts`, give every route TypeBox
body/params/response schemas, and regenerate the Web OpenAPI client. Do not
add `x-cradle-cli` metadata: Device Flow is a local interactive connection
workflow, not a secret-bearing CLI endpoint. Existing `cradle pull-request`
commands will use the connected local identity automatically.

Build the settings surface without expanding `IntegrationsSettings`'s business
logic:

- `GithubAppConnectionContainer` owns generated-client queries, mutations,
  login polling, query invalidation, toasts, and opening `verificationUri`
  through Desktop native IPC with the browser fallback used by the ChatGPT
  login hook.
- `GithubAppConnectionView` receives typed data and callbacks only. It must
  render from fixtures in its Storybook story and contain no generated client,
  Electron, route, global-store, or runtime imports.
- Mount the container as a GitHub identity card/section within Integrations.
  The disconnected state explains two distinct steps: install the Cradle App
  into the user's organization/repositories, then connect the user's GitHub
  identity. The pending state shows the user code, expiry, cancel action, and
  “Continue in browser” action. The connected state says “Posting as
  @login via Cradle”, displays expiry/reconnect status, and offers Disconnect.
  It must not promise that all repositories are installed unless the server
  has positively checked that fact.
- Use `SettingsPage`/`SettingsGroup`, design-system Button/Badge/Spinner/
  AlertDialog primitives, static Tailwind classes, and `cn()` only. Add no
  dynamic Tailwind class generation. Keep one exported semantic React
  component per production file.
- Add fixtures and a story for configured-disconnected, pending, connected,
  expired/error, and unconfigured states. Add an RTL test for status copy and
  callbacks, not browser automation.

Add typed localization keys to default settings and every shipped locale JSON;
run the locale workflow rather than hardcoding user-visible text.

**Verify**: `pnpm generate:web && pnpm --filter @cradle/web typecheck && pnpm --filter @cradle/web test -- src/features/settings/github-app-connection-view.test.tsx && pnpm --filter @cradle/web i18n:ci` all exit 0. Confirm `git diff -- apps/web/src/api-gen` contains generated output only.

### Step 5: Document ownership and complete a real GitHub acceptance test

Update module documentation to state that GitHub-auth owns user connection,
token lifecycle, and identity selection; Pull Request/Diff Review/Session
Await consume the shared API client but do not own credentials. Update the
GitHub Issues plugin documentation with precedence: a plugin-specific explicit
token remains a deliberate override; otherwise it receives the selected
Cradle App user token.

Create a private disposable GitHub test repository, install the App on it,
connect a real user in a packaged or development Desktop build, and submit a
PR conversation comment through Cradle. In GitHub's PR UI verify the author
is the user's account and that the Cradle App badge overlays the avatar. Also
verify an uninstalled repository produces a permission error without exposing
tokens, disconnect removes local access, and reconnect recovers it. Record
only the repository URL/PR number and pass/fail result in the PR description;
never place access or refresh token values in tests, logs, screenshots, or
documentation.

**Verify**: Run the full verification command, then complete the manual GitHub
acceptance test above. All automated commands pass and the GitHub UI shows the
user avatar plus the Cradle badge on the created comment.

## Test plan

- `apps/server/src/modules/github-auth/service.test.ts`: mocked Device Flow
  start/poll/slow-down/cancel/timeout/success, encrypted credential lifecycle,
  token refresh, revoked refresh token, status redaction, and one-active-login
  behavior. Structure it after the local ChatGPT device-login test seam, but
  do not import that provider module.
- `apps/server/src/lib/github-api.test.ts`: selected identity precedence,
  async Octokit authorization, cache-key redaction, and no legacy fallback for
  an expired connected App credential.
- Existing `pull-request`, `diff-review`, `session-await-github`, and
  `external-issue-sources` suites: update only their authentication setup and
  add a regression assertion for the new shared token provider. Their business
  behavior must remain unchanged.
- `apps/web/src/features/settings/github-app-connection-view.test.tsx`:
  fixture-driven disconnected/pending/connected/expired states; install,
  connect, cancel, reconnect, and disconnect callbacks. Storybook renders the
  same states server-free.
- Manual: use a real GitHub App installation and verify the visible badge; a
  mocked HTTP test cannot prove GitHub's rendered attribution.

## Done criteria

- [ ] A public `cradleagent` GitHub App is registered with Device Flow,
  Metadata read, Contents read, Issues read/write, Pull requests read/write,
  and its custom badge; no webhook, private key, or
  client secret is introduced.
- [ ] A connected Desktop user can authorize through Device Flow, and the raw
  access/refresh tokens are encrypted locally and never returned by APIs.
- [ ] PR comments, reviews, Diff Review thread mutations, GitHub awaits, and
  default GitHub Issues refreshes select the connected App user identity.
- [ ] An expired/revoked App connection fails closed and asks to reconnect;
  it does not silently fall back to `GH_TOKEN`/`gh`.
- [ ] Existing explicit environment/plugin token overrides retain their
  documented behavior when no App identity is connected.
- [ ] The Settings View is fixture-driven; no View imports generated clients,
  Electron, stores, routes, or runtime context.
- [ ] `pnpm generate:web`, focused tests, Web typecheck/localization checks,
  lint, and the full verification command all pass.
- [ ] A real PR comment displays the user avatar with the Cradle App badge.
- [ ] No files outside Scope are changed and this plan's status row in
  `plans/README.md` is updated.

## STOP conditions

Stop and report rather than improvising if any of the following occurs:

- The external App owner cannot register a public GitHub App, enable Device
  Flow, or supply its public client ID/app slug. Do not substitute a personal
  access token, OAuth App, client secret, or installation token; those change
  attribution/security semantics.
- The working tree's uncommitted PR Console/OpenAPI changes have not been
  committed or conflict with the plan's GitHub client files.
- GitHub Device Flow requires a client secret/private key for the desired App
  configuration, or its current terms/endpoint behavior differs from the
  official documentation cited above.
- The requested UI would require placing a token in the renderer, localStorage,
  a generated API response, an unencrypted config file, or a remote Cradle
  service.
- A refactor would require a new database schema solely to represent one local
  active App-user credential; use the existing encrypted credential owner or
  report why it cannot express the state.
- A focused test fails twice after a reasonable scoped correction, or an
  unrelated dirty file would need modification.

## Maintenance notes

- The GitHub App's public client ID and slug are release configuration. They
  are safe to distribute, but any permission expansion must be reviewed as a
  user-visible reauthorization/install change. Never add a client secret to
  Desktop to avoid maintaining a hosted OAuth callback.
- Review all future GitHub API additions: they must go through the shared
  async auth port, use non-secret identity-scoped cache keys, and decide
  explicitly whether a legacy explicit token override is allowed.
- GitHub's badge is an external rendering behavior. Keep the real-repository
  acceptance test in release validation when changing token type, App
  permissions, Octokit authentication, or comment/review endpoints.
- Deferred intentionally: App webhooks/background automation, bot attribution,
  Marketplace publication, per-repository installation management UI, and
  moving the Desktop credential root key to the OS keychain. The last is a
  security-hardening follow-up, not a prerequisite for local encrypted
  credential storage.
