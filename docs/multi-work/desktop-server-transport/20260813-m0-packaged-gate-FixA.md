# Fix A handoff: Plan 063 Node A packaged custom-scheme feasibility gate

**Task node:** Plan 063 Node A / M0 review fixes only

**Fix date:** 2026-08-13

**Disposition:** Blocking review findings B1 and B2 are fixed. Non-blocking findings N1 and N2 are also fixed within the fixture boundary. Focused static, unit, type, lint, and bundle validation passes. Node A still lacks the mandatory development and ASAR-packaged Linux/Windows Electron runtime artifacts, so this handoff does not accept M0, authorize Node C, or claim runtime evidence.

## Sources and scope

I read the complete root `AGENTS.md`, `docs/exec-plans/20260813-01-desktop-server-transport.md`, `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ImplementationA.md`, `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ReviewA.md`, and the affected fixture source directly. There is no Desktop-local `AGENTS.md`.

The fix changes only `apps/desktop/src/main/desktop-server-transport/fixtures/m0/`. It does not change production Main, Server, Web, lifecycle, credential, Chat, ticket, database, routing, or session behavior. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remains untouched.

## Review findings resolved

### B1: result validation now independently enforces the evidence contract

`result-contract.mjs` is now a real CI trust boundary rather than a top-level shape check. It validates:

- the exact top-level result fields, schema version, pass state, Electron 42.4.1, mode, platform, architecture, and mode-specific absolute artifact path;
- the exact privilege-evidence fields and values;
- the exact 25-name assertion set with no extra assertions, `passed: true`, a non-empty `details` record, primitive detail values, and finite non-negative numeric details;
- the fixed 256 KiB chunk size, every baseline/peak/settled Main and renderer memory value, both raw traces, non-empty raw samples, finite non-negative integer samples, and time ordering;
- agreement between each trace's first sample and baseline, raw maxima and recorded peaks, and trace values and summary values;
- all eight required cleanup, cancellation, session, and module counters as finite non-negative integers, including zero active/partition work, exactly one response cancellation and upstream close, and required positive activity;
- both launch facts, including `rendererSandbox: true`;
- counter agreement with the named cancellation, partition, module, and cleanup assertion details;
- raw 64 MiB Main/renderer deltas and 128 MiB slopes against the named RSS assertion details and the Linux/Windows `<48 MiB` / `+16 MiB` gates.

The runner now passes the actual launcher platform and architecture to the validator in addition to mode and artifact path. Tests construct a complete, internally consistent result and prove that empty nested evidence, empty assertion details, missing/extra assertions, Electron drift, raw-trace contradictions, and counter contradictions are rejected. The malformed empty-object result reproduced by Review A no longer validates.

### B2: launcher timeout and cleanup are bounded

Process orchestration moved to the fixture-only `command-runner.mjs`. For every child it now:

- starts a dedicated POSIX process group, retaining Windows tree ownership through `taskkill /t`;
- sends process-tree termination at the configured 120/180-second timeout;
- escalates after a bounded five-second grace period to POSIX `SIGKILL` or Windows forced tree termination;
- force-settles one second later even if an exit event is never delivered, while closing captured pipes and releasing the child handle;
- clears all timeout/escalation timers on exit or spawn error;
- force-cleans and rejects spawn errors immediately;
- preserves captured stdout/stderr and the existing runner timeout/nonzero-result behavior.

The development preparation subprocess now receives the same explicit bound and reports a preparation timeout distinctly. A focused test launches a process that installs a `SIGTERM` handler and stays alive, then proves bounded settlement and POSIX `SIGKILL` escalation. A second test proves a spawn error rejects without waiting for the configured timeout.

### N1: exact-authority regression coverage is complete for the reviewed cases

`proxy-handler.test.ts` now proves rejection of another host, a port, username-only credentials, username/password credentials, an empty host, and a trailing-dot host. Every rejected authority returns 400 and increments the rejection counter. The successful exact `cradle-server://local` path remains covered.

### N2: scheme registration and privilege evidence share one locked descriptor

`M0_SCHEME_REGISTRATION` is the single frozen descriptor containing the scheme and five enabled Electron privileges. `main.ts` passes that descriptor directly to `protocol.registerSchemesAsPrivileged`, and `M0_SCHEME_PRIVILEGES` derives its enabled values from the same object before adding the four explicitly disabled evidence values. The declaration surface and a focused exact-object test ratchet both representations. There is no longer a second enabled-privilege literal in Main that can drift from result evidence.

## Files changed by this fix

- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-contract.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-contract.d.mts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-schema.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-contract.test.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.d.mts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.test.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/run-m0.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/main.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/proxy-handler.test.ts`

## Focused validation

Passed from the repository root:

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 3 files, 9 tests passed.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache --max-warnings=0` — exit 0 with no warnings.
- `git diff --check` plus a trailing-whitespace scan of the fixture source — exit 0.

Passed from `apps/desktop`:

- `NODE_PATH=/workspace/scratch/bcdefa6cb3a5/cradle-app/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` — isolated Main, preload, and renderer bundles built successfully. `NODE_PATH` is the same local partial-install resolution workaround recorded by Implementation A; it is not a source or runtime behavior change.

## Runtime evidence and STOP status

No Electron application was launched by this fix node. There is still no new development JSON, packaged JSON, Linux/Windows RSS trace, cancellation/session runtime counter record, packaged executable result, or Windows workflow URL. The bundle build is not promoted to runtime evidence.

No architecture problem emerged from these fixes, and no Plan 063 runtime STOP condition was exercised. Production routing remains unchanged. Re-review should verify B1/B2/N1/N2, then the parent must obtain and record the required Linux development/packaged and Windows packaged artifacts before Node C or production migration is authorized. If those corrected runtime gates hit a Plan 063 STOP condition, preserve their JSON/logs and escalate to the separate local HTTP/2-over-TLS Plan B decision; do not patch around the failure.

## Handoff quality checklist

- [x] Read the living ExecPlan, Implementation A, Review A, root repository instructions, and affected source directly.
- [x] Limited edits to the failed Node A review findings and the isolated M0 fixture boundary.
- [x] Fixed B1 with exact nested-schema, raw-trace, finite/non-negative, counter, launch, assertion-detail, and internal-invariant validation.
- [x] Fixed B2 with bounded process-tree TERM-to-KILL escalation, forced settlement, and spawn-error cleanup.
- [x] Added focused regression tests for malformed evidence, contradictions, hung launchers, and spawn errors.
- [x] Addressed N1 with port, credentials, empty-host, and malformed/non-exact authority cases.
- [x] Addressed N2 with one mechanically shared locked registration descriptor and exact-object test.
- [x] Ran focused tests, direct Desktop TypeScript, fixture lint, isolated bundle build, and diff hygiene successfully.
- [x] Left production routing and all later Plan 063 node semantics unchanged.
- [x] Preserved the unrelated untracked Server file and other existing worktree changes.
- [x] Recorded that runtime acceptance evidence is still missing and made no runtime or M0 acceptance claim.
- [x] Found no architecture escalation requiring a patch stop.
- [x] Formal output is this handoff file only.
