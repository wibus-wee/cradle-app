# Plan 060: Rename the agent delivery tool to `manage_pull_request` and add pre-PR branch rename

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 038ca7d7..HEAD -- apps/server/src/modules/agent-tools apps/server/src/modules/work apps/server/src/modules/worktree apps/server/src/modules/git apps/server/src/modules/pull-request apps/server/src/modules/chat-runtime/harness resources/skills/cradle-cli`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Branch requirement**: this plan was written against branch
> `feat/enhance-work` at commit `038ca7d7`. The `work_submit` tool it renames
> was introduced on that branch (commit `fa662c91`, "refactor: replace
> work_prepare tool with work_submit"). Execute on `feat/enhance-work` or on a
> branch that contains it. If `apps/server/src/modules/agent-tools/tools/work/submit.ts`
> does not exist, STOP — you are on the wrong branch.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (branch `feat/enhance-work` must be merged or checked out — see above)
- **Category**: direction
- **Planned at**: commit `038ca7d7`, 2026-07-18

## Why this matters

Cradle Work's product direction is settled: a Work is an autonomous delivery
unit where the agent delivers to a Draft PR by default, via a Cradle-owned
environment tool (Cursor `ManagePullRequest`-style), under a 1 Work · 1
Worktree · 1 PR constraint. Two gaps remain on `feat/enhance-work`:

1. **The agent-facing tool leaks product vocabulary.** `work_submit` exposes
   the user-facing "Work" concept to the agent tool surface. "Work" is a
   Cradle product concept for users (CLI/UI); the agent tool layer should
   speak git/PR semantics, which models already know from pretraining and
   which therefore needs less prompt teaching. The decided boundary:
   agent-facing tools use git-domain names (`manage_pull_request`,
   `rename_branch`); user-facing surfaces keep Work vocabulary
   (`cradle work submit`, the `/works/:id/submit` route — both unchanged).
2. **Branch names are frozen at worktree creation.** The branch is derived
   from the initial (often vague) Work title
   (`cradle/wt/<session8>-<slug(title)>`). Once the agent understands the
   actual objective, the branch name should be renameable — but only before
   the first PR exists, because GitHub cannot PATCH a PR's head ref, so
   renaming after PR creation would require recreating the PR and losing
   review history. Before the first submit the branch is purely local (push
   only happens inside the delivery path), so rename is then a cheap
   `git branch -m` + one DB field.

Trust model decision (made by the maintainer, do not relitigate): the
`workId` tool parameter stays. It is not a security boundary — the agent
already has a shell — and the per-turn `<cradle_work_state>` prompt injection
is fresher and more reliable than any env-based context resolution. Do NOT
build env/header-based session resolution into agent-tools.

## Current state

All paths relative to repo root. Excerpts verified at `038ca7d7`.

- `apps/server/src/modules/agent-tools/tools/work/submit.ts` — the tool to
  rename. Registers `work_submit` (line 7: `export const WORK_SUBMIT_TOOL_NAME = 'work_submit'`),
  input schema `{ workId, title, summary, testPlan, base? }` (lines 126-132),
  POSTs to `/works/${workId}/submit` via `requestAgentToolJson` (line 62).
- `apps/server/src/modules/agent-tools/tools/index.ts` — full file:
  ```ts
  import type { AgentToolRegistration } from '../registry'
  import { workSubmitTool } from './work/submit'

  export const builtinAgentTools: readonly AgentToolRegistration[] = [
    workSubmitTool,
  ]
  ```
- `apps/server/src/modules/agent-tools/http-client.ts` — `requestAgentToolJson({ path, body, responseSchema })`;
  `body` is `Record<string, string>`. Throws `AgentToolHttpRequestError` with
  `.code` on non-2xx. No session headers — keep it that way.
- `apps/server/src/modules/work/index.ts` — Work routes. `POST /:id/submit`
  (lines 71-82, CLI `work submit`) and `POST /:id/prepare` exist. Response
  schema for both is `WorkModel.detail`.
- `apps/server/src/modules/work/service.ts` — `submit()` (lines 500-567)
  already converges create-or-update: bound open PR → `PullRequest.updatePullRequest`,
  else `PullRequest.createDraftPullRequest`; registers CI/review awaits;
  persists handoff fields. `prepare()` (lines 371-417) is the local-only variant.
  Helpers to reuse: `requireWork` (line 76), `requirePrimaryThread` (line 84).
- `apps/server/src/modules/work/model.ts` — `submitBody` (lines 120-125) is
  `{ title?, summary?, testPlan?, base? }`. Add the rename body schema here.
- `apps/server/src/modules/pull-request/service.ts` —
  `createDraftPullRequest` (line 769) always creates draft, 409s if an open PR
  is bound; `updatePullRequest` (line 866) pushes + PATCHes title/body only
  (GitHub head ref is immutable — this is why rename must be pre-PR);
  `getBoundPullRequest(sessionId)` (line 413) sync-reads the stored PR from
  `sessions.configJson`; `readRemoteBranchSha({ rootPath, remoteName, branch })`
  (line 312, module-private) does `git ls-remote --heads`; `resolveGitHubRemote`
  (around line 280) throws `AppError` codes `github_remote_missing` /
  `github_remote_not_github` when no GitHub remote exists.
- `apps/server/src/modules/worktree/service.ts` — `BRANCH_PREFIX = 'cradle/wt/'`
  (line 40); `buildWorktreeName` (line 184); `createWorktree` pins
  `branch = ${BRANCH_PREFIX}${name}` once (line 487) and inserts the
  `worktrees` row (line 514). Imports git helpers from `../git/worktree-ops`.
- `apps/server/src/modules/worktree/worktree-reconcile.ts:53-58` — existing
  pattern for updating `worktrees.branch` in DB:
  ```ts
  db().update(worktrees).set({
    branch: match.branch,
    updatedAt: currentUnixSeconds(),
  }).where(eq(worktrees.id, worktree.id)).run()
  ```
- `apps/server/src/modules/git/worktree-ops.ts` — git helpers via
  `runGitCommand(repoPath, args)` (arg arrays, no shell). Has `branchExists`
  (line 99), `deleteLocalBranch` (line 166). **No rename helper exists.**
- `apps/server/src/modules/chat-runtime/harness/system-instructions.ts` —
  `CRADLE_WORK_MODE_SYSTEM_INSTRUCTIONS` (lines 15-133), injected only for
  primary Work threads by `turn-context.ts:93-102`. References `work_submit`
  at lines 49-60, 80, 97, 116-124; line 33-34 already says the branch is
  Cradle-managed.
- `apps/server/src/modules/chat-runtime/harness/turn-context.test.ts:54,157` —
  asserts the injected prompt contains / does not contain `'work_submit'`.
- `resources/skills/cradle-cli/SKILL.md` — line 3 (frontmatter description)
  and the "Work (inspection only)" section (~lines 162-166) reference
  `work_submit`. (`.agents/skills/cradle-cli/` is a synced, gitignored copy —
  do not edit it directly.)
- `apps/server/src/modules/work/README.md` lines 21-23 and 32-34, and
  `apps/server/src/modules/issue-agent/README.md` line 9, reference
  `work_submit` in module-docs invariants.
- No rename capability exists anywhere: grep for `rename_branch|renameBranch`
  returns nothing.

Repo conventions to match:

- Errors: `throw new AppError({ code, status, message, details? })` — see
  usages in `work/service.ts:347-368`.
- MCP tool shape: `server.registerTool(name, { title, description, inputSchema: <zod raw shape> }, execute)`;
  execute returns `{ content: [{ type: 'text', text }], structuredContent?, isError? }`
  and never throws — copy the structure of `submit.ts` exactly.
- Elysia route with TypeBox model + `'x-cradle-cli'` detail metadata — copy
  the `POST /:id/submit` route in `work/index.ts`.
- Module ownership (from `work/README.md`): Worktree owns git checkout
  mutation; Pull Request owns remote/GitHub; Work composes. The rename
  orchestration must respect this (see Step 2).
- Commit style: conventional commits, e.g. `fa662c91 refactor: replace
  work_prepare tool with work_submit for closed-loop finalization`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck server | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Focused tests | `pnpm exec vitest run apps/server/src/modules/agent-tools apps/server/src/modules/work apps/server/src/modules/chat-runtime/harness` | all pass |
| Lint changed files | `pnpm exec eslint apps/server/src/modules/agent-tools apps/server/src/modules/work apps/server/src/modules/git apps/server/src/modules/pull-request apps/server/src/modules/chat-runtime/harness` | exit 0 |
| Regenerate CLI | `pnpm gen:cli` | exit 0; only new `work rename-branch` command files added |
| Full test suite | `pnpm test` | exit 0 (builds plugin-sdk + plugins first; slow but required at the end) |

Run everything from the repo root.

## Suggested executor toolkit

- Skills available in this repo worth invoking: `server-app-development`
  (Elysia route + TypeBox + `x-cradle-cli` conventions) and
  `cli-app-development` (for the `pnpm gen:cli` regeneration step).

## Scope

**In scope** (the only files you should modify):

- `apps/server/src/modules/agent-tools/tools/work/submit.ts` → rename to
  `manage-pull-request.ts` (rewrite contents)
- `apps/server/src/modules/agent-tools/tools/work/submit.test.ts` → rename to
  `manage-pull-request.test.ts` (rewrite contents)
- `apps/server/src/modules/agent-tools/tools/index.ts`
- `apps/server/src/modules/work/service.ts` (add `renameBranch`)
- `apps/server/src/modules/work/model.ts` (add `renameBranchBody`)
- `apps/server/src/modules/work/index.ts` (add `POST /:id/branch` route)
- `apps/server/src/modules/work/service.test.ts` (add rename tests)
- `apps/server/src/modules/work/README.md`
- `apps/server/src/modules/worktree/service.ts` (add `renameWorktreeBranch`)
- `apps/server/src/modules/git/worktree-ops.ts` (add `renameLocalBranch`)
- `apps/server/src/modules/pull-request/service.ts` (export a remote-branch
  existence check)
- `apps/server/src/modules/chat-runtime/harness/system-instructions.ts`
- `apps/server/src/modules/chat-runtime/harness/turn-context.test.ts`
- `apps/server/src/modules/issue-agent/README.md` (one-line doc update)
- `resources/skills/cradle-cli/SKILL.md`
- `packages/cli/src/commands/generated/**` (regenerated output only, via
  `pnpm gen:cli`)

**Out of scope** (do NOT touch, even though they look related):

- The `POST /works/:id/submit` route path and the user-facing
  `cradle work submit` CLI command — Work vocabulary stays on user-facing
  surfaces by decision.
- `PullRequest.createDraftPullRequest` / `updatePullRequest` /
  `markPullRequestReady` behavior — no delivery-logic changes.
- `sessions.configJson` PR storage and the `worktrees` table schema — no
  migration; rename only updates the existing `worktrees.branch` column.
- Any env/header/session-context resolution in agent-tools
  (`http-client.ts`, `runtime-registration.ts`, provider projections) —
  explicitly rejected by the maintainer; `workId` stays an explicit parameter.
- `.agents/skills/**` — gitignored synced copies.
- Desktop/web UI, `work_prepare`-era code (already deleted on this branch).
- `apps/server/src/modules/agent-tools/README.md` — verified it does not
  reference the tool name.

## Git workflow

- Branch: stay on `feat/enhance-work` (or a branch cut from it).
- Commit per logical unit; conventional-commit style, e.g.
  `refactor(agent-tools): rename work_submit to manage_pull_request with git semantics`
  then `feat(work): add pre-PR branch rename`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the git + worktree rename primitives

In `apps/server/src/modules/git/worktree-ops.ts`, add (next to
`deleteLocalBranch`, matching its style):

```ts
export async function renameLocalBranch(
  repoPath: string,
  oldBranch: string,
  newBranch: string,
): Promise<void> {
  await runGitCommand(repoPath, ['branch', '-m', oldBranch, newBranch])
}
```

(`git branch -m` run inside a linked worktree operates on the shared repo and
correctly renames the branch checked out in that worktree.)

In `apps/server/src/modules/worktree/service.ts`, add an exported
`renameWorktreeBranch(input: { worktreeId: string, branch: string })` that:

1. Loads the worktree record via `getWorktreeRecord`; 404
   `worktree_not_found` if absent; 409 `worktree_not_active` if
   `status !== 'active'`.
2. Normalizes `input.branch.trim()`; validates:
   - must start with `BRANCH_PREFIX` (`cradle/wt/`) and have a non-empty
     remainder → else 400 `worktree_branch_invalid`;
   - `git check-ref-format --branch <name>` must succeed (run via
     `runGitCommand`, treat non-zero exit as invalid) → else 400
     `worktree_branch_invalid`;
   - must differ from `record.branch` and `branchExists(repoRoot, branch)`
     must be false → else 409 `worktree_branch_exists`.
3. Runs `renameLocalBranch(record.path, record.branch, branch)`.
4. Updates the DB row exactly like `worktree-reconcile.ts:54-57`
   (`branch` + `updatedAt`) and returns `toWorktreeView` of the updated record.

Note: the worktree directory `name`/`path` intentionally do NOT change — only
the branch. Say so in a one-line comment.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0.

### Step 2: Export a remote-branch existence check from Pull Request

In `apps/server/src/modules/pull-request/service.ts`, export:

```ts
export async function isBranchOnRemote(rootPath: string, branch: string): Promise<boolean>
```

Implementation: call `resolveGitHubRemote(rootPath)`; if it throws an
`AppError` with code `github_remote_missing` or `github_remote_not_github`,
return `false` (no remote ⇒ nothing pushed); rethrow anything else. Otherwise
return `(await readRemoteBranchSha({ rootPath, remoteName: remote.remoteName, branch })) !== null`.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0.

### Step 3: Add `Work.renameBranch` and the `POST /works/:id/branch` route

In `apps/server/src/modules/work/model.ts` add:

```ts
renameBranchBody: t.Object({
  branch: t.String({ minLength: 1 }),
}),
```

In `apps/server/src/modules/work/service.ts` add `renameBranch(input: { id: string, branch: string }): Promise<WorkDetail>`:

1. `requireWork(input.id)`, `requirePrimaryThread(work.id)`.
2. PR guard: `PullRequest.getBoundPullRequest(primaryThread.id)` must be
   `null`; otherwise 409 `work_pull_request_exists` — "Branch can only be
   renamed before the first pull request exists." (Any stored PR, even
   closed/merged, pins the old head ref.)
3. Resolve the worktree: `primaryThread.worktreeId` must be set and the record
   must exist → else 409 `work_isolation_unavailable` (reuse the existing
   code/message style of `assertReadyForDelivery`).
4. Remote guard: `await PullRequest.isBranchOnRemote(worktreeRecord.path, worktreeRecord.branch)`
   must be false → else 409 `work_branch_already_pushed` — "The Work branch
   already exists on the remote and can no longer be renamed."
5. `await Worktree.renameWorktreeBranch({ worktreeId: worktreeRecord.id, branch: input.branch })`.
6. `return (await get(work.id))!`

In `apps/server/src/modules/work/index.ts`, add after the `/submit` route,
copying its shape:

```ts
.post('/:id/branch', async ({ params, body }) => await Work.renameBranch({
  id: params.id,
  branch: body.branch,
}), {
  detail: {
    'summary': 'Rename the Work branch before the first pull request exists',
    'x-cradle-cli': { command: ['work', 'rename-branch'] },
  },
  params: WorkModel.idParams,
  body: WorkModel.renameBranchBody,
  response: { 200: WorkModel.detail },
})
```

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0.

### Step 4: Rewrite the agent tool as `manage_pull_request`

`git mv apps/server/src/modules/agent-tools/tools/work/submit.ts .../manage-pull-request.ts`
(same for the test file) and rewrite.

Tool contract:

- Name: `manage_pull_request`. Registration export renamed to
  `managePullRequestTool`; update `tools/index.ts` accordingly.
- Description keeps the mandatory-finalization tone of the current
  `WORK_SUBMIT_TOOL_DESCRIPTION` but speaks git semantics. It must state:
  call `action: 'create_or_update_draft'` after implementation + local
  verification with a clean checkout — it pushes the branch and creates or
  updates the Draft pull request; call `action: 'rename_branch'` early, once
  the objective is clear and before the first PR exists, to give the managed
  branch a meaningful name; the tool never marks ready, merges, or closes;
  on error do not claim completion.
- Input schema (single zod object, matching the existing raw-shape style):

```ts
{
  workId: z.string().min(1).describe('The active Cradle Work ID supplied in the Work runtime context.'),
  action: z.enum(['create_or_update_draft', 'rename_branch']),
  title: z.string().min(1).optional().describe('PR title. Required for create_or_update_draft.'),
  summary: z.string().min(1).optional().describe('What changed and why. Required for create_or_update_draft.'),
  testPlan: z.string().min(1).optional().describe('Verification performed. Required for create_or_update_draft.'),
  base: z.string().min(1).optional().describe('Optional PR base branch.'),
  branchName: z.string().min(1).optional().describe('New branch name with the cradle/wt/ prefix. Required for rename_branch.'),
}
```

- Execute: validate per-action required fields FIRST (missing → return
  `isError: true` with a message naming the missing field, no HTTP call).
  - `create_or_update_draft` → `requestAgentToolJson({ path: \`/works/${encodeURIComponent(workId)}/submit\`, body: { title, summary, testPlan, base? }, responseSchema })`
    — identical to the current submit call, including the response schema and
    the success/remediation text shape (keep `structuredContent`, rename the
    prose to say "Draft PR created/updated" instead of "Work submitted").
  - `rename_branch` → `requestAgentToolJson({ path: \`/works/${encodeURIComponent(workId)}/branch\`, body: { branch: branchName }, responseSchema })`
    with a small zod response schema (`{ work: { id: ... }, ... }.passthrough()`
    in the same style); success text reports old→new from
    `execution.worktreeBranch` when present, and reminds the agent the branch
    can no longer be renamed once a PR exists.
- Error handling: copy the existing `AgentToolHttpRequestError` pattern
  verbatim, parameterized by action.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0.

### Step 5: Update the Work Mode system prompt and skill docs

In `apps/server/src/modules/chat-runtime/harness/system-instructions.ts`:

- Replace every `work_submit` mention with `manage_pull_request` (action
  `create_or_update_draft`); keep the closed-loop rules (lines 44-74, 91-100,
  116-133) otherwise intact.
- Add one new numbered instruction under "Important instructions" (and a
  matching bullet in the "Tool rules" section): once the objective is clear
  and BEFORE the first commits, call `manage_pull_request` with
  `action: 'rename_branch'` and a `cradle/wt/`-prefixed meaningful name;
  available only before the first PR exists; after that the branch name is
  fixed. Line 33-34 ("Do not invent cloud-style branch templates") stays and
  now refers to the rename path.

In `resources/skills/cradle-cli/SKILL.md`: replace the two `work_submit`
references (frontmatter description line 3; "Work (inspection only)" section)
with `manage_pull_request`. In `apps/server/src/modules/work/README.md`:
update the invariants at lines 21-23 and 32-34 to name `manage_pull_request`
and add one invariant line: the Work branch may be renamed via
`POST /works/:id/branch` only while no pull request exists and the branch is
not on the remote; the worktree directory name/path never changes. In
`apps/server/src/modules/issue-agent/README.md` line 9: `work_submit` →
`manage_pull_request`.

In `apps/server/src/modules/chat-runtime/harness/turn-context.test.ts`:
update the two assertions (lines 54, 157) from `'work_submit'` to
`'manage_pull_request'`.

**Verify**: `pnpm exec vitest run apps/server/src/modules/chat-runtime/harness` → all pass.
Also `grep -rn "work_submit" apps/server/src resources/skills` → no matches.

### Step 6: Tests

Rewrite `manage-pull-request.test.ts` modeled on the old `submit.test.ts`
(fetch-mock style, `vi.stubEnv('CRADLE_SERVER_URL', ...)`), covering:

- description contains mandatory language (`MUST call`, `MUST NOT claim
  completion`, `Draft pull request`) and both action names;
- `create_or_update_draft` POSTs to `/works/work-1/submit` with
  `{ title, summary, testPlan }` body and maps the PR into
  `structuredContent` (reuse the old test's fixture);
- `rename_branch` POSTs to `/works/work-1/branch` with `{ branch: 'cradle/wt/x' }`;
- missing `title` for `create_or_update_draft` and missing `branchName` for
  `rename_branch` → `isError: true` and fetch NOT called;
- 409 from server → `isError: true`, text contains the error code and
  remediation language.

Add to `apps/server/src/modules/work/service.test.ts` (pattern: seed DB via
`seedWork()`, mock module functions with `vi.spyOn` — see
`mockHealthyDetailReads` at line 64; the worktree row needs a `worktrees`
insert + `sessions.worktreeId` set, follow existing fixtures in that file):

- happy path: `getBoundPullRequest` → null, `isBranchOnRemote` → false,
  `Worktree.renameWorktreeBranch` mocked → resolves; expect the spy called
  with the new branch and the returned detail to exist;
- PR bound → rejects with `AppError` code `work_pull_request_exists`,
  rename spy not called;
- branch on remote → rejects with `work_branch_already_pushed`, rename spy
  not called.

**Verify**: `pnpm exec vitest run apps/server/src/modules/agent-tools apps/server/src/modules/work` → all pass, including the new tests.

### Step 7: Regenerate the CLI and run full gates

`pnpm gen:cli` → exit 0; `git status` shows only new/changed files under
`packages/cli/src/commands/generated/work/` (a `rename-branch.ts` command and
the registration line in `index.generated.ts`). If gen:cli rewrites unrelated
generated files, STOP and report instead of committing them.

Then run the full gates from the commands table: `pnpm --filter @cradle/server
typecheck`, the eslint command, and finally `pnpm test`.

**Verify**: all three exit 0; `pnpm test` passes including the new tests.

## Test plan

Covered by Step 6. Structural patterns: tool tests after the old
`apps/server/src/modules/agent-tools/tools/work/submit.test.ts`; service
tests after `apps/server/src/modules/work/service.test.ts` (DB seed +
`vi.spyOn` module mocks, no real git). No test exists for
`worktree/service.ts` and this plan does not add one — the git rename helper
is a thin `runGitCommand` wrapper covered transitively through the mocked
Work-level tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm test` exits 0; new tests for the tool actions and
  `Work.renameBranch` guards exist and pass
- [ ] `grep -rn "work_submit" apps/server/src resources/skills` returns no matches
- [ ] `grep -rn "manage_pull_request" apps/server/src/modules/agent-tools/tools/index.ts` returns a match
- [ ] `curl -X POST localhost:21423/works/<id>/branch` (or the generated
  `cradle work rename-branch`) renames the branch pre-PR and returns 409 with
  `work_pull_request_exists` after a PR exists (manual smoke, optional if no
  local server data)
- [ ] `packages/cli` generated changes limited to the new `work rename-branch`
  command (`git status`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `apps/server/src/modules/agent-tools/tools/work/submit.ts` does not exist —
  you are not on `feat/enhance-work` (see Branch requirement).
- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written).
- A step's verification fails twice after a reasonable fix attempt.
- The rename appears to require touching the DB schema, PR storage
  (`sessions.configJson`), or the worktree directory path — all are out of
  scope by decision.
- `pnpm gen:cli` produces diffs outside
  `packages/cli/src/commands/generated/work/`.
- You discover the Work branch CAN be pushed somewhere other than the
  pull-request delivery path (that would break the "local-only before first
  submit" assumption behind the pre-PR rename guard).

## Maintenance notes

- Future multi-PR/multi-branch cardinality (the v1 constraint is 1 Work · 1
  Worktree · 1 PR) will require revisiting both the single-PR convergence in
  `Work.submit` and the pre-PR-only rename guard.
- If a second agent-facing tool is added, keep the vocabulary split: git/PR
  semantics for agent tools, Work vocabulary for user-facing CLI/UI.
- `worktree-reconcile.ts:53-58` self-heals `worktrees.branch` from git state;
  a manual `git branch -m` by the user inside the worktree is therefore
  absorbed silently. If that becomes undesirable, reconcile is the place to
  tighten — not this plan's rename path.
- Reviewers should scrutinize: the guard order in `Work.renameBranch` (PR
  guard before remote guard before mutation), and that no code path pushes a
  renamed branch before the first submit (push stays inside
  `ensureBranchPushed`, called only from PR create/update).
