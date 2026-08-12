# Plan 063 M0 launch-policy GitHub Actions unit fix (Fix V)

## Scope and source evidence

This Fix node addresses only the task-related unit failure in GitHub Actions run `31631897209`, Unit job `94232462334`: `m0 launch policy > rejects the allowance outside a Linux GitHub Actions runner`. Before editing, I read the complete living ExecPlan at `docs/exec-plans/20260813-01-desktop-server-transport.md`, the complete architecture authority at `plans/063-eliminate-desktop-server-sockets.md`, the repository instructions, and all three current launch-policy files:

- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.d.mts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.test.ts`

I reproduced the CI-only shape locally by setting `GITHUB_ACTIONS=true`. Before the fix, the focused file reported 1 failed / 3 passed, at the first expectation in `rejects the allowance outside a Linux GitHub Actions runner`, with `expected [Function] to throw an error`.

## Root cause

The policy previously used destructuring defaults directly in its parameter. JavaScript applies a destructuring default not only when a property is absent but also when it is explicitly `undefined`. The negative test deliberately injects `githubActions: undefined`, but on a GitHub Actions runner that value was silently replaced with ambient `process.env.GITHUB_ACTIONS === 'true'`. The policy therefore saw a Linux GitHub Actions runner and accepted the allowance, making the injected negative case depend on the host environment.

This was a dependency-injection/defaulting defect, not a failure of the locked launch-policy truth conditions and not permission to change the test.

## Implemented correction

Only `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.mjs` changed. `resolveM0LaunchPolicy` now builds ambient defaults first and then spreads the caller's injected options over them before destructuring. The resulting semantics are:

- a no-argument production fixture-runner call still reads `process.platform`, `GITHUB_ACTIONS`, and `CRADLE_M0_NO_SANDBOX` exactly as before;
- an injected own property, including the deliberate value `undefined`, wins over ambient state;
- omitted injected fields retain the existing ambient default behavior;
- invalid request values still fail closed;
- `CRADLE_M0_NO_SANDBOX=1` is still permitted only when the resolved platform is exactly `linux` and the resolved GitHub Actions marker is exactly `true`;
- the emitted development and packaged arguments remain exactly `--noSandbox` and `--no-sandbox`.

No declaration or test change was required. This keeps the function injectable and makes the CI negative case deterministic without weakening the Linux-hosted-runner allowance.

## Validation

All successful commands ran from the repository root with the already-installed direct Node entry points. The repository `pnpm` wrapper first attempted to initialize an unavailable `/root/.local` store, so it was not used as validation evidence.

- Pre-fix CI reproduction: `GITHUB_ACTIONS=true node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.test.ts --maxWorkers=1` — **reproduced, 1 file failed; 1 failed / 3 passed**.
- Post-fix focused CI-environment test: the same command — **PASS, 1 file / 4 tests**.
- Full fixture suite in the CI environment: `GITHUB_ACTIONS=true node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 31 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- Launch-policy syntax: `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.mjs` — **PASS, exit 0**.
- Diff hygiene: `git diff --check` — **PASS, exit 0 with no output**.

Vitest emitted only the existing Vite tsconfig-path and Oxc notices; neither was a test failure.

## Frozen-boundary audit

The implementation diff contains only the launch-policy default-resolution correction. It does not modify an M0 behavior assertion or acceptance threshold; the workflow; production routing; CSP; session selection; scheme privileges; BrowserWindow security settings; authentication/ticket behavior; packaging; lifecycle/finalization behavior; or any Desktop/Web/Server production source. The policy remains fail closed outside the exact Linux GitHub Actions allowance.

The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remained untouched. Its pre-existing untracked status is not part of this Fix node.

This node ran no development or packaged Electron runtime and makes no M0 runtime PASS or acceptance claim. The existing runtime/architecture disposition remains unchanged; this fix establishes only that the launch-policy unit suite is deterministic inside GitHub Actions.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** the assigned CI run/job/failure, prerequisite sources, reproduction, root cause, exact source correction, validation results, frozen boundaries, and runtime non-claim are all recorded here.
- [x] **Tradeoffs and uncertainties explicit:** explicit `undefined` now overrides ambient defaults while omitted fields retain prior ambient behavior; the unavailable `pnpm` store path and use of direct installed entry points are stated; no hosted rerun or Electron runtime is claimed.
- [x] **Acceptance criteria addressed:** CI-environment focused test, complete fixture suite, Desktop Node typecheck, fixture lint, launch-policy syntax, and diff hygiene all pass; injection determinism and unchanged fail-closed policy are explained.
- [x] **No changes outside assigned scope:** only the task-related launch-policy implementation and this required Fix V handoff were written; tests, declarations, workflow, assertions, thresholds, CSP, sessions, privileges, BrowserWindow settings, production routing, and the forbidden untracked Server file were not changed.
- [x] **Human-review quality / honest, thorough, non-marketing:** the report distinguishes a unit/defaulting correction from runtime feasibility, includes the negative pre-fix evidence, preserves all known limits, and makes no partial-pass promotion or M0 acceptance claim.
