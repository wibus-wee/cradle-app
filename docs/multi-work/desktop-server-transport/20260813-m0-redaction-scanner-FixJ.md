# Fix J: deterministic M0 diagnostic redaction scanner

**Task:** Plan 063 / living ExecPlan Node A / Review I sanitizer-bypass correction

**Fix date:** 2026-08-13

**Disposition:** **FIXED AND LOCALLY VERIFIED; NO M0 RUNTIME PASS.** Review I's word-prefix URL bypass, quote-truncated URL suffixes, and quoted whitespace-containing credential tails are covered by a deterministic scanner and persistence-level regression tests. This fix does not accept M0, authorize production routing, or change any runtime assertion or security truth condition.

## Failure and scope

Review I reproduced three confidentiality failures in arbitrary strings that can reach uploaded diagnostic evidence:

- `_https://absolute.test/p?alpha=LEAK_QUERY#LEAK_HASH` bypassed the URL regex because `_` and the first scheme character both satisfied its word-boundary class;
- single or double quotes and spaces accepted inside an absolute URL query terminated the regex candidate, leaving query and fragment tails in persisted text;
- quoted authorization, cookie, password, secret, token, and Bearer values stopped at their first whitespace, leaving the rest of the secret in persisted text.

Fix J changes only the shared M0 sanitizer and its diagnostic/lifecycle regression tests:

- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts`

This handoff is the only documentation file added by Fix J. Fix J did not edit the lifecycle recorder implementation, workflows, the ExecPlan, command runner, fixture Main or runner, result contracts, assertions, memory thresholds, CSP, scheme privileges, sessions, BrowserWindow preferences, production Desktop/Web/Server routing, or package configuration. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` was not opened or modified.

## Deterministic scanner

`redactDiagnosticText` no longer asks a regex to infer a complete absolute URL or secret value. It now performs three bounded left-to-right scans:

1. The URL scanner finds `scheme://` at any character position, including after `_` or another word character. It scans the authority/path prefix, validates it with the WHATWG `URL` parser, and reconstructs sensitive URLs as `protocol//host/pathname`. URL username/password, query, and fragment are therefore omitted while scheme, IPv4/IPv6 host, port, and pathname remain useful.
2. The Bearer scanner recognizes the case-insensitive word and consumes either one unquoted value or an entire single/double-quoted value. Backslash-escaped quote characters do not terminate a quoted value.
3. The assignment scanner recognizes case-insensitive authorization, cookie, password, secret, and token names followed by `:` or `=`, then consumes the same unquoted or quoted value shapes before replacing the complete value.

The URL scanner deliberately makes a confidentiality-first tradeoff: after the first validated absolute URL reaches `?` or `#`, it retains that URL's scheme/host/port/path and discards the rest of that diagnostic string. It does **not** guess that whitespace, single quotes, double quotes, punctuation, or another `scheme://` ends the query/fragment, because WHATWG URL query values can contain those characters and such a guess recreated Review I's leak. Multiple queryless absolute URLs before the first sensitive suffix remain discoverable and unchanged; once the sensitive suffix begins, later prose and later URLs are conservatively omitted. This affects diagnostic evidence only and never fixture behavior or assertions.

Queryless absolute URLs without userinfo remain byte-for-byte unchanged, including surrounding `),.;:]}` punctuation. Ordinary prose, relative routes containing `?`, and Windows paths containing `?` also remain unchanged. Invalid `scheme://` candidates are preserved rather than reconstructed.

No Architecture Escalation was required: every arbitrary-string persistence boundary already calls the shared sanitizer, so correcting the sanitizer closes the demonstrated bypasses without changing the evidence schema or runtime architecture.

## Regression evidence

The focused tests now cover:

- exact Review I prefix, single-quote, double-quote, and whitespace URL-tail attacks;
- a deterministic prefix-by-suffix attack matrix covering empty, underscore, word-character, parenthesis, and bracket prefixes together with plain, quoted, spaced, percent-encoded, special-character, query, and fragment suffixes;
- HTTPS and custom schemes, URL userinfo, IPv6 plus port, multiple queryless URLs before a sensitive suffix, and trailing punctuation;
- queryless absolute URLs, non-URL prose, relative URLs, and Windows paths that must remain unchanged;
- single/double-quoted and escaped-quote authorization, cookie, password, secret, token, and Bearer values containing spaces;
- all `serializeDiagnosticError` string outputs: `Error.name`, `Error.message`, string `Error.code`, and non-Error messages;
- nested arrays and objects written through the real atomic `writeDiagnosticEnvelope` path;
- lifecycle `checkpoint`, context `mode`, `resultPath`, `artifactPath`, and string `details` written through the real append-only JSONL recorder.

Persisted JSON/JSONL assertions reject every attack marker and verify that the retained URL is exactly its scheme, host/port, and path. The lifecycle implementation was not changed because it already sanitizes each listed string boundary at persistence time.

## Validation performed

All commands ran from the repository root.

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 14 tests** before the final matrix addition; the final full run below includes that additional test.
- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 33 tests**.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS**.
- `git diff --check` — **PASS**.
- Targeted frozen-boundary inspection — **clean for Fix J scope**: no Fix J edit changed a workflow, assertion/threshold, cancellation requirement, CSP or `bypassCSP`, scheme privilege, session/partition condition, BrowserWindow preference, production routing, or Server source.

Vitest emitted only the existing Vite notices about native tsconfig-path support and Oxc; they were not test failures. The shared worktree still contains earlier evidence-preservation changes and the unrelated untracked Server file; Fix J neither attributes nor modifies them.

## Runtime and remaining gate status

**There is no development runtime PASS, packaged runtime PASS, Linux runtime PASS, Windows runtime PASS, or M0 acceptance in this handoff.** Fix J ran no Electron runtime, Xvfb gate, ASAR-packaged executable, Windows process inventory, hosted workflow, result JSON validation, RSS trace, cancellation probe, or session runtime evidence. The prior Linux behavior failures and Windows missing-result failure remain blocking, and production transport migration remains unauthorized.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** the three reproduced failures, complete scanner behavior, persistence paths, security tradeoff, regression scope, validation results, frozen boundaries, and runtime status are contained here.
- [x] **Tradeoffs and uncertainties explicit:** after a validated URL's first `?` or `#`, the remaining diagnostic string is intentionally discarded; the handoff does not claim recovery of later prose or URLs and distinguishes this from preservation of queryless URLs and ordinary non-URL text.
- [x] **Acceptance criteria addressed:** prefix adjacency, quote/space/encoded/special URL values, credentials, custom schemes, userinfo, IPv6/port, punctuation, multi-URL input, every serializer/envelope/lifecycle persistence surface, 25-plus tests, typecheck, lint, syntax, diff hygiene, and frozen runtime/security boundaries are explicitly dispositioned.
- [x] **No implementation details leaked outside assigned scope:** Fix J edits only the sanitizer, its two focused test files, and this handoff; workflows, runtime behavior, production routing, and the forbidden Server file remain untouched.
- [x] **Human-review quality, honest/thorough/no marketing:** local code verification is reported separately from unrun runtime gates, the information-loss tradeoff is stated plainly, prior runtime failures remain in force, and no M0 acceptance is claimed.
