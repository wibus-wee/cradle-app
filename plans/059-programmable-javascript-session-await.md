# Plan 059: Programmable JavaScript Session Awaits via managed-process cell evaluation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2867b64..HEAD -- apps/server/src/modules/session-await apps/server/src/modules/javascript-eval packages/db/src/schema/session-await.ts packages/cli/src/commands packages/cli/src/index.ts apps/server/src/app.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `2867b64`, 2026-07-17

## Why this matters

Session Await currently waits on external conditions through source-specific runtime
adapters (`github-ci`, `github-review`, `cradle-issue-agent`, `cradle-issue-status`,
`timer`, `manual`). Every new wait condition requires shipping new runtime code, and
the adapters keep accumulating product knowledge they cannot fully encode — the
`github-ci` source alone is 772 lines and still mismatched a real CI topology
(Vercel status observed before GitHub Actions checks appeared → premature completion;
review await stuck pending after a merge without approval). The Agent already knows
general-purpose tools (`gh`, `jq`, `curl`); it should express the wait condition
directly as a small deterministic program instead of asking Cradle for an
ever-growing collection of semantic wrappers.

This plan adds two things: (1) a reusable, bounded **JavaScript cell evaluator**
(new server module `javascript-eval`) that executes Agent-authored inline async functions
or complete ES modules inside a disposable managed Node process, and (2) a
new `javascript` Session Await source that periodically re-evaluates an immutable
stored cell until it reports completion, resuming the chat session on both success
and terminal failure.

**Deliberate design decision:** cells run as real Node code in a child process managed
by `apps/server/src/infra/managed-process.ts` — **not** in a QuickJS/WASM isolate,
`node:vm`, or a worker thread. The process is a *reliability* boundary (V8 old-space
setting plus wall-clock process-group termination), not a security boundary:
Cradle is a local, user-owned agent environment and the cell inherits the same
authority the Agent's shell already has. Do not add permission prompts, command
allowlists, or network restrictions to the cell. Process isolation is required because
`process.exit()`, OOM, or native crashes inside a worker still share the server process.

The preferred Agent-facing contract is the bare expression
`async ({ tools, cwd }) => false`. Complete modules using `export default` remain
available for advanced file-based cells. The server detects real default exports with
`es-module-lexer` and normalizes bare expressions; CLI code does not use substring
heuristics. Registration invokes Node's static `--check` mode without importing the
module, so top-level code cannot run as a validation side effect.

## Current state

The relevant files, each with one line on its role:

- `apps/server/src/modules/session-await/types.ts` — source adapter contract (full file is 57 lines):
  ```ts
  export interface SessionAwaitSource {
    source: string
    pollIntervalMs?: number
    checkPending: (awaits: SessionAwait[]) => Promise<CheckResult[]>
  }
  ```
  `CheckResult` is `{ awaitId, matched: true, resumeText, resumePayloadJson? }` or
  `{ awaitId, matched: false, transientError?, permanentError? }`.
- `apps/server/src/modules/session-await/poller.ts` — 30 s tick; per source it calls
  `adapter.checkPending(pending)` and maps results (`poller.ts:135-154`): `matched` →
  `service.trigger(...)`; `permanentError` → `service.markFailed(...)`; `transientError`
  → `service.updateLastChecked(id, error)`; clean pending → `service.updateLastChecked(id)`.
  Cycles never overlap (`running` flag), so one evaluation per await at a time is
  already guaranteed. `MAX_CHECKS_PER_SOURCE = 100`.
- `apps/server/src/modules/session-await/service.ts` — durable writes. `register()`
  (lines 156-240) validates source against `SupportedAwaitSourceSchema` (lines 39-46:
  `'github-ci' | 'github-review' | 'manual' | 'timer' | cradle issue sources`), parses
  per-source filter schemas, validates session/workspace existence, then calls
  `validateAwaitSource(source, filterJson)` (line 138) which today only preflights
  GitHub targets. `markFailed(awaitId, errorText)` (lines 380-392) sets
  `status: 'failed', failureKind: 'source'`. `updateLastChecked(awaitId, errorText?)`
  (lines 394-405) records check time/error. `trigger()` (lines 264-310) marks the row
  triggered then enqueues the resume message through
  `enqueueSessionQueueItem({ sessionId: row.chatSessionId, text })` imported from
  `../chat-runtime/runtime` (lines 18, 77-82) — this is the durable continuation path
  that survives a busy session.
