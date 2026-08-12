# Fix H: M0 diagnostic and lifecycle URL redaction

**Task:** Plan 063 / living ExecPlan Node A / Review G's single diagnostic-confidentiality failure

**Fix date:** 2026-08-13

**Disposition:** **FIXED AND LOCALLY VERIFIED; NO M0 RUNTIME PASS.** Embedded absolute URLs persisted by the M0 diagnostic envelope or Main lifecycle JSONL now retain only protocol, host, port, and pathname. URL credentials, query strings, and fragments are removed. Existing bearer and secret-shaped assignment redaction remains enforced. This fix does not accept M0, authorize production routing, or change any runtime assertion or security truth condition.

## Failure and scope

Review G proved that `redactDiagnosticText('navigation failed at https://example.test/path?alpha=one&beta=two')` returned the complete query-bearing URL. The reachable persistence path was `main.ts` copying an arbitrary `Error.message` into navigation, finalize, uncaught-exception, unhandled-rejection, or fatal lifecycle details, followed by `lifecycle-diagnostics.ts` writing the string to an uploaded JSONL artifact.

Fix H changes only the shared M0 diagnostic sanitizer and its diagnostic/lifecycle regression tests:

- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts`

This handoff is the only documentation file added by Fix H. The existing ExecPlan, workflows, M0 runner behavior, result contract, assertions, memory thresholds, CSP, scheme privileges, session ownership, BrowserWindow preferences, production routing, and package configuration are unchanged. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` was inspected only through `git status` and was not modified.

## Narrow implementation

`redactDiagnosticText` now identifies embedded hierarchical absolute URLs by their explicit `scheme://` form and validates each candidate with the standard WHATWG `URL` parser. A candidate containing a query marker, fragment marker, username, or password is reconstructed as `protocol//host/pathname`; its scheme, hostname, port, and path therefore remain useful for diagnosis while credentials, query, and fragment do not persist. Ordinary text, relative paths, Windows paths, and absolute URLs without sensitive URL components remain unchanged. Sentence punctuation surrounding a URL is retained.

The existing credential sanitizer still replaces bearer values and `authorization`, `cookie`, `password`, `secret`, and `token` assignments. `serializeDiagnosticError` now applies the shared sanitizer to every persistable string it returns: error name, message, and string code. Its required `Error.message` path therefore cannot bypass URL or credential redaction.

`writeDiagnosticEnvelope` applies the shared sanitizer to every nested string value during JSON serialization. This is a defense at the persistence boundary for launch, artifact, settlement, and serialized-error strings, even when a caller has not already sanitized a value.

`createM0LifecycleRecorder` applies the same sanitizer to every caller-controlled string surface in its record: checkpoint, context mode/result/artifact paths, and all string detail values. It keeps the existing ordered append-only JSONL behavior, schema, sequence numbers, timestamps, file mode, and synchronous checkpoint writes.

No checkpoint was removed, suppressed, or reclassified. No architecture change was needed, so there is no Architecture Escalation.

## Direct regression coverage

The diagnostic tests now prove:

- a real `Error.message` containing two absolute URLs is serialized without either original URL, query value, or fragment;
- both HTTPS and the fixture custom scheme retain their protocol/host/path diagnostic form;
- percent-encoded values and special query characters are removed;
- URL username/password information is removed even without a query;
- bearer, token, cookie, password, and secret-shaped values remain redacted;
- non-URL prose, a relative route with `?`, and a Windows path with `?` remain byte-for-byte unchanged;
- a nested unsanitized envelope string is sanitized immediately before atomic persistence.

The lifecycle tests now pass navigation-failed and fatal-shaped details through the real recorder. They include multiple URLs, HTTPS and custom-scheme URLs, encoded/special queries, fragments, and secret-named parameters. The persisted JSONL retains queryless URL locations and contains none of the original query values, fragments, passwords, or full URLs.

A direct adversarial probe now produces:

    input:  navigation failed at https://example.test/path?alpha=one&beta=two
    output: navigation failed at https://example.test/path

    input:  two https://a.test/p?q=1 and cradle-m0://gate/x?encoded=a%2Bb%26c#h
    output: two https://a.test/p and cradle-m0://gate/x

    input:  non-url Error: socket and /relative?q=keep
    output: non-url Error: socket and /relative?q=keep

## Validation performed

All commands ran from the repository root.

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 7 tests**.
- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 25 tests**.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS**.
- `git diff --check` — **PASS**.
- Path-scoped worktree inspection — **PASS for Fix H scope**: Fix H touched only the four diagnostic/lifecycle implementation and test paths listed above; it did not edit workflows, result assertions/contracts, thresholds, CSP/session/privilege/BrowserWindow settings, production routing, or `apps/server/src/http/websocket-ticket.ts`.

Vitest emitted only the pre-existing Vite configuration notices about native tsconfig-path support and Oxc; they were not test failures. The shared worktree still contains earlier Implementation F changes and the unrelated untracked Server file, neither of which Fix H attributes to itself.

## Runtime and remaining gate status

**There is no development runtime PASS, packaged runtime PASS, Linux runtime PASS, Windows runtime PASS, or M0 acceptance in this handoff.** No Electron runtime, Xvfb gate, ASAR-packaged executable, Windows process inventory, hosted workflow, result JSON, RSS trace, or cancellation/session runtime evidence was executed or inferred by Fix H. Production routing remains blocked exactly as before. The known Linux behavior failures and Windows no-result failure remain runtime failures pending evidence-preserved runs.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** the Review G failure, reachable persistence path, exact narrow correction, regression inputs, validation commands/results, unchanged boundaries, and remaining runtime STOP are stated here.
- [x] **Tradeoffs and uncertainties explicit:** URL diagnostics deliberately retain protocol/host/port/path while discarding credentials/query/fragment; static verification is separated from unexecuted Linux/Windows Electron runtime evidence.
- [x] **Acceptance criteria addressed:** Error.message, multiple URLs, encoded/special queries, non-URL preservation, lifecycle navigation/fatal shapes, credential redaction, full focused tests, typecheck, lint, syntax, and diff hygiene are all dispositioned explicitly.
- [x] **No implementation details leaked outside assigned scope:** edits are confined to the shared M0 diagnostic sanitizer, lifecycle persistence sanitization, and their focused tests; workflows, assertions, thresholds, CSP/session/privilege/BrowserWindow settings, production routing, and the forbidden Server file are untouched.
- [x] **Human-review quality, honest/thorough/no marketing:** this handoff reports the exact local evidence, states that no Architecture Escalation was necessary, preserves all prior runtime failures, and makes no runtime PASS or M0 acceptance claim.
