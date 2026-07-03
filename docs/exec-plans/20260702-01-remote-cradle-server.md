# Replace Remote Agent Daemon With Remote Cradle Server

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The plan is self-contained and describes the repository paths, terms, commands, and expected behavior needed to complete the refactor.

## Purpose / Big Picture

Cradle Remote should connect to another running Cradle Server, not to a separate `cradle-agentd` process. After this change, a local Cradle instance can register a remote Cradle Server, open a tunnel or direct HTTP connection to it, read its health, list its workspaces, and proxy remote workspace file reads through the remote server's existing APIs. This removes the duplicate remote-agent daemon boundary and lets the remote Cradle Server own its own workspace, runtime, session, and provider semantics.

The first observable outcome is that `/remote-hosts/:hostId/cradle-server/health` remains the connection health check, while new `/remote-hosts/:hostId/cradle-server/workspaces` and `/remote-hosts/:hostId/cradle-server/workspaces/:remoteWorkspaceId/files...` routes proxy to the target Cradle Server. The old `/remote-hosts/:hostId/agentd/...` routes and `remote-mock` runtime are removed from the product path.

## Progress

- [x] (2026-07-02 16:20+08:00) Created independent worktree `/Users/wibus/dev/cradle-app-remote-cradle-server` on branch `refactor/remote-cradle-server`.
- [x] (2026-07-02 16:25+08:00) Audited current remote code paths and confirmed `agentd`, `remote-agent-protocol`, and `remote-mock` are the duplicate daemon-based path.
- [x] (2026-07-02 16:30+08:00) Created this ExecPlan with the server-to-server direction and destructive refactor scope.
- [x] (2026-07-02 20:45+08:00) Replaced server remote-host internals so the connection record points at a target Cradle Server through either SSH tunnel or direct URL.
- [x] (2026-07-02 21:05+08:00) Removed `apps/agentd`, `packages/remote-agent-protocol`, `packages/remote-relay-protocol`, server daemon client files, and `remote-mock` runtime registration.
- [x] (2026-07-02 21:15+08:00) Updated workspace remote file access to resolve the remote workspace through `RemoteHosts.resolveRemoteWorkspaceByPath()` and call the remote Cradle Server workspace file APIs.
- [x] (2026-07-02 21:25+08:00) Regenerated web and CLI API clients from the new OpenAPI document; generated `/remote-host/agentd/*` CLI commands disappeared and `/remote-host/cradle-server/*` commands were generated.
- [x] (2026-07-02 21:40+08:00) Rewrote `apps/web/src/features/settings/remote-hosts-settings.tsx` so the UI configures SSH tunnel or direct URL to a remote Cradle Server and browses remote workspaces/files through `/cradle-server/*`.
- [x] (2026-07-02 21:55+08:00) Reworked the Add Workspace remote flow in `apps/web/src/features/workspace/workspace-sidebar.tsx` to select workspaces returned by the remote Cradle Server instead of browsing an agent daemon filesystem.
- [x] (2026-07-02 22:00+08:00) Removed the old remote-host agentd session link schema from runtime schema.
- [x] (2026-07-02 22:05+08:00) Renamed relayd envelope data frames from the remote-agent-specific `remote_agent_frame` to the generic `relay_data_frame`.
- [x] (2026-07-02 22:05+08:00) Ran validation commands and recorded the results below.
- [x] (2026-07-03 00:20+08:00) Restored the original Drizzle migration history and added a regular append-only migration, `packages/db/drizzle/0016_foamy_sleeper.sql`, to drop `remote_host_agentd_session_links`.

## Surprises & Discoveries

- Observation: `apps/server/src/modules/remote-hosts/service.ts` already has a partial Cradle Server tunnel implementation beside the daemon path.
  Evidence: The module contains `connectRemoteHostCradleServer`, `readRemoteHostCradleServerHealth`, and `startRemoteCradleServerTunnel`, but the UI and workspace flows still call `/agentd/...` endpoints.

- Observation: Remote workspace locators already exist as `{ hostId, path }`, but chat runtime still rejects remote workspaces because it resolves only local paths.
  Evidence: `apps/server/src/modules/workspace/workspace-locator.ts` accepts arbitrary `hostId`, while `apps/server/src/modules/chat-runtime/runtime-session-context.ts` calls `Workspace.getLocalWorkspacePath()` and returns `null` for remote workspaces.

- Observation: OpenAPI generation needs a data directory in this repository state.
  Evidence: `pnpm generate:web` initially failed with `CRADLE_DATA_DIR or CRADLE_DB_PATH is required`; rerunning with a temporary `CRADLE_DATA_DIR` succeeded.

