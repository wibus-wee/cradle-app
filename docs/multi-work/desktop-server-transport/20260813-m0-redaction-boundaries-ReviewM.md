# Review M: M0 diagnostic redaction-boundary re-review

**Task:** Independently verify Fix L against every Review K sanitizer and persistence blocker

**Review date:** 2026-08-13

**Verdict:** **FAIL.** Fix L closes Review K's exact simple escaped-outer-quote, escaped-space, and single-URL quote/space-before-suffix samples, but the escaped-outer-quote scanner still mistakes an escaped inner quote for the outer close and persists the remaining secret tail. A second adversarial case shows that the URL scanner's “next absolute URL” boundary can preserve a quote/space path marker from a valid first URL while sanitizing the later custom URL. Both failures reproduce at the direct sanitizer, error serializer, atomic diagnostic-envelope, and lifecycle JSONL boundaries. This is a local code/evidence review only. It is **not** a development, packaged, Linux, or Windows runtime PASS; it does not accept M0 or authorize production routing.

## Scope and method

I read the living ExecPlan, Review K, Fix L, the current `diagnostic-envelope*` and `lifecycle-diagnostics*` source and tests, the evidence workflow test, and the complete shared-worktree status/diff. I ran the focused and full fixture suites, Desktop Node typecheck, fixture lint, scanner syntax check, and diff hygiene. I then exercised the real exported sanitizer, both `serializeDiagnosticError` branches, atomic `writeDiagnosticEnvelope`, and `createM0LifecycleRecorder` with independently constructed strings. The temporary persistence probe used its own operating-system temporary directory and removed it. I made no implementation, test, workflow, plan, assertion, routing, or forbidden Server-file change; the only file written by this review is this handoff.

The independent matrix included escaped outer single and double quotes, escaped characters inside those escaped outer quotes, escaped whitespace, authorization/cookie/password/secret/token/Bearer, `Authorization: Bearer`, quote/space path and userinfo before query/fragment, ordinary prose/relative/Windows text, HTTPS and custom schemes, queryless and sensitive URLs, multiple URLs, and scanner advancement after a redacted candidate.

## Blocking findings

### 1. Escaped inner quotes inside escaped outer quotes reopen all secret tails

The escaped-outer-quote branch in `scanSecretValue` accepts any backslash followed by the active quote as a possible close and returns when the following character is whitespace, comma, semicolon, or end of input. It does not account for the preceding escaped backslashes that distinguish a represented escaped inner quote from the represented outer close. Consequently, an escaped inner quote followed by an in-value space terminates scanning early.

The direct probe used the realistic represented form of an already quoted value containing escaped inner quotes:

```text
token=\"TOKEN_HEAD \\\"TOKEN_INNER\\\" TOKEN_TAIL\"
=> token=[REDACTED] TOKEN_TAIL\"

Bearer \"BEARER_HEAD \\\"BEARER_INNER\\\" BEARER_TAIL\"
=> Bearer [REDACTED] BEARER_TAIL\"
```

The same construction left `AUTH_TAIL`, `COOKIE_TAIL`, `PASSWORD_TAIL`, `SECRET_TAIL`, and `TOKEN_TAIL` for each assignment class, with both escaped outer quote styles; Bearer left `BEARER_TAIL`. `Authorization: Bearer` remains vulnerable through its constituent authorization/Bearer scan. This is a continuation of Review K's escaped-representation blocker, not an information-preservation complaint: attacker-controlled secret markers remain in the supposedly sanitized output.

Fix L's new tests cover escaped outer quotes without escaped characters inside them, while the older escaped-inner-quote test uses literal outer quotes. Neither combines the two representations, so 37/37 does not cover this boundary.

### 2. The next-URL boundary can preserve a sensitive first-URL path marker

`redactAbsoluteUrls` limits its extended search to the next independently recognizable `scheme://`. That is useful for preserving multiple diagnostic URLs, but it is not confidentiality-safe for arbitrary URL strings because Node's WHATWG parser also accepts a later `scheme://` sequence inside the first URL's quote/space-containing path. The direct probe was:

```text
https://first.test/p'PATH_LEAK custom+two://second.test/x?QUERY_LEAK#HASH_LEAK
=> https://first.test/p'PATH_LEAK custom+two://second.test/x
```

Parsing the complete input with the same Node runtime succeeds; its first URL path contains the quote, space, and `custom+two://second.test/x`, followed by the query and fragment. The sanitizer instead treats `custom+two://` as a new URL, advances over the initial queryless candidate unchanged, and only truncates the later candidate's suffix. `QUERY_LEAK` and `HASH_LEAK` are removed, but `PATH_LEAK` remains. The equivalent space-path and double-quote/custom-first variants reproduced. This defeats the claimed quote/space-before-query boundary when a second recognizable absolute-URL spelling occurs before the suffix and shows the scanner-advancement ambiguity remains unresolved.

### 3. Both bypasses persist through every material string boundary

The independent real-boundary probe observed:

- direct `redactDiagnosticText`: every escaped-outer-plus-escaped-inner secret class retained its `*_TAIL`, and the multiple/custom URL retained `PATH_LEAK`;
- `serializeDiagnosticError`: Bearer `Error.name`, token `Error.message`, and the URL-shaped string `Error.code` retained markers; the non-Error `message` retained the escaped authorization tail;
- atomic `writeDiagnosticEnvelope`: nested strings retained `AUTH_TAIL`, `COOKIE_TAIL`, `PASSWORD_TAIL`, `SECRET_TAIL`, `TOKEN_TAIL`, `BEARER_TAIL`, and `PATH_LEAK` after JSON encoding and rename;
- `createM0LifecycleRecorder`: the same marker classes persisted through checkpoint, context `mode`, `resultPath`, `artifactPath`, and string-valued details in the appended JSONL record.

The serializer and persistence layers correctly delegate every string to the shared sanitizer; that makes the scanner the single defect owner, but it also means JSON serialization and atomic I/O cannot close these leaks downstream.

## Passing behavior and tradeoff

Fix L does pass the exact Review K examples with simple escaped outer single/double quotes and unquoted escaped spaces for all six secret classes. Literal outer quotes with escaped inner quotes remain green. A single absolute URL containing a single/double quote or space in path or userinfo before its own query/fragment now truncates safely; quoted/spaced queryless userinfo is removed and scanner advancement skips the validated credential candidate. Conventional userinfo, IPv6/port, ordinary and custom schemes, punctuation, prefix adjacency, encoded/special suffixes, and multiple conventional queryless URLs before a sensitive URL are green.

Standalone ordinary prose, `/relative?q=keep`, `C:\\temp\\x?keep=yes`, and conventional queryless absolute URLs remain unchanged. Fix L's documented confidentiality-first behavior can discard prose or a relative-path-looking tail once one validated absolute URL reaches a sensitive suffix; that information loss is acceptable for evidence. It does not justify the two remaining marker leaks above, where scanning terminates at an escaped inner delimiter or reclassifies a later scheme before applying the sensitive suffix to the valid complete URL.

## Validation and frozen-boundary check

All commands ran from the repository root.

- Focused sanitizer/persistence suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 19 tests**.
- Full focused fixture suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 37 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- Scanner syntax: `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS**.
- Diff hygiene: `git diff --check` — **PASS**.
- Independent direct/serializer/atomic-envelope/lifecycle JSONL probe — **FAIL**, with the exact retained markers listed above.

Vitest emitted only the existing Vite tsconfig-path and Oxc notices; they were not failures.

Targeted current-source and diff inspection found no Fix L edit to workflow orchestration, required assertion names or truth conditions, cancellation/streaming/transfer/RSS/cleanup thresholds, strict CSP or `bypassCSP`, exact scheme privilege registration, default-session handling or partition denial, BrowserWindow `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, or `webSecurity: true`, result contracts, package configuration, or production Desktop/Web/Server routing. The broader shared worktree contains the previously reviewed evidence-preservation workflow/Main/runner changes, including independent gate steps and retained hidden artifacts; those changes do not relax M0 behavior truth conditions. Production routing remains unchanged. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remained untouched and outside this review.

## Final disposition

**Code/evidence-redaction verdict: FAIL.** Fix L does not close every Review K blocker for arbitrary persisted strings. The shared scanner needs to distinguish an escaped inner quote from the escaped outer close without leaving a tail, with direct and all-persistence regressions for every secret class. Its multiple-URL boundary also needs a confidentiality-safe rule for quote/space-containing valid URL paths before a later query/fragment and recognizable custom/ordinary scheme, including explicit scanner-advancement assertions. The green test, typecheck, lint, syntax, and hygiene results do not override reproduced persisted marker leakage.

**Runtime verdict: not run and not accepted.** Review M ran no Electron development gate, ASAR-packaged gate, Linux/Windows executable, hosted workflow, RSS/cancellation runtime proof, or M0 artifact validation. There is explicitly no runtime PASS and no M0 acceptance. Prior runtime failures and the production-routing STOP remain in force.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** verdict, exact remaining bypasses, scanner causes, direct and persistence evidence, passing behavior, commands/results, frozen scope, runtime status, and required next correction are recorded here.
- [x] **Tradeoffs and uncertainties explicit:** accepted confidentiality-first information loss is separated from marker leakage; the next-URL ambiguity and local-versus-runtime evidence limits are explicit.
- [x] **Acceptance criteria addressed:** escaped outer and inner quotes, escaped spaces/characters, all six secret classes, quote/space path and userinfo before query/fragment, ordinary preservation, multiple/custom URLs, scanner advancement, direct serializer, atomic envelope, lifecycle JSONL, focused/full tests, typecheck, lint, syntax, diff hygiene, and frozen workflow/security/routing boundaries are dispositioned.
- [x] **No changes outside assigned scope:** this review changes no sanitizer, test, workflow, plan, assertion, threshold, CSP, session, privilege, BrowserWindow, package, routing, or forbidden Server source; it writes only this assigned Review M handoff.
- [x] **Human-review quality / honest and non-marketing:** all green checks and closed examples are reported without allowing them to conceal reproducible persisted secret/path markers; the FAIL is explicit, and no runtime PASS or M0 acceptance is claimed.
