# Fix C handoff: Plan 063 Node A Linux GitHub Actions sandbox launch

**Task node:** Plan 063 Node A / first Linux runtime gate failure

**Fix date:** 2026-08-13

**Disposition:** The first Linux runner blocker is fixed narrowly. The M0 workflow now requests the Plan-permitted no-sandbox process launch only in its Linux GitHub Actions job; the fixture runner applies it to both development Electron and the packaged executable, and the result validator requires emitted `launch.noSandbox` evidence to match the requested launch. Both M0 BrowserWindows still use `sandbox: true`. No product runtime, production route, protocol privilege, or session boundary changed. Linux and Windows M0 runtime acceptance remain pending until fresh workflows execute this fix.

## Sources and direct failure evidence

I read the root `AGENTS.md`, `docs/exec-plans/20260813-01-desktop-server-transport.md`, `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ReviewC.md`, the actual M0 runner, result contract, Main fixture, tests, package scripts, and Linux/Windows/release workflow call sites. There is no Desktop-local `AGENTS.md`.

I inspected PR [#163](https://github.com/wibus-wee/cradle-app/pull/163), Actions run [31622852716, job 94201758906](https://github.com/wibus-wee/cradle-app/actions/runs/31622852716/job/94201758906) directly. The Ubuntu 24.04 runner reached the development `electron-vite` launch and Electron 42.4.1 aborted at `sandbox/linux/suid/client/setuid_sandbox_host.cc:166`: its pnpm-installed `chrome-sandbox` was not root-owned with mode 4755. No `development-linux-x64.json` was written, so the gate then failed when the runner tried to read that absent result. The packaged run did not begin because `m0:custom-scheme:gate` sequences development before packaged.

This is the exact runner condition anticipated by the Node A exploration: Linux `--no-sandbox` is allowed only when the GitHub runner requires it, the result must record it, and renderer BrowserWindow sandbox configuration must remain enabled.

## Narrow implementation

The implementation changes only the Linux CI launch step and the isolated M0 fixture boundary:

- `.github/workflows/ci.yml` sets `CRADLE_M0_NO_SANDBOX=1` only on the `ubuntu-latest` `desktop-m0-custom-scheme` execution step. Windows and release workflows do not receive it.
- `launch-policy.mjs` accepts the allowance only when `platform === 'linux'`, `GITHUB_ACTIONS === 'true'`, and the request is exactly `1`. Any other platform, local invocation, or ambiguous value fails closed.
- The development launch passes electron-vite's `--noSandbox`, which maps to Electron's `--no-sandbox`; the packaged fixture executable receives `--no-sandbox` directly. The same policy therefore covers both halves of the Linux gate without modifying package scripts or product launchers.
- `run-m0.mjs` passes the policy's expected no-sandbox state to `validateM0Result`. The validator rejects a result whose `launch.noSandbox` does not match the runner request, so the required JSON cannot silently claim a different launch.
- `main.ts` retains one shared `M0_SANDBOXED_WEB_PREFERENCES` object with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`; both the default-session fixture window and partition-probe window consume it. Result evidence derives `launch.rendererSandbox` from that same sandbox setting instead of an unrelated literal.

No `sudo chown`, `chmod 4755`, repository-wide `NO_SANDBOX`, product Electron argument, `app.commandLine.appendSwitch`, production configuration, protocol privilege, CSP bypass, additional session handler, or renderer HTTP fallback was introduced.

## Files changed

- `.github/workflows/ci.yml`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.d.mts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.test.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/run-m0.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/main.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-contract.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-contract.d.mts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-contract.test.ts`

This handoff is the only documentation addition. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remains untouched.

## Focused validation

Passed from the repository root:

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 4 files, 15 tests passed.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache --max-warnings=0` — exit 0 with no warnings.
- `git diff --check` — exit 0.

Passed from `apps/desktop`:

- `NODE_PATH=/workspace/scratch/bcdefa6cb3a5/cradle-app/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` — isolated Main, preload, and renderer bundles built successfully.

The launch-policy regressions prove the exact development and packaged arguments, default sandboxed behavior, rejection outside Linux GitHub Actions, and rejection of ambiguous values. The result-contract regression proves both accepted runner-only `noSandbox: true` evidence and rejection when emitted evidence contradicts the runner request. Existing result, privilege, authority, launcher-cleanup, and proxy tests remain green.

No Electron runtime was launched locally because this environment has no Xvfb/runtime setup capable of replacing the required hosted-runner evidence. Unit, type, lint, and bundle results are not promoted to M0 runtime acceptance.

## Exact remaining runtime requirement

At the exact revision containing Fix C, rerun PR #163's Linux `Desktop M0 Custom Scheme` job. It must complete both commands under Xvfb:

1. development M0 must emit and validate `apps/desktop/.m0-results/development-linux-x64.json`;
2. the ASAR-packaged `apps/desktop/release/m0/linux-unpacked/cradle-m0-gate` must emit and validate `apps/desktop/.m0-results/packaged-linux-x64.json`;
3. both JSON results must record Electron `42.4.1`, `launch.noSandbox: true`, `launch.rendererSandbox: true`, every required assertion true, valid raw RSS traces within the locked 64/128 MiB bounds, required cancellation/session/cleanup counters, and the packaged artifact's exact absolute path;
4. stdout/stderr and result artifacts must be preserved on any failure, and a new failure after the sandbox abort must be treated as the next runtime gate failure rather than reclassified as baseline.

Linux success resolves only this first runtime gate. Node A/M0 still also requires the exact-revision Windows x64 packaged workflow result for `release/m0/win-unpacked/cradle-m0-gate.exe` with normal sandbox launch (`launch.noSandbox: false`, `launch.rendererSandbox: true`), plus the required product `pnpm build:desktop` and Desktop `pack` ratchet evidence. The accepted Linux and Windows measurements and workflow URLs must be recorded in Plan 063 and the living ExecPlan before Node C or any production `cradle-server://local` routing begins.

## Handoff quality checklist

- [x] Read the living ExecPlan, Review C, applicable repository instructions, and actual M0 runner/workflow/Main/result/test sources directly.
- [x] Inspected PR #163 run 31622852716 job 94201758906 directly and recorded the exact SUID sandbox abort and missing-result consequence.
- [x] Limited the allowance to the Linux GitHub Actions M0 step and rejected local, Windows, macOS, and ambiguous requests.
- [x] Applied the allowance to both development and packaged fixture launch paths.
- [x] Required result evidence to match the requested `noSandbox` launch state.
- [x] Kept both fixture BrowserWindows on the shared `sandbox: true` preferences and retained context isolation, no Node integration, and web security.
- [x] Added focused launch-policy and result-contract regression coverage.
- [x] Ran the full focused M0 tests, Desktop Node typecheck, fixture lint, isolated fixture bundle build, and diff hygiene successfully.
- [x] Added no product runtime switch, production route, broader protocol privilege/session, CSP bypass, fallback, or private framing.
- [x] Preserved prior B1/B2/N1/N2 fixes and unrelated worktree state, including the untracked Server file.
- [x] Kept static validation separate from Electron runtime evidence and did not claim M0 acceptance.
- [x] Recorded the exact remaining Linux, Windows, product build/package, artifact, measurement, and documentation requirements before Node C.
- [x] Found no Plan 063 architecture STOP condition requiring a design escalation; the observed failure is the explicitly permitted Linux runner exception.
- [x] Formal output is this self-contained handoff file only.
