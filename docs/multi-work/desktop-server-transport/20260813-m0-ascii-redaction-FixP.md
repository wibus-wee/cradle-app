# Fix P: M0 length-stable ASCII terminal redaction

**Task:** Make the narrowest correction for Review O's length-changing case-conversion/index bypass while preserving the Main-owned finite terminal-redaction decision

**Fix date:** 2026-08-13

**Disposition:** **IMPLEMENTED AND LOCALLY VALIDATED.** The finite terminal rule is retained. Bearer values and the five recognized authorization/cookie/password/secret/token assignments are now matched case-insensitively against the original diagnostic string with original-string indices only. An ordinary U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE before a trigger can no longer shift the trigger lookup. Direct, error-serializer, atomic-envelope, and lifecycle-JSONL regressions cover the length-changing prefix before Bearer and every recognized assignment. This is a code/evidence correction only. It is **not** a development, packaged, Linux, Windows, hosted-workflow, or M0 runtime PASS and does not authorize production routing.

## Root cause and narrow correction

`redactDiagnosticText` previously created `text.toLowerCase()` and scanned indices bounded by the original `text`. JavaScript lowercasing can change UTF-16 length: U+0130 is one code unit in the original string and becomes `i` plus U+0307 in the lowercased string. After that character, using an original-string index with the lowercased copy missed every later Bearer or assignment trigger and retained its complete suffix.

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` now uses a small `startsAsciiCaseInsensitive` matcher. It compares each expected lowercase ASCII trigger character with the lower- or uppercase ASCII code at the same index in the original string. `startsBearerValue` and `startsSecretAssignment` no longer receive a lowercased copy, and `redactDiagnosticText` no longer creates one. No differently sized representation shares indices with the source text.

The correction does not broaden the confidentiality parser. The recognized vocabulary remains exactly Bearer plus authorization, cookie, password, secret, and token assignments. Existing whole-word, whitespace, separator, syntactic absolute-URL, earliest-trigger, fixed-marker, and terminal suffix-discard behavior is unchanged. No URL/value reconstruction, quote grammar, authority/path parsing, suffix recovery, Unicode credential spelling, or new heuristic was added.

## Regression coverage

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts` adds three explicit regression layers using ordinary `İ` text before all six trigger classes:

- Direct `redactDiagnosticText` checks require the original ordinary prefix plus `[REDACTED]` for Bearer and each recognized assignment.
- `serializeDiagnosticError` checks exercise `Error.name`, `Error.message`, string `Error.code`, and the non-Error message branch for every trigger.
- `writeDiagnosticEnvelope` checks atomically persisted JSON for Bearer and every assignment and rejects every `_LEAK` suffix marker.

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts` adds a lifecycle JSONL matrix. For each of the six triggers, it places the same length-changing-prefix attack in checkpoint, all three context fields (`mode`, `resultPath`, and `artifactPath`), and string-valued details. Every persisted boundary must end at `[REDACTED]`, and no `_LEAK` marker may remain.

The prior Review G, I, K, and M terminal-redaction regressions remain present and green. Ordinary no-trigger strings, relative paths, Windows paths, bare Bearer text, structured lifecycle evidence, and all numeric/boolean/null values retain their existing behavior.

## Validation evidence

All commands ran from the repository root.

- Focused sanitizer/persistence suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 13 tests**.
- Full M0 fixture suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 31 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- Scanner syntax: `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS, exit 0**.
- Diff hygiene: `git diff --check` — **PASS, exit 0**.

Vitest emitted only the existing Vite tsconfig-path and Oxc notices; neither was a failure.

## Frozen-boundary verification

The implementation changes only the shared diagnostic-text matcher and the two directly related fixture test files. It does not edit workflow orchestration, result contracts, runner/Main lifecycle behavior, required assertion names or truth conditions, first-byte/cancellation/upload/64/128 MiB transfer checks, the 48 MiB per-process or 16 MiB non-linear RSS bounds, cleanup requirements, CSP, `bypassCSP`, scheme privileges, `session.defaultSession`, persistent-partition denial, BrowserWindow sandbox/context-isolation/Node-integration/web-security settings, package behavior, authentication or tickets, production Desktop/Web/Server routing, the ExecPlan, or Plan 063. The unrelated `apps/server/src/http/websocket-ticket.ts` remained untouched.

The Main-owned finite terminal-redaction decision therefore remains implementable and does not require Architecture Escalation.

## Runtime disposition

No Electron development gate, ASAR-packaged gate, Linux/Windows executable, hosted workflow, RSS/cancellation runtime proof, or result-artifact validation was run by Fix P. There is explicitly **no runtime PASS**, no M0 acceptance, and no authorization to begin production routing. Existing runtime failures and STOP boundaries remain in force.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** the defect, exact language behavior, narrow implementation, boundary regressions, commands/results, frozen scope, and runtime disposition are recorded here.
- [x] **Tradeoffs and uncertainties explicit:** the accepted terminal information-loss tradeoff remains intact; this correction is limited to length-stable ASCII trigger matching, and local validation is explicitly separated from runtime proof.
- [x] **Acceptance criteria addressed:** length-changing ordinary prefixes before Bearer and all five assignments are covered directly and through the serializer, atomic envelope, and every lifecycle JSONL string boundary; focused/full tests, Desktop Node typecheck, fixture lint, scanner syntax, diff hygiene, finite-decision retention, frozen boundaries, and the no-runtime-PASS requirement are dispositioned.
- [x] **No changes outside assigned scope:** only `diagnostic-envelope.mjs`, its direct test, the lifecycle diagnostic test, and this assigned Fix P handoff were changed; no workflow, plan, assertion, threshold, CSP, session, privilege, BrowserWindow, package, routing, or forbidden Server source was edited.
- [x] **Human-review quality / honest and non-marketing:** the exact correction and green evidence are reported without claiming Electron runtime success, M0 acceptance, or production-routing authorization; remaining runtime STOPs are explicit.
