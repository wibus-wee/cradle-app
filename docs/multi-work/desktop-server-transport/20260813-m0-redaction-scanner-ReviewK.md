# Review K: M0 deterministic redaction-scanner re-review

**Task:** Independently re-review Review I's three sanitizer blockers after Fix J

**Review date:** 2026-08-13

**Verdict:** **FAIL.** Fix J closes Review I's exact underscore/word-prefix URL sample, its quote/space characters after an already-reached `?` or `#`, and ordinary quoted secret values with escaped inner quotes. It still does not sanitize every arbitrary string that can be persisted. Independently reproduced escaped outer secret quoting and valid absolute URLs containing a quote or space before the sensitive suffix leave attack markers in `serializeDiagnosticError`, nested diagnostic-envelope JSON, and lifecycle JSONL. This is a local code/evidence review only. It is **not** a development, packaged, Linux, or Windows runtime PASS; it does not accept M0 or authorize production routing.

## Scope and method

I read the living ExecPlan, Review I, Fix J, the current implementation and tests for `diagnostic-envelope*` and `lifecycle-diagnostics*`, the actual worktree diff, the M0 result contract/Main evidence changes, and the three evidence workflows. I made no implementation, test, workflow, plan, assertion, routing, package, or production-source change. The only repository file written by this review is this Review K handoff.

The independent scanner covered arbitrary adjacency prefixes (empty, word, underscore, brackets and punctuation), single/double quotes and whitespace, percent-encoded and special query/fragment values, ordinary and custom schemes, normal and quoted/spaced userinfo, IPv6 plus port, multiple URLs, and trailing punctuation. It also covered authorization/cookie/password/secret/token/Bearer values that were unquoted, normally quoted, had escaped inner quotes, had escaped outer quotes, or escaped an unquoted space. Direct probes were followed by actual persistence through every serializer/envelope/lifecycle string boundary.

## Blocking findings

### 1. Escaped outer quotes and escaped unquoted spaces still leak secret tails

`scanSecretValue` enters quoted mode only when the first value character is literally `'` or `"`. In diagnostic text that itself contains an escaped representation of the outer quotes, the first character is `\`. The scanner therefore takes the unquoted path, stops at the first whitespace, and leaves the rest of the value. The same happens when an unquoted value uses a backslash-escaped space.

This is distinct from Fix J's green escaped-inner-quote case, where the outer quote is literal and only an inner quote is escaped. All requested secret classes reproduced the bypass with both escaped outer quote styles:

```text
authorization=\"LEAK_AUTH_HEAD LEAK_AUTH_TAIL\"
=> authorization=[REDACTED] LEAK_AUTH_TAIL\"

cookie=\'LEAK_COOKIE_HEAD LEAK_COOKIE_TAIL\'
=> cookie=[REDACTED] LEAK_COOKIE_TAIL\'

password=\"LEAK_PASSWORD_HEAD LEAK_PASSWORD_TAIL\"
=> password=[REDACTED] LEAK_PASSWORD_TAIL\"

secret=\'LEAK_SECRET_HEAD LEAK_SECRET_TAIL\'
=> secret=[REDACTED] LEAK_SECRET_TAIL\'

token=\"LEAK_TOKEN_HEAD LEAK_TOKEN_TAIL\"
=> token=[REDACTED] LEAK_TOKEN_TAIL\"

Bearer \"LEAK_BEARER_HEAD LEAK_BEARER_TAIL\"
=> Bearer [REDACTED] LEAK_BEARER_TAIL\"
```

`Authorization: Bearer \"HEAD TAIL\"` also leaks `TAIL`. Likewise, `password=LEAK_HEAD\ LEAK_TAIL` and `Bearer LEAK_HEAD\ LEAK_TAIL` leave `LEAK_TAIL`. Because persisted diagnostics are arbitrary strings and the acceptance surface explicitly includes escaped credentials, treating the backslash as a complete one-character secret is not confidentiality-safe.

### 2. Legal quote/space characters before `?` or `#` prevent the URL scanner from reaching the sensitive suffix

The confidentiality-first truncation is safe only after `redactAbsoluteUrls` reaches a literal `?` or `#`. Its `isUrlTokenTerminator` stops scanning at whitespace, single quote, or double quote before that point. These characters are accepted by Node's WHATWG `URL` parser in path and userinfo positions (space is serialized as `%20`). The scanner can parse the shorter prefix as a complete queryless URL, preserve it, and then append the remainder unchanged, including credentials, query, and fragment.

Exact persisted reproductions included:

```text
https://absolute.test/p'LEAK_PATH?value=LEAK_QUERY#LEAK_HASH
=> unchanged

https://absolute.test/p LEAK_SPACE?value=LEAK_QUERY#LEAK_HASH
=> unchanged

https://user'LEAK_USER:LEAK_PASS@absolute.test/p?value=LEAK_QUERY#LEAK_HASH
=> unchanged
```

The same result holds for double quotes and spaced userinfo. Parsing the complete first and third examples with the same runtime succeeds; the third exposes non-empty username/password. Thus normal unquoted userinfo redaction is green, but the required arbitrary userinfo boundary is not closed.

