# Fix L: M0 diagnostic redaction boundaries

**Task:** Plan 063 / living ExecPlan Node A / Review K sanitizer-boundary correction

**Fix date:** 2026-08-13

**Disposition:** **FIXED AND LOCALLY VERIFIED; NO M0 RUNTIME PASS.** Review K's escaped-secret-tail and pre-suffix URL-boundary failures are closed by a narrow shared-scanner correction with direct and real-persistence regressions. This fix does not accept M0, authorize production routing, or change any workflow, runtime assertion, threshold, CSP, session, privilege, BrowserWindow, or production transport truth condition.

## Failure, correction, and scope

Review K reproduced two confidentiality failures in arbitrary strings that can be uploaded as M0 evidence. First, secret values whose outer quote or internal whitespace was backslash-escaped entered the unquoted scanner and left their whitespace-separated tail. This affected authorization, cookie, password, secret, token, and Bearer forms, including `Authorization: Bearer`. Second, the URL scanner stopped at a single quote, double quote, or whitespace before reaching a later `?` or `#`. Node's WHATWG `URL` parser accepts those characters in paths and userinfo, so the discarded candidate boundary left path, username, password, query, and fragment markers in serialized and persisted diagnostics.

Fix L changes only:

- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs`;
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts`;
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts`;
- this handoff.

The shared secret scanner now recognizes a leading backslash plus single or double quote as an escaped outer quoted value. It consumes through the matching escaped close, and it conservatively consumes to the end if no unambiguous close delimiter exists. Its unquoted path skips a backslash together with the escaped following character, so an escaped space remains inside the value instead of exposing a tail. The existing literal-outer-quote and escaped-inner-quote behavior remains intact.

The URL scanner now looks beyond an initial quote or whitespace terminator for a later query or fragment before the next independently recognizable absolute URL. It validates the complete pre-suffix candidate with the same WHATWG parser. For a sensitive candidate it retains only the parsed scheme, host/port, and the pathname prefix before the first ambiguous quote/space boundary; all userinfo and the remaining ambiguous path/query/fragment text are omitted. It also extends a queryless candidate across quoted or spaced userinfo when an `@` authority boundary is present, so those credential forms are removed even without `?` or `#`. The scanner advances over the complete validated credential candidate, preventing its raw tail from being appended a second time.

No Architecture Escalation was required. Every material serializer and persistence boundary already delegates string sanitization to `redactDiagnosticText`; the defect and correction remain local to that owner and do not require an evidence-schema, fixture-runtime, or production architecture change. `lifecycle-diagnostics.ts` itself did not need an edit.

## Confidentiality tradeoff

Spaces and quotes create an unavoidable diagnostic-text ambiguity: `https://host/p /value?q=secret` can be either an absolute WHATWG URL whose path contains a space and slash or a queryless URL followed by prose and a relative path. Fix L resolves this in favor of confidentiality. After a validated absolute URL can reach a later `?` or `#`, the safe URL location is retained and the ambiguous remainder is discarded. Consequently, prose or a relative path following that absolute URL may be lost. Standalone non-URL prose, `/relative?q=keep`, `C:\x?keep`, queryless absolute URLs, trailing punctuation, and multiple queryless absolute URLs before a sensitive suffix remain covered and green. This is diagnostic-evidence information loss only; it changes no M0 behavior or truth condition.

## Direct and persistence regressions

The direct scanner tests now cover all five assignment names—authorization, cookie, password, secret, and token—plus Bearer, using escaped outer single quotes, escaped outer double quotes, and unquoted escaped spaces. They include the exact `Authorization: Bearer \"HEAD TAIL\"` composition. URL cases cover single quotes, double quotes, spaces, and a space-plus-slash in paths before `?/#`; the same three characters in userinfo before `@`; and quoted/spaced queryless userinfo. Each attack is checked against an exact safe output.

`serializeDiagnosticError` regressions exercise `Error.name`, `Error.message`, string `Error.code`, and a non-Error message with the new attacks. The real atomic `writeDiagnosticEnvelope` test persists nested escaped authorization/cookie/password/secret/token/Bearer values plus quoted/spaced path and userinfo URLs, parses the resulting JSON, and rejects every attack marker. The real `createM0LifecycleRecorder` test persists attacks through `checkpoint`, context `mode`, `resultPath`, `artifactPath`, and every string-valued `details` class, then parses the appended JSONL and rejects every marker. These tests demonstrate confidentiality after actual JSON encoding and filesystem persistence, not only at the helper return value.

## Validation performed

All commands ran from the repository root.

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 19 tests**.
- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 37 tests**.
- A direct Node adversarial probe covering both escaped outer quote styles, escaped spaces, all six secret classes, quote/space path and userinfo URLs, and every `serializeDiagnosticError` string field — **PASS**.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS**.
- `git diff --check` — **PASS**.

Vitest emitted only the existing Vite notices about native tsconfig-path support and Oxc; they were not test failures.

## Frozen-boundary and runtime disposition

Targeted scope and source inspection confirms that Fix L has no edit to workflow orchestration; M0 assertion names or truth conditions; first-byte, cancellation, upload, transfer-size, RSS, or cleanup thresholds; strict CSP or `bypassCSP`; exact scheme privileges; default-session or partition isolation; BrowserWindow `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, or `webSecurity: true`; result contracts; fixture Main/renderer behavior; package configuration; production Desktop/Web/Server routing; or authentication/ticket behavior. The broader shared worktree still contains the earlier evidence-preservation changes reviewed by Review K. Fix L neither changes nor claims those edits. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` was not modified.

**There is no development runtime PASS, packaged runtime PASS, Linux runtime PASS, Windows runtime PASS, hosted-workflow PASS, or M0 acceptance in this handoff.** Fix L ran no Electron runtime, Xvfb gate, ASAR-packaged executable, Windows process inventory, RSS/cancellation runtime proof, or result-artifact validation. Prior runtime failures and the production-routing STOP remain in force.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** the exact Review K failures, scanner correction, ambiguity tradeoff, direct and persisted regression surfaces, commands/results, frozen scope, runtime status, and disposition are all recorded here.
- [x] **Tradeoffs and uncertainties explicit:** confidentiality-first truncation can discard prose or relative-path-looking text after an absolute URL; standalone ordinary/relative/Windows text remains green, and local verification is explicitly separated from runtime evidence.
- [x] **Acceptance criteria addressed:** escaped outer single/double quotes, escaped spaces, all six secret classes, quote/space path and userinfo before `?/#`, direct serializer coverage, nested envelope and lifecycle JSONL persistence, focused/full tests, typecheck, lint, syntax, diff hygiene, and every frozen security/routing boundary are dispositioned.
- [x] **No changes outside assigned scope:** Fix L edits only the shared M0 sanitizer, its two focused test files, and this assigned handoff; it does not edit workflows, plans, fixture behavior contracts, production routing, lifecycle implementation, or the forbidden Server file.
- [x] **Human-review quality / honest and non-marketing:** the report states the information-loss cost, distinguishes local code proof from unrun runtime gates, leaves prior runtime failures in force, and claims neither runtime PASS nor M0 acceptance.