- `apps/server/src/modules/session-await/index.ts` — Elysia plugin with
  `prefix: '/session-awaits'`; registers sources in `.onStart` (lines 17-23) and
  mounts routes. Route `detail` carries `'x-cradle-cli': { command: [...] }` metadata
  for generated CLI commands.
- `apps/server/src/modules/session-await/model.ts` — TypeBox schemas; `sessionAwait`
  response object (lines 19-37) mirrors the DB row.
- `apps/server/src/modules/session-await/sources/cradle-issue-agent.ts` — **exemplar
  source adapter**: zod filter schemas, a `normalize...AwaitFilter` for registration,
  and a `checkPending` that maps rows to `CheckResult`s. Match its style.
- `packages/db/src/schema/session-await.ts` — `sessionAwaits` drizzle table (55 lines).
  Migrations live in `packages/db/drizzle/` and are auto-applied at server startup by
  `apps/server/src/database/migration-runner.ts` (`migrate(db, { migrationsFolder })`).
  Generate new ones with `pnpm --filter @cradle/db generate` (drizzle-kit).
- `packages/cli/src/commands/session-await.ts` — hand-written (manual) CLI commands
  `cradle session await github-ci|github-review|issue-agent|issue-status|manual|retry`.
  They build a body and POST via `context.request({ body, method: 'post', path: {},
  query: {}, template: '/session-awaits/' })` (see `createAwait`, lines 156-167).
- `packages/cli/src/index.ts` — registers manual commands:
  `registerSessionAwaitCommand(program)` at line 17.
- `apps/server/src/app.ts` — module mounting: `import { sessionAwait } from
  './modules/session-await'` (line 63), `app.use(sessionAwait)` (line 209).
- `apps/server/src/modules/workspace/workspace-locator.ts` —
  `readWorkspaceLocatorJson(json)` parses `workspaces.locatorJson` into
  `{ hostId, path, kind?, sourceWorkspaceId? }` (zod). Use it to resolve the await's
  workspace working directory.
- `.agents/skills/cradle-cli/SKILL.md` — the agent-facing usage doc; its await section
  (around lines 187-227) teaches agents to register awaits. It must learn the new
  commands.

Conventions to follow:

- **Error handling**: routes throw `new AppError({ code, status, message, details? })`
  from `apps/server/src/errors/app-error` (see `session-await/index.ts:43` and
  `service.ts:160-165`). Registration-time validation failures are 400 with a
  snake_case code.
- **Validation**: zod in services/sources (`service.ts`, `cradle-issue-agent.ts`),
  TypeBox in `model.ts` for HTTP boundaries.
- **Commits**: conventional commits — e.g. `feat(server): ...`, `test(server): ...`,
  `chore(db): ...` (see `git log --oneline`).
- **Module docs**: every server module has a `README.md` describing ownership and
  semantics (`session-await/README.md` is the exemplar).
- Known quirk: older tests seed `workspaces.locatorJson` as
  `{"kind":"local","path":"/tmp/ws"}` (e.g. `apps/server/tests/session-await.test.ts:87`),
  which does **not** satisfy the current `workspaceLocatorSchema` (`hostId` required).
  New tests must seed the current shape: `{ hostId: 'local', path: <dir>, kind: 'project' }`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Generate DB migration | `pnpm --filter @cradle/db generate` | new `packages/db/drizzle/00XX_*.sql` |
| Server typecheck (incl. module-boundary check) | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Server focused tests | `pnpm --filter @cradle/server exec vitest run tests/javascript-await.test.ts` | all pass |
| Full server suite | `pnpm --filter @cradle/server test` | all pass (builds plugin-sdk + plugins first; slow) |
| CLI typecheck | `pnpm --filter @cradle/cli typecheck` | exit 0 |
| CLI tests (root vitest covers `packages/**`) | `pnpm exec vitest run packages/cli/src/commands/session-await.test.ts packages/cli/src/commands/javascript.test.ts` | all pass |
| Lint changed files only (repo-wide lint has pre-existing debt) | `pnpm exec eslint <changed paths>` | exit 0 |

## Suggested executor toolkit

- Project skills worth loading if available in your environment:
  `.agents/skills/server-app-development` (module/route/TypeBox/x-cradle-cli
  conventions) and `.agents/skills/cli-app-development` (manual CLI command
  conventions) — both document rules this plan already encodes.