- Observation: Web typecheck is currently blocked by unrelated missing UI dependencies or path aliases.
  Evidence: `pnpm --filter @cradle/web typecheck` reports missing `framer-motion`, `@radix-ui/react-accordion`, and local modules such as `~/lib/icon-context`; after fixing remote settings and workspace sidebar types, no remote-host-specific type errors remained.

- Observation: The generated CLI workflow updates `resources/skills/cradle-cli/SKILL.md`.
  Evidence: `pnpm gen:cli` printed `Generated 275 CLI commands` and `Updated SKILL.md with 26 modules`, and the git status shows the skill file modified.

- Observation: Drizzle migration history must remain append-only even for this destructive remote refactor.
  Evidence: The initial implementation incorrectly squashed `packages/db/drizzle` to a fresh baseline. This was corrected by restoring migrations `0000` through `0015` and generating `0016_foamy_sleeper.sql`, which contains `DROP TABLE remote_host_agentd_session_links;`.

## Decision Log

- Decision: Delete the daemon path instead of migrating it gradually.
  Rationale: There are no users relying on the current Remote implementation, and the repository rules prefer breaking refactors over compatibility shims before stable release.
  Date/Author: 2026-07-02 / Codex

- Decision: Keep the `remote_hosts` table and route prefix, but make `cradleServer` the canonical capability.
  Rationale: The table already stores host connection records and SSH configuration. Reusing it avoids an unnecessary database rename while still deleting the wrong `agentd` semantics.
  Date/Author: 2026-07-02 / Codex

- Decision: Use the target Cradle Server's existing HTTP API as the remote system boundary.
  Rationale: A Cradle Server already owns workspace, session, runtime, files, and provider behavior. Reusing its API avoids recreating those semantics in a custom remote-agent protocol.
  Date/Author: 2026-07-02 / Codex

- Decision: Keep relay server management for now, but remove remote-agent naming from relayd data frames.
  Rationale: The user rejected `agentd`, not the relay server concept. `relayd` can remain a generic peer relay, but its envelope kind should not encode remote-agent semantics.
  Date/Author: 2026-07-02 / Codex

- Decision: Preserve Drizzle migration history and remove the old agentd session link table with a regular appended migration.
  Rationale: Even though the remote feature has no users and the runtime schema can be destructively simplified, migration history should remain reviewable and append-only. The correct path is to delete the schema definition and add a new migration that drops the obsolete table.
  Date/Author: 2026-07-03 / Codex

## Outcomes & Retrospective

The refactor now removes the agent daemon path from active server, web, CLI, package, and DB schema surfaces. A remote host is configured as either `ssh` or `direct-url`; both target a Cradle Server, not `cradle-agentd`. The server exposes Cradle Server connection, health, workspace list, and workspace file proxy routes under `/remote-hosts/:hostId/cradle-server/*`. The Remote Hosts settings UI and Add Workspace dialog now call those generated routes. Drizzle migration history is preserved, with the obsolete `remote_host_agentd_session_links` table removed by `0016_foamy_sleeper.sql`.

Validation passed for the server, CLI, relayd, and focused server tests. Web typecheck did not fully pass because of pre-existing missing UI dependencies or aliases unrelated to this refactor; the previous remote-specific errors were fixed before stopping. The remaining product-code string scan for agentd-specific identifiers is clean except for generic chat rendering branches that classify `taskType === 'remote_agent'`, which do not import agentd packages or call `/agentd` routes.

## Context and Orientation

A remote host is a row in `packages/db/src/schema/remote-host.ts`. Before this refactor, one row could describe an `agentd` capability and a `cradleServer` capability. The `agentd` capability means a small daemon process running on the remote machine. That daemon exposes a custom WebSocket protocol from `packages/remote-agent-protocol` and is implemented by `apps/agentd`. This is the boundary being removed.

A Cradle Server is the existing server app in `apps/server`. It already exposes health, workspace, files, chat runtime, session, and provider routes. Remote should treat that target server as the authority. The local server should connect to the remote server, call its HTTP endpoints, and project the results into the local UI.

The current partial Cradle Server tunnel lives in `apps/server/src/modules/remote-hosts/cradle-server-tunnel.ts`. It opens an SSH local port forward from a local random port to the target host and port, then returns a local base URL. The current service in `apps/server/src/modules/remote-hosts/service.ts` uses that tunnel only for health checks. This plan expands that path and removes the old daemon path.

Workspace locators are serialized by `apps/server/src/modules/workspace/workspace-locator.ts`. A local workspace uses `hostId: 'local'`. A remote workspace currently stores another host id plus a path. In this milestone, remote workspace file APIs will keep that locator shape and call the remote Cradle Server with the remote path when necessary. A later refactor can promote remote workspace id as canonical identity, but this plan avoids a database schema migration unless implementation proves it is required.

