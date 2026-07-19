# ACP local agents and registry launch overrides (backend)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not have a root `PLANS.md`. This plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md` and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, a user (or CLI/API client) can do two things that are impossible today:

1. **Register a local ACP agent** that never touches the official ACP Registry: provide a command (absolute path or PATH name), args array, and env map; Cradle stores it in the same `acp_agents` inventory that installed registry agents use, binds Cradle Agents with `configJson.acpAgentId`, and spawns that process for chat.
2. **Override launch parameters on a registry-installed agent** (cmd / args / env) without losing those overrides when the agent is reinstalled or upgraded from the registry.

Observable proof when done:

- `POST /acp/agents` with a local command creates a row that appears in `GET /acp/agents` with `source: "local"` and can be resolved for spawn.
- `PATCH /acp/agents/:id/launch-config` on a registry agent sets overrides; a subsequent `PUT /acp/agents/:id/installation` reinstall refreshes base cmd/args/env from the registry **but leaves overrides intact**.
- Effective launch used at spawn is the merge of base + overrides (documented below).
- Focused server tests fail before the change and pass after.

**This plan is backend-only.** No web UI, no i18n, no Runtimes form. CLI generation will pick up new routes automatically via existing `x-cradle-cli` descriptors once routes exist; do not build a separate CLI feature surface in this plan beyond correct route metadata.

## Progress

- [x] (2026-07-19) Design agreed: hybrid model on `acp_agents` (`source` + base columns + `override_*`), `distributionType: command`, merge at resolve, reinstall preserves overrides.
- [x] Milestone 1: DB schema + migration (`source`, `override_cmd`, `override_args`, `override_env`).
- [x] Milestone 2: Launch merge helper + process-manager `command` + binary absolute/traversal rules; resolve path uses effective launch and requires `status === 'installed'`.
- [x] Milestone 3: Service write paths — local register, launch-config PATCH, install/reinstall guards, uninstall branch for local, audit actions.
- [x] Milestone 4: HTTP models + routes (`POST /acp/agents`, `PATCH /acp/agents/:agentId/launch-config`), response projection with `source` / base / override.
- [x] Milestone 5: Tests (unit + service/API + chat-runtime resolve/spawn) and docs (module README).
- [x] Validation: focused vitest + server typecheck green.

## Surprises & Discoveries

- Observation: An earlier session memory suggested “override-only v1, local is phase 2.” The owner later required **both** local custom agents and registry overrides in the same delivery. This plan implements the hybrid.
  Evidence: Conversation on 2026-07-19; memory `dfcb1862-955f-4acc-8074-36aaaca9f4e1` updated to hybrid.
- Observation: `DELETE /acp/agents/:agentId/installation` is **cancel install**, not uninstall. Uninstall is `DELETE /acp/agents/:agentId`. Do not repurpose cancel.
  Evidence: `apps/server/src/modules/acp/index.ts` routes.
- Observation: `resolveAcpConnectionRecord` today only checks that a row exists, not `status === 'installed'`. Failed reinstall rows could still be spawnable.
  Evidence: `apps/server/src/modules/chat-runtime-providers/acp/config.ts`.
- Observation: `saveInstalledToDb` fully overwrites `cmd`/`args`/`env` on every install complete. Any override design that stores overrides in those same columns will lose them on reinstall. Overrides **must** be separate columns.
  Evidence: `apps/server/src/modules/acp/service.ts` `saveInstalledToDb`.
- Observation (implementation): Worktree tests must resolve `@cradle/db` from the worktree package (not a parent monorepo `node_modules` symlink alone). After `pnpm install` in the worktree, schema columns and migration `0040` applied correctly; response validation then required the new fields on `AcpModel.acpAgent`.
  Evidence: 400 `validation_error` with missing `source`/`override*` until DB schema + migrations were the worktree copies.
- Observation: Audit details intentionally store env **keys** (e.g. `envKeys: ["LOCAL_FLAG"]`) but never values. Tests assert values are absent, not that key names never appear.
  Evidence: `recordAudit` / `envKeysOnly` in `service.ts`; adjusted `acp.test.ts` assertion.

## Decision Log

