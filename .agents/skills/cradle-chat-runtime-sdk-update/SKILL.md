---
name: cradle-chat-runtime-sdk-update
description: Update Cradle chat-runtime native SDK and protocol integrations. Use when upgrading or validating the vendored Codex app-server runtime/protocol, Kimi Web OpenAPI/AsyncAPI snapshots and generated bindings, or @anthropic-ai/claude-agent-sdk in apps/server; also use when asked to inspect newly generated native APIs for useful Cradle features.
---

# Cradle Chat Runtime SDK Update

Use this skill for Cradle-owned Server chat runtime dependency updates:

- Codex: Desktop-vendored Codex CLI runtime, generated app-server protocol bindings, and Codex adapter behavior.
- Kimi: locally installed `kimi web`, captured REST OpenAPI and WebSocket AsyncAPI contracts, generated REST bindings, and the future Kimi adapter.
- Claude Agent: `@anthropic-ai/claude-agent-sdk` and the Server Claude Agent provider.

Keep the ownership boundary clear: Server owns Chat Runtime contracts and provider adapters; Desktop owns bundled runtime injection; Codex/Claude own their native protocol semantics. Read external/native namespaces, but write Cradle-owned projections only.

## Workflow

1. Inspect current state before changing files.

```bash
git status --short
node -e "const root=require('./package.json'); const srv=require('./apps/server/package.json'); console.log({claudeAgentSdk:srv.dependencies['@anthropic-ai/claude-agent-sdk']})"
sed -n '1,80p' apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/MANIFEST.json
test -f apps/server/src/modules/chat-runtime-providers/kimi/protocol/MANIFEST.json
sed -n '1,120p' apps/server/src/modules/chat-runtime-providers/kimi/protocol/MANIFEST.json
```

2. Upgrade dependencies with pnpm and respect supply-chain policy.

```bash
pnpm --filter @cradle/server up @anthropic-ai/claude-agent-sdk --latest
```

If pnpm refuses a newer dist-tag due to minimum release age, do not add `minimumReleaseAgeExclude` casually. Report the rejected version and use the latest policy-accepted version unless the user explicitly wants to bypass the policy.

3. Sync or verify the Codex runtime.

Use the full Codex CLI asset, not the standalone app-server asset. For reproducible work, pin the release tag:

```bash
CRADLE_CODEX_RELEASE_TAG=rust-vX.Y.Z pnpm --filter @cradle/desktop sync:codex-runtime
```

If the user says Codex is already upgraded, skip syncing and verify the current bundled runtime:

```bash
node -e "const p=require('./apps/desktop/resources/codex/darwin-arm64/codex-runtime.json'); console.log(p.release?.tagName, p.binary?.version)"
```

4. Generate Codex protocol and capabilities.

```bash
pnpm --filter @cradle/server generate:codex-app-server-protocol
```

This must use the vendored runtime through the existing script, not a global `codex` command.

5. Sync or verify the Kimi Web protocol when Kimi is in scope.

Kimi's executing `kimi` binary, not a source checkout, is the protocol source of truth. Refresh both REST and WebSocket contracts through the Cradle-owned generator:

```bash
pnpm --filter @cradle/server generate:kimi-web-protocol
```

The command starts `kimi web` with a fresh temporary `KIMI_CODE_HOME`, discovers its loopback port, reads only that temporary home's `server.token` in memory to authenticate schema requests, calls `kimi web kill`, and removes the home. Never point this workflow at `~/.kimi-code`, parse/log the startup token, or use `--dangerous-bypass-auth`.

For a deterministic binding-only regeneration in CI or an environment without Kimi installed:

```bash
pnpm --filter @cradle/server generate:kimi-web-protocol-bindings
```

The Kimi output owner is `apps/server/src/modules/chat-runtime-providers/kimi/protocol/`:

- `openapi.json` and `asyncapi.json` are normalized, committed protocol snapshots.
- `MANIFEST.json` records the Kimi version plus SHA-256 values for both snapshots.
- `rest/` is generated from OpenAPI and must contain TypeScript types and Zod schemas.
- `websocket.ts` is a generated directional catalogue of AsyncAPI frames and payload schemas. It is not a Chat Runtime event mapper.

Before implementing a Kimi provider, extend the OpenAPI generation with `@hey-api/client-ofetch` and `@hey-api/sdk` so `rest/` also exposes a typed request client. Keep the client configuration hand-written in the Kimi runtime namespace: it owns the per-host base URL, transient bearer token, ofetch timeout/retry policy, and Kimi envelope error handling. Disable automatic retries for Kimi commands unless an operation-specific policy proves retry safety. Do not make provider code build URLs or request bodies manually, and do not expose a generic raw-Kimi bridge as a Cradle public API.

6. Review generated API changes, not just typecheck.

Use `git diff --stat`, `git diff --name-status`, and targeted diffs on:

- `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/ClientRequest.ts`
- `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/ServerNotification.ts`
- `apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts`
- changed `v2/*Params.ts`, `v2/*Response.ts`, and root union types such as `ResponseItem.ts`, `AuthMode.ts`, `ReasoningEffort.ts`

Classify changes as:

- New client methods that can become session-scoped Chat Runtime capabilities.
- New notifications that should affect runtime state, diagnostics, UI slots, or persistence.
- Type narrowing/widening that requires adapter changes.
- Native features that are interesting but should remain Codex-owned until Cradle has a clear owner.

For useful Codex APIs, call out concrete Cradle opportunities. Recent examples include account usage/rate-limit credit surfaces, thread delete, background terminal list/terminate, turn moderation metadata, response item metadata, agent-message items, selected capability roots, realtime speech append, remote-control pairing status, and new auth modes such as personal access token or Bedrock API key.

For Kimi, review OpenAPI operation and schema changes alongside AsyncAPI message additions/removals. Classify WebSocket changes into stream text/thinking, tool lifecycle, turn lifecycle, approval/question interaction, goal/task state, and diagnostics. The eventual Kimi adapter must make an explicit projection decision for each consumed frame; do not infer Cradle `ChatRuntimeChunk` behavior solely from a generated JSON schema.

7. Update adapter code only where the generated API requires it.

Do not preserve deprecated request fields with compatibility shims. If generated types remove or narrow fields, update Cradle projections and tests directly. If generated fields require absolute paths, resolve them at the Cradle boundary instead of sending relative paths.

8. Verify focused surfaces.

```bash
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/app-server/client.test.ts src/modules/chat-runtime-providers/codex/app-server/capabilities.test.ts src/modules/chat-runtime-providers/codex/provider.test.ts
pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper.test.ts tests/sdk-providers.test.ts
pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/kimi/protocol/generator.test.ts
pnpm --filter @cradle/server generate:kimi-web-protocol
pnpm --filter @cradle/server generate:kimi-web-protocol-bindings
```

Known Claude Agent SDK upgrade check: tool API names should stay Cradle-canonical in persisted tool payloads, for example `claude-code/Bash` rather than older lowercase expectations.

## Reporting

End with:

- Versions updated and whether any newer registry/GitHub release was skipped by policy.
- Whether Codex protocol generation succeeded and the manifest version.
- Whether Kimi protocol generation succeeded, its runtime version, and both schema hashes.
- Notable API additions/removals/widenings/narrowings.
- Whether Kimi REST output includes the typed request client required for a provider implementation, or is intentionally snapshot-only.
- Code or test changes made in response.
- Exact verification commands and pass/fail status.

Mention unrelated dirty worktree files separately; do not revert them.