- Existing managed process implementation:
  `apps/server/src/infra/managed-process.ts` and `managed-process-runner.ts`.

## Scope

**In scope** (the only files you should modify):

- `apps/server/src/modules/javascript-eval/` — **new module**: `index.ts`, `model.ts`,
  `program.ts`, `runner.ts`, `evaluator.ts`, `README.md`, `evaluator.test.ts`
- `apps/server/src/modules/session-await/sources/javascript.ts` — **new** source adapter
- `apps/server/src/modules/session-await/index.ts` — register the source
- `apps/server/src/modules/session-await/service.ts` — source enum + registration
  validation + `updateLastChecked` counter + failure-resume function
- `apps/server/src/modules/session-await/types.ts` — `resumeOnFailure?: boolean`
- `apps/server/src/modules/session-await/poller.ts` — failure-resume dispatch
- `apps/server/src/modules/session-await/model.ts` — expose `consecutiveErrorCount`
- `apps/server/src/modules/session-await/README.md` — document the new source
- `packages/db/src/schema/session-await.ts` + generated `packages/db/drizzle/` migration
- `apps/server/src/modules/work/service.test.ts` — **one-line type repair only**: its
  `mockSessionAwaitRegister()` builds a full `SessionAwait` (`$inferSelect`) row literal
  (~line 113), which the new non-null `consecutiveErrorCount` field breaks; add
  `consecutiveErrorCount: 0` and nothing else
- `packages/cli/src/commands/javascript.ts` — **new** manual command
- `packages/cli/src/commands/session-await.ts` — add `javascript` await subcommand
- `packages/cli/src/commands/session-await.test.ts`, new
  `packages/cli/src/commands/javascript.test.ts`
- `packages/cli/src/index.ts` — register the manual command
- `apps/server/tests/javascript-await.test.ts` — **new** integration tests
- `apps/server/src/app.ts` — mount the new module
- `.agents/skills/cradle-cli/SKILL.md` — document the new commands for agents

**Out of scope** (do NOT touch, even though they look related):

- Existing typed sources (`github-ci.ts`, `github-review.ts`, `cradle-issue-*.ts`) and
  their behavior. They stay the simple path; this plan adds the escape hatch.