The web Remote Hosts UI is in `apps/web/src/features/settings/remote-hosts-settings.tsx`. The Add Workspace dialog is in `apps/web/src/features/workspace/workspace-sidebar.tsx`. Generated API client files live under `apps/web/src/api-gen`; if server route schemas change, regenerate or update the minimum required generated surfaces according to existing project scripts.

## Plan of Work

First, simplify `apps/server/src/modules/remote-hosts/service.ts`. Remove imports and functions that depend on `@cradle/remote-agent-protocol`, `daemon-client.ts`, `relay-transport.ts`, `session-links.ts`, and `ssh-tunnel.ts` for Unix socket forwarding. Keep SSH profile handling and the existing Cradle Server tunnel. Rename generic connection functions so `connectRemoteHost` means connecting to the remote Cradle Server, not to agentd. Keep explicit exports for `connectRemoteHostCradleServer`, `disconnectRemoteHostCradleServer`, and `readRemoteHostCradleServerHealth` if route names still use them.

Second, add a small remote Cradle HTTP client module under `apps/server/src/modules/remote-hosts/remote-cradle-client.ts`. It should accept a base URL and expose typed functions for health, workspace list, workspace file tree, file content, and file info. The client should use `fetch` and throw `AppError` through service-level wrappers when remote responses fail. It must not import web-generated SDK code.

Third, update `apps/server/src/modules/remote-hosts/index.ts` and `model.ts`. Remove all `/agentd/...` routes. Add `/cradle-server/workspaces`, `/cradle-server/workspaces/:remoteWorkspaceId/files`, `/cradle-server/workspaces/:remoteWorkspaceId/files/children`, `/cradle-server/workspaces/:remoteWorkspaceId/files/content`, and `/cradle-server/workspaces/:remoteWorkspaceId/files/info` routes if workspace service needs direct proxy routes. Keep route names aligned with existing local workspace API behavior.

Fourth, update `apps/server/src/modules/workspace/service.ts`. When the workspace locator is remote, call remote Cradle Server through the remote-hosts service. Listing files and reading file content should be supported through the remote server. Unsupported write operations can remain unsupported until the write path is intentionally enabled, but the error message must mention remote Cradle Server rather than remote hosts or agentd.

Fifth, remove product registration for `remote-mock` from `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` and delete `apps/server/src/modules/chat-runtime-providers/remote-mock`. Remove `apps/agentd`, `packages/remote-agent-protocol`, and references in workspace/package metadata if they are no longer used. Remove generated CLI commands and web API generated references only if they become compile failures; otherwise regenerate from OpenAPI after server route changes.

Sixth, update web UI text and API calls. `apps/web/src/features/settings/remote-hosts-settings.tsx` should describe connecting to a remote Cradle Server, not starting a daemon. `apps/web/src/features/workspace/workspace-sidebar.tsx` should use the new Cradle Server workspace/file browsing routes rather than `/agentd/fs` and `/agentd/git` routes. Do not introduce browser-based tests unless explicitly requested.

## Concrete Steps

Work only in `/Users/wibus/dev/cradle-app-remote-cradle-server`.

Inspect worktree status:

    git status --short --branch

Create and update this plan:

    mkdir -p docs/exec-plans
    $EDITOR docs/exec-plans/20260702-01-remote-cradle-server.md

After each milestone, inspect references:

    rg -n "agentd|remote-agent-protocol|remote-mock|/agentd" apps packages package.json pnpm-workspace.yaml

Run targeted tests during implementation:

    pnpm --filter @cradle/server test -- remote-hosts
    pnpm --filter @cradle/server typecheck

If package removals affect workspace metadata, run:

    pnpm install --lockfile-only
    pnpm typecheck

Commands that were run during implementation:

    tmpdir=$(mktemp -d /tmp/cradle-openapi-XXXXXX) && CRADLE_DATA_DIR="$tmpdir" pnpm generate:web && CRADLE_DATA_DIR="$tmpdir" pnpm gen:cli
    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/server exec vitest run tests/remote-hosts.test.ts tests/relay-servers.test.ts
    cd apps/relayd && go test ./...
    pnpm --filter @cradle/web typecheck

Expected current outputs are: server typecheck exits 0, CLI typecheck exits 0, focused server tests report 2 files and 9 tests passed, and relayd Go tests pass. Web typecheck exits 2 on unrelated missing dependencies and aliases listed in `Outcomes & Retrospective`.

## Validation and Acceptance

Acceptance is behavior-based. A local Cradle Server with a registered remote host pointing at another Cradle Server should be able to connect, read remote health, list remote workspaces, and read remote workspace files without starting `cradle-agentd`.

