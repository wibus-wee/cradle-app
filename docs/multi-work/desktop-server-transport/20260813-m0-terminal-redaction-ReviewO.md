# Review O: M0 terminal-redaction independent re-review

**Task:** Independently and adversarially review the Main-owned terminal-redaction decision and Implementation N

**Review date:** 2026-08-13

**Verdict:** **FAIL.** Implementation N closes the exact Review G, I, K, and M URL/escaping/multiple-scheme attacks and correctly applies the intended terminal rule for conventional ASCII inputs, but it does not recognize every later Bearer value or secret assignment in an arbitrary diagnostic string. A Unicode lowercase expansion before the trigger desynchronizes the scanner's original-string and lowercased-string indices, leaving the complete credential-shaped suffix unchanged. The bypass persists through the direct sanitizer, every `serializeDiagnosticError` string branch, atomic diagnostic-envelope JSON, and lifecycle JSONL. This is a local code/evidence review only. It is **not** a development, packaged, Linux, Windows, or hosted-workflow runtime PASS; it does not accept M0 or authorize production routing.

## Scope and method

I read the living ExecPlan, Plan 063, Review M, Implementation N, Reviews G/I/K, the current `diagnostic-envelope*` and `lifecycle-diagnostics*` implementation/tests, the complete shared-worktree status/diff, and the evidence workflow/Main/runner changes needed to verify frozen boundaries. I ran the focused and full fixture suites, Desktop Node typecheck, fixture lint, scanner syntax check, diff hygiene, a conventional terminal-rule matrix, and an independent real-boundary persistence probe. The probe used its own operating-system temporary directory and removed it. I made no implementation, test, workflow, plan, assertion, threshold, security, routing, package, or forbidden Server-file change; the only file written by this review is this handoff.

The independent matrix covered ordinary and custom URL schemes, word/underscore adjacency, multiple URL markers, earliest-trigger ordering, case and whitespace variants of Bearer, all five assignments, Review G/I/K/M escaped and multi-scheme attacks, direct error serialization, atomic envelope persistence, lifecycle checkpoint/context/details persistence, and no-trigger relative/ordinary preservation.

## Blocking finding

### Full-string lowercase expansion shifts every later Bearer and assignment index

`redactDiagnosticText` builds `lowerText = text.toLowerCase()` at `diagnostic-envelope.mjs:72`, then iterates indices bounded by the original `text` at lines 73-77. `startsBearerValue` and `startsSecretAssignment` use that original-string index against `lowerText` at lines 41 and 56 while checking boundaries and separators against the original string. JavaScript lowercasing is not length-preserving: U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE occupies one UTF-16 code unit but lowercases to two code units, `i` plus U+0307. Once such an ordinary character occurs before a credential trigger, all later `lowerText` indices are shifted and neither detector recognizes its trigger.

The direct probe produced unchanged outputs for all required secret classes:

```text
prefix \u0130 authorization=UNICODE_AUTH_TAIL
prefix \u0130 cookie=UNICODE_COOKIE_TAIL
prefix \u0130 password=UNICODE_PASSWORD_TAIL
prefix \u0130 secret=UNICODE_SECRET_TAIL
prefix \u0130 token=UNICODE_TOKEN_TAIL
prefix \u0130 Bearer UNICODE_BEARER_TAIL
prefix \u0130 Authorization: Bearer UNICODE_AUTH_BEARER_TAIL
```

In every case `redactDiagnosticText` returned the complete input with no `[REDACTED]` marker. The character is merely earlier diagnostic prose; the trigger spellings themselves are the exact ASCII, whole-word, case-insensitive Bearer/assignment forms owned by the decision. This therefore violates “every recognized assignment,” Bearer redaction, and the claim that every arbitrary diagnostic string terminates at its earliest trigger. Absolute-URL detection reads only the original string and is not affected by this particular shift.

### The bypass persists through every material string boundary

The independent real-boundary probe observed:

- `serializeDiagnosticError`: `Error.name` retained `Bearer SERIAL_NAME_LEAK`, `Error.message` retained `token=SERIAL_MESSAGE_LEAK`, string `Error.code` retained `cookie=SERIAL_CODE_LEAK`, and a non-Error message retained `Authorization: NONERROR_LEAK`, each after the same `\u0130` prefix.
- `writeDiagnosticEnvelope`: atomic JSON serialization and rename persisted unchanged `authorization`, `cookie`, `password`, `secret`, `token`, and Bearer marker values after the prefix.
- `createM0LifecycleRecorder`: appended JSONL persisted the bypass in checkpoint, context `mode`, `resultPath`, `artifactPath`, and string-valued details.

The envelope replacer and lifecycle recorder correctly delegate their string values to the shared sanitizer, so the defect has one code owner; JSON encoding and atomic I/O cannot repair its missed trigger downstream. The focused regressions use ASCII prefixes and therefore do not exercise length-changing case conversion.

