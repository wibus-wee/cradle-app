# Plan 063 M0 launch-policy GitHub Actions unit fix (Review W)

## Verdict

**PASS** for the narrow CI unit/default-resolution correction at worktree base `4f1724e`.

I found no blocking correctness, security, scope, or validation issue in the implementation diff. This verdict is only code-readiness for the launch-policy unit fix. It is not a development/packaged Electron result, does not accept M0, and does not unblock production routing. Plan 063's existing runtime failures, hard gate, STOP conditions, and production-routing freeze remain unchanged.

## Reviewed scope and actual diff

I independently read the complete living ExecPlan, the complete Plan 063 architecture authority, Fix V, the repository instructions, and all three launch-policy files:

- `docs/exec-plans/20260813-01-desktop-server-transport.md`
- `plans/063-eliminate-desktop-server-sockets.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-launch-policy-ci-FixV.md`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.d.mts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.test.ts`

`git diff --name-status`, `git diff --numstat`, and the complete patch show exactly one implementation change: `launch-policy.mjs`, with 12 inserted and 5 removed lines. The declaration and test are unchanged. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remains present and untouched, as already recorded by the plans.

The pre-fix implementation destructured defaults in the parameter list. Under `GITHUB_ACTIONS=true`, an injected `githubActions: undefined` therefore selected `process.env.GITHUB_ACTIONS` and incorrectly allowed an otherwise negative injected case. I independently loaded the `HEAD` version from Git and reproduced that exact behavior: with Linux, ambient GitHub Actions true, and request `1`, the explicit injected `undefined` did not throw and returned `noSandbox: true`.

The worktree implementation now constructs the three ambient defaults and overlays the caller's options before destructuring. That makes an explicitly supplied own property—including `undefined`—authoritative, while an omitted field still receives its ambient value. This is the intended dependency-injection distinction.

## Semantic review

The correction preserves the required truth table:

- `resolveM0LaunchPolicy()` remains the sole runner call and still reads `process.platform`, `process.env.GITHUB_ACTIONS`, and `process.env.CRADLE_M0_NO_SANDBOX` when no options are supplied.
- With the environment unset, the no-argument call keeps sandboxing enabled and emits no launch arguments.
- On Linux with exact ambient `GITHUB_ACTIONS=true` and `CRADLE_M0_NO_SANDBOX=1`, the no-argument call still emits exactly development `--noSandbox` and packaged `--no-sandbox`.
- With ambient GitHub Actions true, injected `githubActions: undefined` now remains `undefined` and the request fails closed instead of inheriting the ambient marker.
- Request values other than undefined, empty string, or exact `1` still throw before allowance evaluation.
- Exact request `1` still requires resolved platform `linux` and resolved GitHub Actions marker string `true`; Windows and non-CI cases still throw.
- The returned `noSandbox` flag and exact development/packaged argument spellings are unchanged.

The merge intentionally treats enumerable own properties as injected overrides. The typed options contract and all current callers use plain option objects, and the only non-test caller supplies no argument, so prototype-derived or `null` inputs are outside the reviewed interface. No new fallback or permissive production branch was introduced.

## Frozen-boundary audit

Path-scoped working-tree checks returned no changes for `.github/workflows`, Desktop package/build configuration, preload/shared contracts, Web source, Server source, or Desktop Main production source outside this one fixture file. A second check over the M0 fixture excluding `launch-policy.mjs` was also empty. Therefore this correction changes none of the following:

- GitHub Actions job structure, environment wiring, artifact retention, or dev/packaged independence;
- M0 assertions, result/evidence validators, cancellation/RSS thresholds, 64/128 MiB truth conditions, real-plugin/CSP proof, session isolation, lifecycle diagnostics, or cleanup requirements;
- Electron scheme privileges, BrowserWindow sandbox/security settings, `bypassCSP`, packaging, or launch evidence validation;
- Desktop/Web/Server production routing, credential ownership, ticket semantics, custom-scheme fallback policy, or the M1-M7 predecessor gate.

The required Plan 063 baseline drift command still reports the already-landed Node A fixture/workflow slice relative to `d40f895e`; the narrow uncommitted Fix V diff does not add any drift outside `launch-policy.mjs`. M0 remains failed/not accepted until valid hosted development and packaged evidence satisfies every existing truth condition.

## Independent validation

All commands ran from the repository root using the installed direct Node entry points:

- `GITHUB_ACTIONS=true node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.test.ts --maxWorkers=1` — **PASS**, 1 file / 4 tests.
- `GITHUB_ACTIONS=true node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS**, 7 files / 31 tests.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS**, exit 0 with no diagnostics.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS**, exit 0 with no warnings.
- `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.mjs` — **PASS**, exit 0.
- `git diff --check` — **PASS**, exit 0 with no output.

I also ran five direct policy probes, all passing: no-argument/unset ambient default, no-argument exact Linux-CI allowance, no-argument request outside CI rejection, ambiguous ambient request rejection, and explicit injected `undefined` rejection while ambient GitHub Actions and request values were both enabled. Vitest emitted only the existing Vite tsconfig-path and Oxc notices; neither was a failure.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** verdict, reviewed inputs, actual diff, root cause, corrected semantics, frozen boundaries, commands, results, and the narrow non-claim are all recorded here.
- [x] **Tradeoffs and uncertainties explicit:** own-property overlay semantics and the typed/current caller boundary are stated; no hosted rerun, Electron runtime result, or M0 acceptance is inferred from unit success.
- [x] **Acceptance criteria addressed:** explicit-`undefined` determinism, unchanged no-argument ambient behavior, unchanged fail-closed constraints, all six required validation classes, and workflow/M0/production freezes were independently checked.
- [x] **No changes outside assigned scope:** review was read-only with respect to implementation; the only file authored is this required Review W handoff, and the unrelated untracked Server file was not touched.
- [x] **Human-review quality / honest, thorough, non-marketing:** the conclusion distinguishes the narrow unit fix from M0 runtime feasibility, reports exact evidence and notices, and preserves every known architecture/runtime blocker.