- Decision: One table `acp_agents`; add `source` and three nullable override columns rather than a second table or JSON blob of overrides.
  Rationale: Resolve already reads one row per `acpAgentId`; connectionKey is `acp:<id>` (process-level). Separate columns make “reinstall must not touch overrides” a structural guarantee (installer SET list simply omits them).
  Date/Author: 2026-07-19 / design session

- Decision: `source` is `'registry' | 'local'`. Local owns base launch fields; registry owns base via installer and user owns only `override_*`.
  Rationale: Local has no upstream reinstall that would wipe user edits, so a second override layer is unnecessary complexity for local.
  Date/Author: 2026-07-19 / design session

- Decision: New `distributionType` value `'command'` means direct `spawn(cmd, args)` without `join(installPath, …)` and without npx/uvx wrappers.
  Rationale: Local absolute binaries and PATH commands are not registry “binary” (managed under `installPath`). Naming it `command` avoids colliding with `source=local`.
  Date/Author: 2026-07-19 / design session

- Decision: Merge rules — cmd/args replace if override column is non-null; env is shallow-merge (override keys win). Null column means “no override.” Empty args array `[]` is a valid override (full replace to no args).
  Rationale: Matches common process-env override UX; avoids inventing tombstone keys for env deletion in v1.
  Date/Author: 2026-07-19 / design session

- Decision: Do not put launch cmd/args/env on Cradle Agent persona `configJson`. Personas only store `acpAgentId`.
  Rationale: Process pool keys by installed agent id; per-persona launch params would be a false model.
  Date/Author: 2026-07-19 / design session

- Decision: Backend-only plan; UI deferred.
  Rationale: Owner asked to fix data/backend first; Work implements this plan then can follow up with Runtimes UI.
  Date/Author: 2026-07-19 / design session

## Outcomes & Retrospective

Implemented 2026-07-19 on branch `cradle/wt/acp-local-agents-launch-overrides`.

### Delivered

1. **Schema/migration** `0040_fuzzy_power_man.sql`: `source` (default `registry`), `override_cmd`, `override_args`, `override_env`.
2. **`launch-config.ts`**: pure `resolveEffectiveLaunch`, `parseArgsJson`/`parseEnvJson`, `resolveBinaryCommand` (absolute ok; reject `..` escape), package-path-like cmd guard.
3. **Process manager**: `distributionType: 'command'` spawns `cmd` directly; binary uses `resolveBinaryCommand`.
4. **Resolve**: status gate `installed`; effective launch for `acpAgentId` path; `connectionKey` remains `acp:<id>`; legacy path unchanged.
5. **Service**: `createLocalAgent`, `updateLaunchConfig`, install guards (`acp_local_not_installable`, in-progress), reinstall preserves overrides unless distribution type changes (then clear + audit), local uninstall skips binary FS cleanup.
6. **HTTP**: `POST /acp/agents` (`acp agent create`), `PATCH /acp/agents/:agentId/launch-config` (`acp agent launch-config`); model includes `source` + override fields.
7. **Tests**: `launch-config.test.ts` (11), expanded `acp.test.ts` (local + override/reinstall), `acp-chat-runtime.test.ts` (resolve merge + local spawn). **24 focused tests green.**
8. **Typecheck**: `pnpm --filter @cradle/server typecheck` green.
9. **Docs**: `apps/server/src/modules/acp/README.md` source matrix, merge rules, routes.

### Follow-ups (out of scope)

- Web Runtimes UI for Add/Edit local agent and registry override form.
- Optional nested `effective` object on list/get responses (clients can merge client-side; server resolve/spawn is authoritative).
- Env key deletion / secret store for env values.

## Context and Orientation

(See original design sections in conversation; implementation lives under `packages/db` + `apps/server/src/modules/acp` + `chat-runtime-providers/acp`.)

## Success criteria (definition of done)

1. Migration applied; schema columns present. ✅
2. Local agent can be created via API and appears in list with `source=local`. ✅ (tests)
3. Registry override survives reinstall (test proof). ✅
4. Spawn uses effective launch for both sources (test with spawn spy). ✅
5. Focused tests + server typecheck pass. ✅
6. This ExecPlan Progress checkboxes updated and Outcomes filled. ✅
