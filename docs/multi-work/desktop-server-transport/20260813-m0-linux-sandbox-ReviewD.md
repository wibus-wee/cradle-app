# Review D: M0 Linux GitHub Actions sandbox exception re-review

**Task node:** Plan 063 Node A / Linux GitHub Actions sandbox exception

**Review date:** 2026-08-13

**Verdict:** **PASS for the narrow Fix C code-readiness question. M0 runtime is NOT PASSED.**

The exception is confined to the Linux GitHub Actions M0 execution step and fails closed: only the exact request `CRADLE_M0_NO_SANDBOX=1`, together with `process.platform === 'linux'` and `GITHUB_ACTIONS === 'true'`, enables it. The development and packaged launch paths request the correct respective command-line forms, and the runner requires the result's observed `launch.noSandbox` value to equal that request. Both fixture BrowserWindows still use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`. The reviewed diff changes no production transport, routing, lifecycle, authentication, protocol privilege, or product launcher.

This is a code-readiness verdict only. No corrected Linux development or packaged Electron run was available to this review, and the supplied Actions run is the pre-fix failure. It therefore does not prove the actual M0 behavior after Fix C and cannot satisfy the real runtime gate.

## Sources and evidence boundary

I read the repository `AGENTS.md`, the living ExecPlan, Review C, Fix C, the current workflow and fixture source, all M0 fixture tests, the installed electron-vite launch implementation, the Windows packaged workflow, and the release workflow. There is no Desktop-local `AGENTS.md`.

The requested external evidence is GitHub Actions run `31622852716`, job `94201758906`. Fix C records the exact observed failure as Electron 42.4.1 aborting in `setuid_sandbox_host.cc:166` because the pnpm-installed `chrome-sandbox` was not root-owned with mode 4755; development emitted no result JSON, and the sequenced packaged run did not start. This review could not independently retrieve that log because `gh` is unavailable in the review environment. I therefore treat Fix C's precise account as supplied but independently unverified historical evidence. It is consistent with the narrow correction, but it is not evidence that the correction has run successfully.

The current worktree also contains unrelated untracked `apps/server/src/http/websocket-ticket.ts`. It remained outside this review and was not modified. The isolated bundle build wrote generated ignored output only; this review added no production or fixture implementation change.

## Review checks

| Acceptance area | Status | Direct evidence and limit |
| --- | --- | --- |
| Linux GitHub Actions only and fail-closed | **PASS (static/unit)** | `.github/workflows/ci.yml` defines `CRADLE_M0_NO_SANDBOX: '1'` only on the Ubuntu `desktop-m0-custom-scheme` run step. `resolveM0LaunchPolicy()` enables the exception only for exact request `1`, platform `linux`, and `GITHUB_ACTIONS === 'true'`; other non-empty values throw, and Linux local and Windows GitHub Actions requests throw. Unset or empty values keep sandbox launch enabled. Windows and release M0 call sites do not define the variable. |
| Development and packaged arguments | **PASS (static/unit)** | Development receives electron-vite `--noSandbox`; the installed electron-vite CLI converts that option to `NO_SANDBOX=1`, and its launcher appends Electron `--no-sandbox`. The packaged executable receives `--no-sandbox` directly. The same resolved policy instance supplies both paths. Focused tests assert the exact argument arrays and the default empty arrays. |
| Requested versus actual no-sandbox evidence | **PASS (static/unit); runtime pending** | `run-m0.mjs` passes `launchPolicy.noSandbox` to `validateM0Result`. Fixture Main emits `launch.noSandbox` from `app.commandLine.hasSwitch('no-sandbox')`. The validator rejects a Boolean mismatch, and the regression covers matching true/false plus a contradictory result. This closes the evidence contract, but no post-fix JSON proves the equality in a real Electron process yet. |
| Both BrowserWindow security settings | **PASS (static/type)** | Default-session and partition-probe windows spread the same `M0_SANDBOXED_WEB_PREFERENCES`, whose values are exactly `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`. Main's `launch.rendererSandbox` derives from that same object's `sandbox` member, and the result validator requires it to be true. The process-level Linux exception does not alter these BrowserWindow declarations. |
| No production routing impact | **PASS (static)** | The diff is limited to `.github/workflows/ci.yml` and `apps/desktop/src/main/desktop-server-transport/fixtures/m0/`. Workflow scope is the isolated M0 job; code scope is fixture policy, runner, evidence validation/tests, and fixture BrowserWindow settings. No production Main/Web/Server routing, custom-scheme handler, session boundary, credential path, product Electron argument, or package/release environment was changed. |
| Corrected Linux Electron M0 | **NOT PASSED / RUNTIME PENDING** | No corrected development result, packaged result, stdout/stderr, raw RSS trace, or successful post-fix workflow URL was supplied or generated. Run `31622852716` is failure evidence preceding the correction. |

## Focused validation performed

Passed from the repository root:

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 4 files and 15 tests passed, including launch-policy and requested/observed launch-evidence regressions.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache --max-warnings=0` — exit 0 with no warnings.
- `git diff --check` — exit 0.

Passed from `apps/desktop`:

- `NODE_PATH=/workspace/scratch/bcdefa6cb3a5/cradle-app/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` — isolated Main, preload, and renderer bundles built successfully.

Vitest/Vite emitted only the existing informational tsconfig-paths and esbuild/Oxc notices. No test, typecheck, lint, build, or diff-hygiene failure occurred.

I did not launch Electron locally and do not reinterpret unit, static, type, lint, or bundle results as runtime evidence.

## Remaining acceptance boundary

At the exact revision containing Fix C, the Linux hosted workflow must complete both development and ASAR-packaged execution under Xvfb. Its validated results must independently record `launch.noSandbox: true` and `launch.rendererSandbox: true`, Electron `42.4.1`, the exact packaged artifact path, every required assertion, valid raw RSS traces and bounds, and the required cancellation/session/cleanup counters. Any next runtime failure must be preserved and treated as the next gate failure.

Even a successful corrected Linux run would not by itself accept all of Node A. Windows x64 packaged evidence must still record normal process sandbox launch (`launch.noSandbox: false`) and renderer sandboxing, and the required product build/package ratchet and plan documentation must still be completed. Production `cradle-server://local` routing and Node C remain blocked until the living ExecPlan's full M0 runtime prerequisites are met.

No Plan 063 architecture STOP condition was established by this static re-review. Conversely, absence of a static defect is not evidence that Electron custom-scheme streaming, cancellation, CSP/plugin behavior, session isolation, or RSS bounds pass at runtime.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** verdict, reviewed scope, evidence boundary, checks, commands, and remaining acceptance conditions are stated here.
- [x] **Tradeoffs and uncertainties explicit:** the Linux runner exception weakens the Electron process sandbox only for this fixture invocation; BrowserWindow settings remain locked, the old run log was not independently retrievable, and corrected runtime evidence is absent.
- [x] **Acceptance criteria addressed:** Linux-only fail-closed policy, both launch paths, requested/actual evidence agreement, both BrowserWindow configurations, production-routing isolation, validation commands, and runtime status are each explicitly dispositioned.
- [x] **No implementation details leaked outside assigned scope:** this review made no implementation or fixture change and writes only this assigned handoff; unrelated worktree state is preserved.
- [x] **Human-review quality, honest/thorough/no marketing:** conclusions distinguish static/unit evidence from hosted Electron evidence, state the `gh` limitation, issue an explicit code-readiness PASS, and explicitly refuse to claim M0 runtime success.
