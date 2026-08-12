# Review X: Plan 063 M0 Architecture STOP final integration

**Review role:** Final Integration Review Agent
**Review date:** 2026-08-13
**Reviewed worktree HEAD:** `4f1724ee4da0b18f58dcdafb8f707d6c88500588`
**Overall verdict:** **FAIL**

The Architecture STOP decision itself is supported and correctly integrated across the
runtime Critique-Chain. M0 did not pass, production routing remained unchanged, and
M1-M7 were not implemented. Fix V and Review W also close the launch-policy CI unit defect
without review debt. The final delivery nevertheless fails the requested integration gate
because the living ExecPlan retains two concrete, contradictory current/historical claims.
Both are documentation truth defects; neither changes the RSS-based STOP classification.

## Reviewed sources and DAG

I read the complete repository instructions, Plan 063, its living ExecPlan,
`plans/README.md`, and all 31 pre-existing handoffs under
`docs/multi-work/desktop-server-transport/`. The reviewed chain includes:

- initial packaged-M0, Desktop Main, and Web/auth/ratchet explorations;
- Node A implementation, Reviews A/B/C, and Fixes A/B;
- Linux sandbox Fix C and Review D;
- first Windows and Linux behavior explorations D/E;
- evidence-preservation Implementation F and Reviews/Fixes G-Q through the accepted
  Main-owned terminal-redaction policy;
- third Linux/Windows runtime Explorations R/S;
- Critique T and Synthesis U;
- launch-policy Fix V and Review W.

All 31 handoffs exist under the expected dated task/type/letter naming convention, are
self-contained, and include a five-part handoff/review quality gate. No expected formal
handoff in the executed M0 DAG is missing.

## Blocking findings

### B1. The ExecPlan makes a false inference from the first Windows hidden-artifact upload

At `docs/exec-plans/20260813-01-desktop-server-transport.md:58`, the ExecPlan says that
artifact upload for run `31622852684` / job `94201752466` “confirmed that
`.m0-results` contained no files.” That is not supported by the run and directly
contradicts the accepted Windows Exploration D and the ExecPlan's own later observation.

`actions/upload-artifact@v4` excluded dot-prefixed directories because
`include-hidden-files: true` was absent. `run-m0.mjs` creates `.m0-results` and writes its
stdout/stderr logs in `finally`. Therefore the no-files upload warning could mean that
hidden files existed but were excluded; it cannot confirm that the directory was empty.
Exploration D explicitly records this distinction, and the ExecPlan later correctly calls
the missing upload an observability defect rather than evidence that logs were absent.

Required correction: replace the unsupported emptiness claim with the fail-closed fact:
no accepted result or retained visible artifact was available, while hidden runner logs
may have existed and were excluded by uploader policy.

### B2. The ExecPlan's branch-state statement is stale and false

At `docs/exec-plans/20260813-01-desktop-server-transport.md:262`, the ExecPlan says:
“The branch currently contains only the replan commit over that baseline.” The actual
branch at review HEAD contains three subsequent M0 commits after the replan commit:

- `cafbc19 test(desktop): gate custom scheme packaging`
- `fb0afd5 fix(ci): constrain M0 Linux sandbox exception`
- `4f1724e test(desktop): preserve M0 runtime evidence`

The exact `d40f895e..HEAD` drift contains 33 M0 fixture/workflow/package/lockfile paths and
3,703 insertions, not only the replan commit. The statement also conflicts with the same
ExecPlan's Progress and Outcomes sections, which correctly say Node A and evidence
preservation were implemented and committed.

Required correction: describe `d40f895e` as the implementation baseline and the current
branch as containing the replan plus the committed, fixture-only M0 gate/evidence slice.

These two defects fail the requested requirement that Plan/ExecPlan/README narration be
precise and internally consistent. They do not authorize any source fix, runtime rerun, or
change to the Architecture STOP.

## Acceptance disposition