- `github-ci`/`github-review` live-status routes, bypass rules, `fetchAvailableChecks`.
- Any QuickJS/WASM/isolate dependency — explicitly rejected for v1 (see "Why this
  matters"). Do not add packages to `node_modules`.
- Changing resume-on-failure behavior of existing sources (`resumeOnFailure` is
  opt-in; only `javascript` sets it in this plan).
- Per-await polling cadence, per-cell scheduling, workflow composition (`all`/`any`/
  `sequence` of cells), persistent JS heap state across polls — all deferred.
- A recipe Skill of `gh` snippets for cell authors — follow-up work, not this plan.
- `apps/web` UI for awaits.

## Git workflow

- Branch: `advisor/059-javascript-session-await` (or work directly if the operator
  says so); commit per logical unit (schema+migration / evaluator module / await
  source / CLI / tests / docs).
- Message style: `feat(server): add javascript-eval module ...`, `chore(db): add
  session_awaits.consecutive_error_count`, `feat(cli): add javascript commands`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `consecutive_error_count` column

In `packages/db/src/schema/session-await.ts`, add to the `sessionAwaits` table
(after `lastErrorText`):

```ts
consecutiveErrorCount: int('consecutive_error_count').notNull().default(0),
```

Run `pnpm --filter @cradle/db generate`. Inspect the generated SQL in
`packages/db/drizzle/`: it must contain exactly one `ALTER TABLE session_awaits ADD
COLUMN consecutive_error_count ...` statement and nothing else. If drizzle-kit tries
to recreate or alter other tables, STOP (schema drift).

**Verify**: `pnpm --filter @cradle/db generate` → one new migration file whose SQL
touches only `session_awaits`.

### Step 2: Create the `javascript-eval` managed-process evaluator

Create `apps/server/src/modules/javascript-eval/` with `program.ts`, `runner.ts`,
`evaluator.ts`, `model.ts`, `index.ts`, tests, and a README. Remove the original
worker-source shim.

`program.ts` initializes `es-module-lexer`, detects a real default export from lexer
records, and otherwise wraps the complete input as `export default (<source>)`.
This makes `async ({ tools, cwd }) => false` the compact recommended form while
preserving complete modules. Do not inspect the source with `includes()` or a regex.

Check mode starts a managed Node child with `--input-type=module --check` and sends
the normalized program over stdin. It never imports the program. Run mode starts
the separately built `runner.ts` with the workspace as the child process cwd and
`--max-old-space-size=128`. The host sends the normalized program over stdin. The
runner imports it from a data URL, verifies the default export is a function, calls
it with `{ tools, cwd: process.cwd() }`, and writes its result protocol to a private
temporary file. A file protocol is used so normal cell stdout cannot corrupt it.

Start both children through `spawnManagedProcess`. On evaluation timeout call the
managed child's `stop()` method so the target process group and command descendants
are terminated. A missing result after exit is `crashed`; syntax/module-shape issues
are `program-error`; a thrown cell or tool failure is `execution-error`.

The stable result union is `completed`, `check-passed`, `program-error`,
`execution-error`, `timeout`, or `crashed`. Keep the 64 KiB source limit, 256 KiB
per-stream command output limit, 30 s defaults, and 120 s route clamp. Describe the
128 MiB setting accurately as a V8 old-space setting, not a system memory quota.

Add `javascript-eval-runner` as an explicit Vite server build entry next to
`managed-process-runner`. Verify both source-mode tests and the production server
build, because the evaluator resolves different runner paths in those two layouts.

**`model.ts`** — TypeBox for the HTTP boundary:

- `evaluateBody`: `{ program: string (minLength 1), timeoutMs?: number, cwd?: string }`
- `evaluateResponse`: `{ ok: boolean, result?: unknown, error?: string, kind?: string }`

**`index.ts`** — Elysia plugin (pattern: `session-await/index.ts:13-16`):

```ts
export const javascriptEval = new Elysia({ prefix: '/javascript', detail: { tags: ['javascript'] } })
  .post('/evaluate', async ({ body }) => { ... }, { body: model.evaluateBody, response: { 200: model.evaluateResponse } })
```

The handler: reject `Buffer.byteLength(body.program, 'utf8') > MAX_PROGRAM_BYTES`
with `AppError({ code: 'javascript_program_too_large', status: 400 })`; clamp
`timeoutMs` to `[1000, EVAL_MAX_TIMEOUT_MS]`; run the evaluator; map
`completed` → `{ ok: true, result }`, everything else →
`{ ok: false, error, kind }` (`error` for timeout is
`"Evaluation timed out after N ms"`). Do **not** add `x-cradle-cli` metadata — the
CLI command is hand-written (Step 6) so it can support `--program-file`.

Mount in `apps/server/src/app.ts`: import next to line 63, `app.use(javascriptEval)`
next to line 209.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0. Then the unit tests
from the Test plan section for this module pass.

### Step 3: `javascript` Session Await source adapter

Create `apps/server/src/modules/session-await/sources/javascript.ts`. Follow the
`cradle-issue-agent.ts` exemplar structure.

- `export const JAVASCRIPT_AWAIT_SOURCE = 'javascript'`.
- Stored filter schema (zod): `{ program: z.string().min(1).max(MAX_PROGRAM_BYTES) }`.
- `export async function validateJavaScriptAwaitFilter(filterJson: string):
  Promise<void>` — parses the filter, then runs the evaluator in `check` mode with a
  10 s timeout; on any non-`check-passed` outcome throw
  `AppError({ code: 'session_await_program_invalid', status: 400, message: <error
  detail> })`. Wire this into `service.ts`'s `validateAwaitSource` (mirroring the
  GitHub branch at `service.ts:110-140`) and add `'javascript'` to
  `SupportedAwaitSourceSchema` (line 39-46) with its filter-parse branch next to
  line 184-192.
- Await cell result contract, enforced here (not in the evaluator):
  ```ts
  type AwaitCellResult = false | { resumeText: string, payload?: JsonValue }
  ```
  `false` → still pending; object with non-blank string `resumeText` → completed;
  anything else (including `undefined`, `null`, `true`, blank `resumeText`) → invalid.
  `payload` is serialized with `JSON.stringify`; reject if the result exceeds
  `MAX_RESUME_PAYLOAD_BYTES = 32 * 1024`.