## Passing behavior and structured-evidence tradeoff

Implementation N's terminal decision is otherwise correctly realized for the supplied and independently checked ASCII cases. The first syntactic ordinary/custom/prefixed/multiple absolute-URL marker wins; schemes beginning with an ASCII letter and continuing with ASCII letters, digits, `+`, `.`, or `-` terminate without a boundary requirement. Conventional Bearer values and authorization/cookie/password/secret/token assignments terminate at the earliest matching index. Exact Review G query/fragment, Review I adjacency, Review K escaped-outer/escaped-space, and Review M escaped-inner/multiple-scheme attacks pass through the direct, serializer, atomic-envelope, and lifecycle regressions. The previous URL/value reconstruction machinery is absent.

No-trigger strings remain unchanged in the focused tests, including ordinary assignment words without `:`/`=`, bare `Bearer`, relative paths, and Windows paths. The lifecycle test also preserves ordered structured evidence: schema/kind, sequence, timestamp, PID/platform/architecture, booleans, numeric details, and no-trigger context/detail strings. The accepted information-loss tradeoff remains explicit: once a recognized trigger is reached, all suffix prose is discarded. That tradeoff does not excuse this blocker because the trigger is never reached and the secret tail is retained.

## Validation and frozen-boundary check

All commands ran from the repository root.

- Focused sanitizer/persistence suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 9 tests**.
- Full fixture suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 27 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- Scanner syntax: `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS, exit 0**.
- Diff hygiene: `git diff --check` — **PASS, exit 0**.
- Independent conventional earliest-trigger/no-trigger matrix — **PASS, 15 cases** after using the decision's full syntactic-scheme semantics.
- Independent direct/serializer/atomic-envelope/lifecycle JSONL Unicode-prefix probe — **FAIL**, with the unchanged persisted markers listed above.

Vitest emitted only the existing Vite tsconfig-path and Oxc notices; they were not failures.

Targeted current-source and actual-diff inspection found no terminal-redaction edit to workflow orchestration, required assertion names or truth conditions, first-byte/cancellation/upload/64/128 MiB transfer checks, the 48 MiB per-process and 16 MiB non-linear RSS bounds, cleanup requirements, strict CSP or `bypassCSP`, the exact five enabled and four disabled scheme privileges, `session.defaultSession` handling or persistent-partition denial, BrowserWindow `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, or `webSecurity: true`, result contracts, packaging, authentication/ticket behavior, or production Desktop/Web/Server routing. The broader evidence-preservation diff still separates development and packaged hard gates, runs packaged and artifact upload under `if: always()`, retains hidden evidence, and does not weaken a runtime truth condition. Production routing remains unchanged.

The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remained untouched and outside this review.

## Final disposition

**Code/evidence-redaction verdict: FAIL.** Implementation N does not safely implement the finite terminal rule for arbitrary persisted strings because whole-string case conversion can change length before a trigger. The correction must avoid sharing indices between differently sized representations and add direct plus serializer/envelope/lifecycle regressions with length-changing ordinary text before Bearer and every assignment class. Green existing tests, typecheck, lint, syntax, and hygiene do not override the reproduced complete marker leakage.

**Runtime verdict: not run and not accepted.** Review O ran no Electron development gate, ASAR-packaged gate, Linux/Windows executable, hosted workflow, RSS/cancellation runtime proof, or result-artifact validation. There is explicitly no runtime PASS and no M0 acceptance. Prior runtime failures and the production-routing STOP remain in force.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** verdict, exact root cause, direct and persisted reproductions, passing semantics, structured-evidence tradeoff, commands/results, frozen scope, runtime status, and required correction are recorded here.
- [x] **Tradeoffs and uncertainties explicit:** accepted terminal information loss is separated from complete credential leakage; conventional ASCII success and the limits of local verification are explicit.
- [x] **Acceptance criteria addressed:** syntactic ordinary/custom/prefixed/multiple URL markers, Bearer, all five assignments, Review G/I/K/M escaped and multi-scheme attacks, earliest ordering, no-trigger preservation, structured evidence, direct serializer, atomic envelope, lifecycle JSONL, focused/full tests, typecheck, lint, syntax, diff hygiene, and frozen workflow/security/routing boundaries are dispositioned.
- [x] **No changes outside assigned scope:** this review changes no sanitizer, test, workflow, plan, assertion, threshold, CSP, session, privilege, BrowserWindow, package, routing, or forbidden Server source; it writes only this assigned Review O handoff.
- [x] **Human-review quality / honest and non-marketing:** every green check and closed prior attack is reported without allowing it to conceal the reproduced Unicode-index confidentiality failure; the FAIL is explicit, and no runtime PASS or M0 acceptance is claimed.
