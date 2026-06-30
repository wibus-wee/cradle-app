---
name: cradle-chat-runtime-sdk-update
description: Update Cradle chat-runtime SDK integrations and review API changes. Use when upgrading or validating the vendored Codex app-server runtime/protocol, generated Codex app-server TypeScript bindings/capabilities, or @anthropic-ai/claude-agent-sdk in apps/server; also use when asked to inspect newly generated Codex app-server APIs for useful Cradle features.
---

# Cradle Chat Runtime SDK Update

Use this skill for Cradle-owned Server chat runtime dependency updates:

- Codex: Desktop-vendored Codex CLI runtime, generated app-server protocol bindings, and Codex adapter behavior.
- Claude Agent: `@anthropic-ai/claude-agent-sdk` and the Server Claude Agent provider.

Keep the ownership boundary clear: Server owns Chat Runtime contracts and provider adapters; Desktop owns bundled runtime injection; Codex/Claude own their native protocol semantics. Read external/native namespaces, but write Cradle-owned projections only.

## Workflow

1. Inspect current state before changing files.

```bash
git status --short
node -e "const root=require('./package.json'); const srv=require('./apps/server/package.json'); console.log({claudeAgentSdk:srv.dependencies['@anthropic-ai/claude-agent-sdk']})"
sed -n '1,80p' apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/MANIFEST.json
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

5. Review generated API changes, not just typecheck.

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

6. Update adapter code only where the generated API requires it.

Do not preserve deprecated request fields with compatibility shims. If generated types remove or narrow fields, update Cradle projections and tests directly. If generated fields require absolute paths, resolve them at the Cradle boundary instead of sending relative paths.

7. Verify focused surfaces.

```bash
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/app-server/client.test.ts src/modules/chat-runtime-providers/codex/app-server/capabilities.test.ts src/modules/chat-runtime-providers/codex/provider.test.ts
pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper.test.ts tests/sdk-providers.test.ts
```

Known Claude Agent SDK upgrade check: tool API names should stay Cradle-canonical in persisted tool payloads, for example `claude-code/Bash` rather than older lowercase expectations.

## Reporting

End with:

- Versions updated and whether any newer registry/GitHub release was skipped by policy.
- Whether Codex protocol generation succeeded and the manifest version.
- Notable API additions/removals/widenings/narrowings.
- Code or test changes made in response.
- Exact verification commands and pass/fail status.

Mention unrelated dirty worktree files separately; do not revert them.