- `checkPending(awaits)`: evaluate ordered batches of at most three cells. Per row:
  1. Parse filter (parse failure → `permanentError`, it cannot happen after
     registration validation but must not throw).
  2. Resolve cwd: read the `workspaces` row by `row.workspaceId`, parse
     `locatorJson` with `readWorkspaceLocatorJson` (import from
     `../../workspace/workspace-locator`); missing row or parse failure →
     `permanentError('Workspace for javascript await no longer exists or is not local')`.
  3. Evaluate with `{ program, cwd: locator.path, timeoutMs: 45_000 }`.
  4. Map the outcome:
     - `completed` + valid cell result → matched/pending `CheckResult` per contract.
     - `completed` + invalid result → `permanentError('Cell returned an invalid
       result: <why>')`.
     - `error` / `timeout` / `crashed` → build the actual error text
       (e.g. `Evaluation timed out after 45000 ms`, the cell's thrown message, or the
       crash message). If `row.consecutiveErrorCount + 1 >=
       MAX_CONSECUTIVE_EVALUATION_ERRORS` (5) → `permanentError('Evaluation failed 5
       times consecutively; last error: <text>')`, else `transientError(text)`.
- `export const javascriptAwaitSource: SessionAwaitSource = { source:
  JAVASCRIPT_AWAIT_SOURCE, resumeOnFailure: true, checkPending }`.

Register in `session-await/index.ts` `.onStart` next to the other
`Poller.registerSource(...)` calls.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0 (this also runs
`check-module-boundaries`; a new `session-await → javascript-eval` edge is expected
and legal — a cycle is not; if one is reported, STOP: `javascript-eval` must not
import from `session-await`).

### Step 4: Failure counter + resume-on-terminal-failure

`packages/db` column from Step 1 is now wired:

1. `service.ts` `updateLastChecked(awaitId, errorText?)`: when `errorText` is
   present, set `consecutiveErrorCount` to `sql\`${sessionAwaits.consecutiveErrorCount}
   + 1\`` (import `sql` from `drizzle-orm`); when absent, reset to `0`. This is
   generic and inert for existing sources (nothing reads the counter except the
   javascript adapter).
2. `types.ts`: add `resumeOnFailure?: boolean` to `SessionAwaitSource`.
3. `service.ts`: new exported `resumeFailedAwait(awaitId: string, errorText: string):
   Promise<void>` — loads the row (return silently if missing), enqueues a resume
   message through the existing private `enqueueResume(row, text)` helper with text
   shaped as:
   `Session await (<source>) failed: <errorText>\n\nDecide how to proceed: fix the
   condition and register a new await, or continue without it.`
   On enqueue error, best-effort append ` (failure resume delivery failed: <err>)` to
   the row's `lastErrorText` via a direct update — no retry, no failureKind change.
4. `poller.ts` permanent-error branch (`poller.ts:145-147`): after
   `service.markFailed(...)`, `if (adapter.resumeOnFailure) await
   service.resumeFailedAwait(result.awaitId, result.permanentError)`.
5. `model.ts` `sessionAwait` response object: add `consecutiveErrorCount: t.Number()`.

**Verify**: server typecheck exits 0; integration tests (Test plan) covering the
counter and failure resume pass.

### Step 5: CLI — `cradle session await javascript`

In `packages/cli/src/commands/session-await.ts`, add a `javascript` subcommand to
`registerSessionAwaitCommand`, following the existing subcommand pattern:

- Options: `--program <source>`, `--program-file <path>` (exactly one required),
  plus the common await options (`--chat-session-id`, `--workspace`, `--reason`,
  `--expires-at`, `--format`, `--json`) reused via `buildCommonCreateBody`.
- Read file contents with `readFileSync(path, 'utf8')` when `--program-file` is used;
  a read failure throws a clear CLI error.
- Convenience: if the source does not contain `export default`, wrap it as
  `export default <source>` before sending (lets agents pass a bare
  `async ({ tools }) => ...` expression). The server contract is always a complete
  ES module with a default export.
- Body: `{ ...common, source: 'javascript', filterJson: JSON.stringify({ program }) }`,
  posted through the existing `createAwait` helper.

**Verify**: `pnpm --filter @cradle/cli typecheck` → exit 0; new CLI tests pass.

### Step 6: CLI — `cradle javascript evaluate`

New file `packages/cli/src/commands/javascript.ts`, exporting
`registerJavascriptCommand(root: Command)` (pattern: `session-await.ts`):

