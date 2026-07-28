---
name: cradle-chat-runtime-sdk-update
description: "Refresh and assess every Cradle Chat Runtime SDK integration through the manual GitHub workflow: Claude Agent SDK, vendored Codex runtime/app-server protocol, and Kimi Web OpenAPI/AsyncAPI snapshots. Use when asked to update or inspect these SDKs/protocols, trigger their update PR, wait for the generated PR and CI with Cradle Session Await, or explain which native changes matter for Cradle."
---

# Cradle Chat Runtime SDK Update

Own the Cradle projections, not the provider implementations: Server owns runtime contracts and adapters; Desktop owns bundled-runtime injection; Codex, Claude, and Kimi own their native semantics.

## Trigger the complete update

Use `.github/workflows/update-chat-runtime-sdks.yml`; do not update only one provider by default. It has no schedule and does not run tests itself. It updates all of:

- `@anthropic-ai/claude-agent-sdk` in `apps/server` with pnpm's supply-chain policy intact.
- The full Codex CLI runtime and generated app-server protocol/capabilities.
- The Kimi Code CLI, then Kimi's REST and WebSocket protocol snapshots and bindings.

Dispatch from `main`, leaving version inputs empty for the latest release or supplying explicit versions for a reproducible update:

```bash
gh workflow run update-chat-runtime-sdks.yml --repo wibus-wee/cradle-app --ref main
run_id="$(gh run list --repo wibus-wee/cradle-app --workflow update-chat-runtime-sdks.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Do not add `minimumReleaseAgeExclude` to bypass a package-policy rejection. Report the rejected SDK version and use the latest accepted version unless the user explicitly authorizes a policy change.

## Await the update and its PR CI

After dispatch, register a Cradle JavaScript await for that exact GitHub Actions run; do not use `gh run watch` or a shell polling loop. End the turn after registering it.

```bash
cradle session await javascript \
  --reason "Waiting for Chat Runtime SDK update workflow ${run_id}" \
  --program "async ({ tools }) => { const result = await tools.exec({ argv: ['gh', 'run', 'view', '${run_id}', '--repo', 'wibus-wee/cradle-app', '--json', 'status,conclusion,url'] }); if (result.exitCode !== 0) throw new Error(result.stderr); const run = JSON.parse(result.stdout); if (run.status !== 'completed') return false; return { resumeText: JSON.stringify(run) }; }"
```

When resumed, report a failed update immediately. On success, find the generated PR from `automation/chat-runtime-sdk-update`. If there is no PR, report that every SDK and generated artifact was already current.

The workflow creates the PR with the repository `GITHUB_TOKEN`. GitHub creates the resulting `pull_request` CI run in an approval-required state. Resolve the PR head SHA, find the CI run for that exact SHA, approve it with the current user's GitHub credentials, then register the normal CI await and end the turn:

```bash
pr_json="$(gh pr list --repo wibus-wee/cradle-app --head automation/chat-runtime-sdk-update --state open --json number,headRefOid --jq '.[0]')"
pr_number="$(jq -r '.number' <<<"$pr_json")"
head_sha="$(jq -r '.headRefOid' <<<"$pr_json")"
ci_run_id="$(gh run list --repo wibus-wee/cradle-app --workflow ci.yml --commit "$head_sha" --event pull_request --limit 1 --json databaseId --jq '.[0].databaseId')"
gh api --method POST "repos/wibus-wee/cradle-app/actions/runs/${ci_run_id}/approve"
cradle session await github-ci wibus-wee/cradle-app --pr "$pr_number" --reason "Waiting for Chat Runtime SDK update PR #${pr_number} CI"
```

If the CI run is not visible immediately, register a short JavaScript await for the exact PR head SHA instead of polling. If GitHub has already started the run, skip the approval call. Do not run duplicate local tests; use the PR CI result.

## Assess the generated update

After the update workflow and PR CI finish, inspect the PR diff and classify every changed provider surface. Do not hand-edit generated bindings.

- Codex: inspect `ClientRequest.ts`, `ServerNotification.ts`, `capabilities.ts`, changed `v2/*Params.ts` and `v2/*Response.ts`, plus root unions. Identify new methods, notifications, and type narrowing/widening.
- Claude Agent: inspect the dependency and lockfile diff, then compare its exported types and tool/event semantics against Cradle's Claude provider. Preserve Cradle-canonical persisted tool names.
- Kimi: inspect OpenAPI, AsyncAPI, manifest hashes, REST bindings, and `websocket.ts`. Classify frames as text/thinking, tool lifecycle, turn lifecycle, approval/question, goal/task state, or diagnostics.

For every notable native change, state one of: **implement now** (name the Cradle owner and seam), **follow up** (explain the missing product decision), or **leave native** (explain why Cradle should not project it). Never infer `ChatRuntimeChunk` behavior from a Kimi schema alone.

## Report to the user

After CI, give a concise product-facing report containing:

- PR URL, CI outcome, and exact Claude/Codex/Kimi versions or Kimi schema hashes changed; explicitly say when a provider had no change.
- API additions, removals, widenings, and narrowings that deserve attention.
- Concrete Cradle opportunities, such as a UI slot, session capability, persisted diagnostic, interaction bridge, or a reason to keep the feature provider-native.
- Any adapter work required before merging, and any rejected version caused by supply-chain policy.

Mention the workflow's deliberate behavior: it creates no date-only PR when Codex or Kimi's version and generated schema are unchanged, and it leaves testing to the generated PR's normal CI.
