# Implementation N: M0 Main-owned terminal redaction

**Task:** Plan 063 / living ExecPlan Node A terminal-redaction implementation after Review M

**Implementation date:** 2026-08-13

**Disposition:** **IMPLEMENTED AND LOCALLY VERIFIED; NO M0 RUNTIME PASS.** The superseded arbitrary-string URL/value reconstruction has been removed. Every diagnostic string now follows the Main-owned finite terminal rule: at the earliest syntactic absolute-URL marker, Bearer value, or recognized secret assignment, preserve only text before that trigger, append the fixed `[REDACTED]` marker, and discard the remainder. Direct, error-serializer, atomic-envelope, and lifecycle-JSONL regressions cover the Review G, I, K, and M attacks. This implementation does not accept M0, authorize production routing, or change any runtime truth condition.

## Decision implemented

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` now performs one bounded left-to-right scan. The first matching index wins, and the function immediately returns the preceding text plus `[REDACTED]`.

A syntactic absolute-URL marker is an ASCII letter followed by zero or more ASCII letters, digits, `+`, `.`, or `-`, then `://`. It is recognized without requiring a preceding word boundary, so underscore- and word-adjacent spellings from Review I still terminate. A Bearer value is a whole-word, case-insensitive `Bearer`, followed by whitespace and at least one subsequent character. A recognized secret assignment is a whole-word, case-insensitive `authorization`, `cookie`, `password`, `secret`, or `token`, optional whitespace, then `:` or `=`. The assignment trigger does not parse the value and therefore also terminates safely for blank or malformed values. Strings containing no trigger are returned unchanged.

The implementation deletes the heuristic machinery that caused the four review failures: there is no WHATWG `URL` parse/reconstruction, URL terminator or punctuation inference, userinfo/path/query/fragment boundary recovery, next-URL boundary, quoted-value parser, escaped-outer-quote grammar, secret-value end scan, or iterative suffix preservation. `serializeDiagnosticError`, the `writeDiagnosticEnvelope` JSON replacer, and `createM0LifecycleRecorder` already delegate every arbitrary string to the shared sanitizer, so no second redaction policy was added.

No Architecture Escalation was required. The updated Plan decision closes the persisted arbitrary-string surface at its existing shared owner. The material persistence boundaries already compose with that owner, so the correction requires neither an evidence-schema change nor an M0 runtime or production-transport change.

## Information-loss tradeoff

The confidentiality cost is intentional and substantially larger than the superseded behavior. After the first trigger, the sanitizer loses the URL scheme, authority, path, punctuation, later prose, later URLs, assignment name, secret delimiter, and every other suffix character, even when a URL is queryless or a suffix would have been harmless. For example, `navigation failed at https://host/path; retry later` persists only as `navigation failed at [REDACTED]`, and `safe; token=value; public suffix` persists only as `safe; [REDACTED]`.

This loss is acceptable for the evidence-preservation node because structured fields retain lifecycle sequence/checkpoint prefixes, timestamps, process/platform facts, booleans and numeric counters, command settlement, file metadata/hashes, and strings that contain no trigger. The rule deliberately declines to decide where attacker-controlled URL or credential text ends. Relative paths such as `/route?keep=yes`, Windows paths such as `C:\release\fixture.exe`, ordinary prose mentioning `token` without `:` or `=`, and the word `Bearer` without a value remain unchanged.

## Regression evidence

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts` directly proves the finite rule for conventional, prefixed, custom-scheme, userinfo, multiple-scheme, queryless, query/fragment, quote/space-path, and Review M next-scheme inputs. It covers all five assignment names plus Bearer with plain values, literal quoted values, escaped outer quotes, escaped inner quotes, and escaped spaces. Exact safe-prefix outputs prove terminal behavior rather than merely checking marker absence.

The same test exercises every string branch of `serializeDiagnosticError`: `Error.name`, `Error.message`, string `Error.code`, and a non-Error message. Its real `writeDiagnosticEnvelope` regression writes nested Review G/I/K/M attacks through JSON serialization, mode-`0600` temporary-file creation, and atomic rename, then parses the persisted file and rejects representative attack markers.

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts` sends Review G/I/K/M shapes through checkpoint, context `mode`, `resultPath`, `artifactPath`, and string-valued details. It reads the appended JSONL record, asserts the exact retained prefix plus marker at every boundary, and rejects query/hash, escaped-secret-tail, escaped-inner-delimiter, and multiple-scheme path markers. A separate test proves ordered structured evidence and no-trigger relative/Windows/ordinary-string preservation.

## Validation performed

All commands ran from the repository root.

- Focused sanitizer/persistence suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 9 tests**.
- Full fixture suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 27 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- Scanner syntax: `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS, exit 0**.
- Diff hygiene: `git diff --check` — **PASS, exit 0**.

Vitest emitted only the existing Vite notices about native tsconfig-path support and Oxc; they were not failures.

## Frozen boundaries and runtime disposition

Implementation N changes only the shared sanitizer, its direct/serializer/atomic-envelope test, its lifecycle-persistence test, and this handoff. `lifecycle-diagnostics.ts` did not require an edit. It makes no change to workflow orchestration or evidence retention; required M0 assertion names or truth conditions; first-byte, cancellation, upload, 64/128 MiB transfer, RSS, or cleanup thresholds; strict CSP or `bypassCSP`; the exact five enabled and four disabled scheme privileges; `session.defaultSession` handling or partition denial; BrowserWindow `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, or `webSecurity: true`; result schemas/contracts; package configuration; authentication/ticket behavior; or production Desktop/Web/Server routing. The unrelated pre-existing untracked `apps/server/src/http/websocket-ticket.ts` remained untouched.

The broader shared worktree still contains the previously assigned evidence-preservation workflow, runner, Main, plan, and test changes. Implementation N neither edits nor reclassifies those changes. The production-routing STOP remains in force.

**There is no development runtime PASS, packaged runtime PASS, Linux runtime PASS, Windows runtime PASS, hosted-workflow PASS, or M0 acceptance in this handoff.** No Electron process, Xvfb gate, ASAR-packaged executable, Windows process inventory, RSS/cancellation runtime proof, or result-artifact validation was run. This is local code and persistence-boundary evidence only; all prior runtime failures remain unresolved.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** the governing finite rule, trigger definitions, removed heuristics, information-loss cost, direct and persisted regression surfaces, commands/results, frozen scope, architecture disposition, and runtime status are recorded here.
- [x] **Tradeoffs and uncertainties explicit:** terminal redaction intentionally loses queryless URL locations, assignment labels, punctuation, and all later diagnostic prose; retained structured/no-trigger evidence and the limits of local verification are explicit.
- [x] **Acceptance criteria addressed:** Review G/I/K/M URL, prefix, quote/space, escaped-secret, escaped-inner-delimiter, and multiple-scheme attacks are covered at direct, serializer, atomic-envelope, and lifecycle-JSONL boundaries; focused/full tests, typecheck, lint, syntax, diff hygiene, and every frozen workflow/security/routing boundary are dispositioned.
- [x] **No changes outside assigned scope:** only the shared M0 sanitizer, its two focused test files, and this assigned handoff are changed by Implementation N; workflows, plans, lifecycle implementation, runtime assertions/thresholds, security settings, production routing, and the forbidden Server file are not edited.
- [x] **Human-review quality / honest and non-marketing:** the report states the confidentiality-versus-diagnostic-information tradeoff, distinguishes local proof from unrun runtime gates, leaves prior runtime failures and the routing STOP in force, and claims neither runtime PASS nor M0 acceptance.