- Command tree: `javascript` → `evaluate`.
- Options: `--program <source>` / `--program-file <path>` (exactly one required),
  `--cwd <path>`, `--timeout-ms <n>`, `--format`, `--json`.
- Apply the same `export default` wrapping convenience as Step 5.
- POST `template: '/javascript/evaluate'` with body `{ program, cwd?, timeoutMs? }`
  via `context.request`, print via `printResult` + `buildOutputOptions` (copy the
  helpers' usage from `session-await.ts`; if `buildOutputOptions` needs to move to be
  shared, duplicate it locally in the new file — do not refactor the existing one).
- Register in `packages/cli/src/index.ts` after `registerSessionAwaitCommand(program)`.

**Verify**: `pnpm --filter @cradle/cli typecheck` → exit 0;
`pnpm exec vitest run packages/cli/src/commands/javascript.test.ts` (run from the
repo root — the root vitest config covers `packages/**`) → pass.

### Step 7: Docs

1. `apps/server/src/modules/javascript-eval/README.md` — new module doc: ownership
   (bounded JS cell evaluation primitive + standalone evaluate route), the trust
   model (reliability boundary, not a permission system; cell inherits session/shell
   authority), the limits table (all constants from Step 2), and the explicit
   v1 exclusions (no package imports, no persisted heap, no per-cell scheduling).
2. `apps/server/src/modules/session-await/README.md` — add a "JavaScript Source"
   section: cell contract (`false | { resumeText, payload? }`), immutable program in
   `filterJson`, workspace cwd, failure semantics (transient vs. invalid-result vs.
   5× consecutive → failed, `resumeOnFailure`), and the new
   `consecutive_error_count` column.
3. `.agents/skills/cradle-cli/SKILL.md` — extend the await section (around lines
   187-227) with `cradle session await javascript --program-file ./await-ci.mjs
   --reason "..."` and one complete, correct example cell that waits for a named
   GitHub Actions workflow on a commit (`gh run list --repo <owner/repo> --commit
   <sha> --json databaseId,workflowName,status,conclusion` → find by `workflowName`,
   return `false` while missing/not completed, then
   `{ resumeText, payload }`). Also document `cradle javascript evaluate
   --program-file` as the way to dry-run a cell before registering it.

**Verify**: `pnpm exec eslint` on all changed/added files → exit 0.

## Test plan

**Unit — `apps/server/src/modules/javascript-eval/evaluator.test.ts`** (vitest):

- cell `export default async () => false` → `{ kind: 'completed', result: false }`
- cell returning `{ resumeText: 'done', payload: { a: 1 } }` → completed with that object
- cell using `await tools.exec({ argv: [process.execPath, '-e', 'console.log("hi")'] })`
  and returning `result.stdout.trim()` → completed with `'hi'`
- cell that throws `new Error('boom')` → `{ kind: 'execution-error' }` with `'boom'` in the message
- cell with a syntax error, `mode: 'check'` → `{ kind: 'program-error' }`; valid module in
  check mode → `{ kind: 'check-passed' }`
- cell with no default export (empty module) → error mentioning default export
- cell `while (true) {}` with `timeoutMs: 500` → `{ kind: 'timeout' }` (test must
  complete in ~1 s, proving `terminate()` interrupts the loop)
- cell returning a function value → `{ kind: 'execution-error' }` (clone failure)

**Integration — `apps/server/tests/javascript-await.test.ts`** (model after
`apps/server/tests/session-await.test.ts`: temp `CRADLE_DATA_DIR` via
`mkdtempSync`, `vi.mock('../src/modules/chat-runtime/runtime', () => ({
enqueueSessionQueueItem: vi.fn() }))`, seed workspace/session rows, `registerSource`,
`runOnce()`; seed `locatorJson` with the **current** shape `{ hostId: 'local',
path: <tmpdir>, kind: 'project' }`):

- `register()` with an invalid program (syntax error) → `AppError` with code
  `session_await_program_invalid`; nothing inserted
- register valid await; cell returns `false` → after `runOnce()`, row stays pending,
  `consecutiveErrorCount` 0, no enqueue
- cell returns `{ resumeText: 'CI done', payload: { conclusion: 'success' } }` → row
  triggered, `resumeText` stored, `enqueueSessionQueueItem` called with the text