### 3. The bypasses reach every material persistence layer

The independent persistence probe created and removed its own temporary directory, then passed the attacks through the real code paths:

- `serializeDiagnosticError`: escaped Bearer tail remained in `name`, escaped token tail remained in `message`, quote-before-query URL markers remained in string `code`, and a space-before-query URL remained in a non-Error `message`;
- `writeDiagnosticEnvelope`: nested arrays/objects retained escaped-secret tails and every path/userinfo/query/fragment marker;
- `createM0LifecycleRecorder`: marker leakage was reproduced in `checkpoint`, context `mode`, `resultPath`, `artifactPath`, and string `details` in the appended JSONL record.

The observed envelope and lifecycle leak sets both included the escaped token/Bearer tails and the path, space, userinfo, password, query, and fragment markers. JSON encoding does not cure the leak; it faithfully writes the already incompletely sanitized strings.

These findings keep Review I's third blocker open for escaped representations and expose the same premature-token-boundary defect in URL scanning. Existing tests exercise escaped quotes only inside a normally quoted secret, and exercise quote/space only after `?` has already activated truncation, so 33/33 does not cover these shapes.

## Passing parts and truncation tradeoff

The independent probes and existing regression suite do confirm the following:

- empty/word/underscore/punctuation prefixes no longer bypass an otherwise conventional absolute URL;
- once the scanner reaches the first literal `?` or `#`, plain, single/double-quoted, spaced, percent-encoded, and special query/fragment tails are conservatively discarded without marker leakage;
- conventional HTTPS and custom schemes, ordinary userinfo, IPv6 plus port, multiple queryless URLs before the first sensitive suffix, and `),.;:]}` trailing punctuation behave as intended;
- ordinary quoted assignments and Bearer values, including escaped quotes inside literal outer quotes, are fully redacted;
- conventional queryless absolute URLs, non-URL prose, `/relative?q=keep`, and `C:\\x?keep` remain unchanged.

The documented tradeoff—discard all later diagnostic text after the first validated sensitive suffix—is confidentiality-safe and acceptable when the suffix is actually reached. It intentionally loses later prose and URLs. The current implementation cannot claim that tradeoff closes the surface because quote/space terminators in the valid URL prefix can prevent the suffix from being reached at all. The ordinary queryless URL, relative-path, and Windows-path preservation checks themselves remain green.

## Validation and frozen-boundary check

All commands ran from the repository root.

- Full focused fixture suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 33 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- Scanner syntax: `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS**.
- Diff hygiene: `git diff --check` — **PASS**.
- Direct adversarial scanner and real serializer/envelope/lifecycle persistence probes — **FAIL**, with the exact marker leaks above.

Targeted actual-diff inspection found no Fix J change to workflow orchestration, M0 assertion names or truth conditions, RSS thresholds, strict CSP/`bypassCSP`, scheme privileges, default-session/partition isolation, BrowserWindow security preferences, or production Desktop/Web/Server routing. `result-contract.mjs`, `result-schema.ts`, renderer behavior, production `main-app.ts`, preload, and Web routing have no Fix J delta. The current broader worktree does contain the previously reviewed evidence-preservation workflow/Main/runner changes; they split the two gates, retain hidden evidence, and add diagnostics without relaxing behavior. Main still records `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`; scheme registration remains synchronous before readiness. The unrelated pre-existing untracked `apps/server/src/http/websocket-ticket.ts` remains outside Fix J and this review.

## Final disposition

**Code/evidence-redaction verdict: FAIL.** Fix J does not fully resolve Review I's sanitizer blockers. The scanner must consume escaped outer quoted/escaped-space credential values without leaving tails, and URL scanning must not treat legal quote/space characters before a later query/fragment—or inside userinfo—as proof that the absolute URL ended. Add direct and persistence-level regressions for all six secret classes and for single/double quote and space in path/userinfo before `?/#`, then re-review.

**Runtime verdict: not run and not accepted.** No Electron development gate, packaged gate, Linux/Windows execution, hosted workflow, RSS/cancellation assertion, or runtime result artifact was run by Review K. Prior runtime failures and the production-routing STOP remain in force.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** verdict, exact bypasses, persistence surfaces, passing boundaries, commands/results, frozen scope, runtime status, and next action are all recorded here.
- [x] **Tradeoffs and uncertainties explicit:** conservative post-suffix truncation is accepted where reached; its information loss and its pre-suffix quote/space gap are distinguished, and local checks are separated from runtime evidence.
- [x] **Acceptance criteria addressed:** prefix, quote/space/encoded/special query/hash, userinfo, IPv6/port, custom/multiple URLs, punctuation, all secret forms, every serializer/envelope/lifecycle string boundary, 33 tests, typecheck, lint, syntax, diff hygiene, and frozen security/routing boundaries are dispositioned.
- [x] **No changes outside assigned scope:** this review modifies no implementation, test, workflow, plan, assertion, threshold, security setting, routing source, or unrelated file; it writes only this assigned Review K report.
- [x] **Human-review quality / honest and non-marketing:** green baseline checks are reported without allowing them to override reproducible confidentiality failures, the verdict is explicit, and no runtime PASS or M0 acceptance is claimed.