| Acceptance area | Disposition | Evidence |
| --- | --- | --- |
| Formal handoff naming, existence, and self-containment | **PASS** | All 31 executed-DAG handoffs exist and include the common five-part quality gate. |
| R/S conflict and Critique-Chain synthesis | **PASS** | S correctly identifies the last-window/finalization defect; T/U correctly reject treating its repair as a predecessor to a negative decision. Canonical JSON remains mandatory for PASS, while complete PID-attributable temp payloads and raw traces are used only as negative evidence. |
| M0 STOP rule and M1-M7 boundary | **PASS** | T/U rest STOP on the replicated, locked renderer RSS slope: 34,212 KiB Linux development, 37,340 KiB Linux packaged, and 40,836 KiB Windows packaged versus 16,384 KiB maximum. Plan 063 and the ExecPlan explicitly prohibit M1-M7. |
| No false M0 PASS | **PASS** | No canonical result exists; every retained mode remains failed/not accepted. Local unit/type/lint/build evidence and parseable temporary JSON are never promoted to packaged M0 acceptance. |
| Exact third-run identities and metrics | **PASS** | Linux run/job/artifact `31631897209` / `94232462008` / `9155455275`; Windows `31631897216` / `94232461652` / `9155482787`. Both are qualified as PR merge-ref execution of `cba92719...` containing requested head `61b2ce98...`. |
| Cancellation and plugin attribution | **PASS** | All three modes record `responseCancels: 1`, `upstreamCloses: 1`, `activeRequests: 0`, and `requestSignalAborts: 0`. T/U keep signal semantics corroborating rather than the sole STOP basis. Plugin failures are correctly treated as required failures but likely preparation defects. |
| Fix V and Review W review debt | **PASS** | The own-property overlay preserves no-argument ambient behavior and exact Linux-GitHub-Actions-only allowance while making explicit `undefined` deterministic. Independent local checks below pass. |
| Production routing and frozen boundaries | **PASS** | Uncommitted diff contains only `launch-policy.mjs` and the three plan/index documents. `d40f895e..HEAD` production source outside the isolated M0 fixture is unchanged; existing renderer bearer/HTTP scaffold remains, confirming M6 and production migration did not land. |
| Untracked Server file | **PASS** | `apps/server/src/http/websocket-ticket.ts` remains untracked; it has no diff and was not opened, staged, or modified by this review. |
| Plan/ExecPlan/README narrative truth | **FAIL** | B1 and B2 are explicit false/contradictory ExecPlan statements. Plan 063's STOP record and the README `REJECTED` row are otherwise consistent with T/U. |

## Independent repository verification

All commands ran from the repository root and passed:

- `GITHUB_ACTIONS=true node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.test.ts --maxWorkers=1` — 1 file, 4 tests.
- `GITHUB_ACTIONS=true node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 7 files, 31 tests.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — exit 0.
- `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/launch-policy.mjs` — exit 0.
- `git diff --check` — exit 0.

Vitest emitted only the already-recorded informational Vite tsconfig-path and Oxc notices.
No Electron runtime, packaged artifact, or hosted workflow was rerun, and these local
checks are not M0 runtime evidence.

Final `git status --short` before this handoff contained exactly the task-related
`launch-policy.mjs`, ExecPlan, Plan 063, and `plans/README.md` modifications plus the
pre-existing untracked `apps/server/src/http/websocket-ticket.ts`. No generated artifact
or production-routing modification appeared.

## Final disposition

**FAIL final integration pending the two bounded ExecPlan narrative corrections above.**
The Architecture STOP itself passes review and must remain unchanged: M0 is failed/not
accepted, no additional Plan 063 feasibility rerun is authorized merely to obtain a
canonical rename, and M1-M7 remain prohibited. Fix only the two documentation truth
defects, then re-run diff hygiene and a narrow final documentation re-review.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** reviewed sources, exact DAG,
  blockers, run/job/artifact/metric identities, validation, and final disposition are
  stated here.
- [x] **Tradeoffs and uncertainties explicit:** canonical PASS evidence is separated from
  attributable negative evidence; cancellation semantics, likely plugin-preparation
  defects, merge-ref scope, and the absence of a fresh runtime rerun are explicit.
- [x] **Acceptance criteria addressed:** handoffs, Critique-Chain, STOP rules, M1-M7,
  launch policy, production routing, forbidden file, narrative precision, and evidence
  honesty are each dispositioned.
- [x] **No implementation details leaked outside assigned scope:** this review changes no
  implementation, workflow, plan, index, test, production source, or forbidden Server
  file; its only repository output is this Review X handoff.
- [x] **Human-review quality / honest, thorough, non-marketing:** the review preserves the
  supported Architecture STOP, refuses to promote local/temp evidence to M0 PASS, and
  still returns FAIL for two reproducible integration-document defects.