- cell throws every time → after each `runOnce()`, row pending with
  `consecutiveErrorCount` incrementing; after the 5th, row `failed` with
  `failureKind: 'source'` and `enqueueSessionQueueItem` called with failure context
- cell returns an invalid result (e.g. `true`) → failed immediately after one cycle
  (+ failure resume enqueued)
- reset check: a throwing cell followed by a clean `false` evaluation resets
  `consecutiveErrorCount` to 0 (drive with two awaits or by editing the stored
  filter between runs — simplest: two sequential scenarios in one test)

**CLI — extend `packages/cli/src/commands/session-await.test.ts`** and add
`packages/cli/src/commands/javascript.test.ts` (pattern: mocked `context.request`,
temp env vars, `registerSessionAwaitCommand`):

- `session await javascript --program 'export default async () => false'` posts
  `source: 'javascript'` with `filterJson: '{"program":"export default async () => false"}'`
- bare expression `--program 'async () => false'` is forwarded unchanged; the server
  owns lexer-based normalization
- `--program-file` reads the file (write a temp `.mjs` in the test)
- passing both `--program` and `--program-file` → throws "exactly one" error
- `javascript evaluate --program-file <tmp>` posts to `/javascript/evaluate` with
  the file contents

**Verification**: all commands in the table pass; focused suites first, then
`pnpm --filter @cradle/server test` (full) and the root CLI vitest invocation.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @cradle/server typecheck` exits 0 (includes module-boundary check)
- [ ] `pnpm --filter @cradle/cli typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0, including the new
      `tests/javascript-await.test.ts` and `javascript-eval/evaluator.test.ts`
- [ ] `pnpm exec vitest run packages/cli/src/commands/session-await.test.ts
      packages/cli/src/commands/javascript.test.ts` exits 0
- [ ] `grep -n "consecutive_error_count" packages/db/drizzle/*.sql` finds exactly one
      new migration statement
- [ ] `grep -rn "quickjs\|isolated-vm" apps/server/package.json packages/db/package.json`
      returns no matches
- [ ] `pnpm exec eslint` on every changed file exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts (drift
  since `2867b64`).
- `drizzle-kit generate` produces SQL touching anything beyond adding
  `session_awaits.consecutive_error_count`.
- `check-module-boundaries` reports a cycle involving `javascript-eval`
  (means an import direction is wrong — fix the direction only if it is obviously
  inverted; otherwise STOP).
- A step's verification fails twice after a reasonable fix attempt.
- The managed process cannot terminate an infinite-loop cell and its child process
  group on a supported platform.
- The fix appears to require touching an out-of-scope file.

## Maintenance notes

- **Cell contract is the stable seam.** `false | { resumeText, payload? }` and the
  evaluator's `EvaluateCellResult` are designed so the execution backend can later be
  swapped (e.g. to a QuickJS isolate for multi-tenant use) without touching the
  await adapter, CLI, or tests' observable behavior. Review any change to these
  shapes as a breaking protocol change.
- **Bounded evaluations**: `checkPending` evaluates three cells concurrently and
  processes larger source batches in chunks. Change the concurrency only with
  production evidence; never fan out all pending cells at once.
- **Memory setting is deliberately loose** (128 MB V8 old-space). Tighten only with
  evidence from real cells; flaky OOM kills on innocent cells would be worse.
- **Failure resume is best-effort**: if enqueueing the failure message fails, the
  row keeps `failureKind: 'source'` with the delivery error appended to
  `lastErrorText`; there is no retry path for failure resumes (unlike success
  delivery, which has `retry-delivery`). Adopting `resumeOnFailure` for the typed
  sources is a separate, deliberate decision — do not flip it casually.
- **Follow-ups deferred from this plan**: a recipe Skill of reliable `gh --json`
  cell patterns (behavioral evidence should come first); observability events for
  evaluation duration/tool calls; per-await `timeoutMs` in the filter; reducing or
  reimplementing the typed GitHub sources on top of this primitive (only after
  behavioral comparison).
- Reviewer scrutiny points: the runner's `execFile` argument handling (no shell
  interpolation anywhere — argv arrays only), the counter increment SQL, the
  pending-to-failed race, and that registration validation uses static Node check
  mode without importing the module.

Revision note (2026-07-17): replaced the worker-thread backend with the existing
managed-process boundary after review found that worker threads share process cwd
and fatal process state. The Agent-facing contract now prefers bare inline async
functions, while complete ES modules remain supported.