The server test suite must include a fake remote Cradle Server that serves `/health`, `/workspaces`, and workspace file routes. A test should create a remote host with direct Cradle Server configuration, connect it, and assert that the remote-host routes return the fake server data. This test proves the feature without SSH.

The repository must no longer register `remote-mock` in the runtime catalog. A test or typecheck should prove `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` compiles without importing the deleted provider.

A final search should show no product code references to `@cradle/remote-agent-protocol`, `apps/agentd`, `remote-mock`, or `/agentd` routes. Historical migration files may contain old names because migration history is append-only. The remaining `remote_agent` strings in web chat rendering are generic task-type display logic and not part of the deleted agent daemon path.

## Idempotence and Recovery

This work happens in an isolated git worktree. If a change goes wrong, discard only this worktree or branch; do not reset the original `/Users/wibus/dev/cradle-app` worktree. File deletions are allowed in this branch because the user explicitly allowed destructive refactoring and there are no users relying on the current Remote path.

Edits should be made in small, reviewable stages. After deleting packages or routes, run `rg` for stale imports before running typecheck. If API generation is unavailable or too broad, keep server and web changes minimal enough to typecheck with existing generated files or document the gap in this plan.

## Artifacts and Notes

Initial worktree creation transcript:

    Preparing worktree (new branch 'refactor/remote-cradle-server')
    HEAD is now at fad8942 feat: enhance Opencode provider with improved session handling and runtime configuration

Initial status in the new worktree:

    ## refactor/remote-cradle-server

Validation transcript highlights:

    pnpm --filter @cradle/server typecheck
    $ tsc --noEmit

    pnpm --filter @cradle/cli typecheck
    $ tsc --noEmit

    pnpm --filter @cradle/server exec vitest run tests/remote-hosts.test.ts tests/relay-servers.test.ts
    Test Files  2 passed (2)
    Tests  9 passed (9)

    cd apps/relayd && go test ./...
    ok  	github.com/cradle/relayd/internal/httpapi
    ok  	github.com/cradle/relayd/internal/relay

    pnpm --filter @cradle/web typecheck
    error TS2307: Cannot find module 'framer-motion' or its corresponding type declarations.
    error TS2307: Cannot find module '@radix-ui/react-accordion' or its corresponding type declarations.
    error TS2307: Cannot find module '~/lib/icon-context' or its corresponding type declarations.

## Interfaces and Dependencies

`apps/server/src/modules/remote-hosts/remote-cradle-client.ts` should define a remote HTTP client with functions equivalent to:

    createRemoteCradleClient(baseUrl: string): RemoteCradleClient
    RemoteCradleClient.readHealth(): Promise<RemoteCradleServerHealthPayload>
    RemoteCradleClient.listWorkspaces(): Promise<WorkspaceView[]>
    RemoteCradleClient.listWorkspaceFiles(remoteWorkspaceId: string): Promise<WorkspaceFileEntry[]>
    RemoteCradleClient.listWorkspaceFileChildren(remoteWorkspaceId: string, relativePath: string): Promise<WorkspaceFileEntry[]>
    RemoteCradleClient.readWorkspaceFileContent(remoteWorkspaceId: string, relativePath: string): Promise<{ content: string | null }>
    RemoteCradleClient.readWorkspaceFileInfo(remoteWorkspaceId: string, relativePath: string): Promise<WorkspaceFileInfo | null>

`apps/server/src/modules/remote-hosts/service.ts` should expose server-owned functions that wrap this client and map errors into `AppError`:

    connectRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerConnectionView>
    disconnectRemoteHostCradleServer(hostId: string): Promise<void>
    readRemoteHostCradleServerHealth(hostId: string): Promise<RemoteCradleServerHealthView>
    listRemoteCradleWorkspaces(hostId: string): Promise<WorkspaceView[]>
    listRemoteCradleWorkspaceFiles(hostId: string, remoteWorkspaceId: string): Promise<WorkspaceFileEntry[]>
    listRemoteCradleWorkspaceFileChildren(hostId: string, remoteWorkspaceId: string, relativePath: string): Promise<WorkspaceFileEntry[]>
    readRemoteCradleWorkspaceFileContent(hostId: string, remoteWorkspaceId: string, relativePath: string): Promise<{ content: string | null }>

Revision note 2026-07-02: Initial plan created after user clarified that `agentd` should not exist and destructive refactoring is allowed in an isolated worktree.

Revision note 2026-07-02 22:05+08:00: Updated the plan after implementation. Recorded completed server, web, CLI, DB, and relayd changes; captured validation results and the remaining unrelated web typecheck blocker.

Revision note 2026-07-03 00:20+08:00: Corrected the DB migration approach. Restored the original Drizzle history and recorded the new append-only migration that drops `remote_host_agentd_session_links`.
