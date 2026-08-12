# Review Q: M0 original-index ASCII terminal-redaction re-review

**Task:** Independently and adversarially re-review Fix P after Review O's length-changing Unicode index bypass

**Review date:** 2026-08-13

**Verdict:** **PASS.** Fix P removes the differently sized lowercased copy and performs ASCII case-insensitive Bearer and assignment comparisons directly against the original diagnostic string at original-string indices. The U+0130 prefix bypass is closed for Bearer and all five authorization/cookie/password/secret/token assignments through the direct sanitizer, every error-serializer string branch, atomic diagnostic-envelope JSON, and lifecycle JSONL. Mixed-case, string-end/out-of-bounds, earliest-trigger, URL-marker, no-trigger, structured-evidence, and Review G/I/K/M cases also pass. This is a local code/evidence-redaction verdict only. It is **not** a development, packaged, Linux, Windows, or hosted-workflow runtime PASS; it does not accept M0 or authorize production routing.

## Scope and method

I read the living ExecPlan, Review O, Fix P, Implementation N, Reviews G/I/K/M, the current `diagnostic-envelope*` and `lifecycle-diagnostics*` source and tests, and the complete shared-worktree status/diff. I inspected the evidence-preservation workflow, runner, Main, assertion/contract, CSP, session, scheme-privilege, BrowserWindow, and production-routing boundaries. I ran the focused and full fixture suites, Desktop Node typecheck, fixture lint, scanner syntax check, diff hygiene, and an independent real-boundary probe. The probe used its own operating-system temporary directory and removed it. I made no implementation, test, workflow, plan, assertion, threshold, security, routing, package, or forbidden Server-file change; the only file written by this review is this handoff.

## Implementation finding

`startsAsciiCaseInsensitive` in `apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` compares each expected lowercase ASCII code with the lower- or uppercase ASCII code at the same index in the original value. `startsBearerValue` and `startsSecretAssignment` use that helper directly, and `redactDiagnosticText` scans only the original string. There is no `toLowerCase()` copy and therefore no index sharing between representations whose UTF-16 lengths can differ. A missing character yields `NaN` from `charCodeAt`, fails both comparisons, and cannot produce an out-of-bounds false positive.

The matcher retains the finite decision exactly. Bearer is whole-word ASCII case-insensitive, must be followed by whitespace and at least one later character, and assignments are whole-word ASCII case-insensitive for exactly authorization, cookie, password, secret, and token followed by optional whitespace and `:` or `=`. Assignment values are deliberately not parsed, including blank values. Absolute URLs remain syntactic markers: an ASCII letter followed by ASCII letters, digits, `+`, `.`, or `-`, then `://`, with no preceding-boundary requirement. The first matching index wins and the entire suffix becomes one fixed `[REDACTED]` marker.

## Adversarial evidence

The independent direct matrix passed **33/33 cases**. It covered U+0130 before mixed-case Bearer and all five mixed-case assignments; `Authorization: Bearer`; an assignment before a later URL and a URL before a later assignment; uppercase, prefixed, word-adjacent, underscore-adjacent, custom, and invalid URL spellings; truncated `b`/`beare` and assignment prefixes; bare Bearer and whitespace-only Bearer at string end; whole-word exclusions; blank assignments at string end; relative and Windows paths; and the Review M escaped-inner/multiple-scheme forms. Exact outputs proved the retained original prefix plus `[REDACTED]`, not merely marker absence.

The same independent probe passed all **six trigger classes** at every material persistence boundary after ordinary `İ` text:

- `serializeDiagnosticError` redacted `Error.name`, `Error.message`, string `Error.code`, and the non-Error message branch for mixed-case Bearer and every mixed-case assignment.
- `writeDiagnosticEnvelope` atomically persisted all six classes as the exact safe prefix plus marker and retained no `PERSIST_*_LEAK` suffix. Schema version, boolean, number, null, and a no-trigger relative path remained unchanged.
- `createM0LifecycleRecorder` persisted all six classes safely in checkpoint, context `mode`, `resultPath`, `artifactPath`, and string-valued details. It retained schema/kind, sequence, timestamp, PID, platform, architecture, boolean, numeric, null, and no-trigger structured evidence.

The repository regressions additionally close the exact Review G query/fragment case, Review I prefix/adjacency and quoted-value cases, Review K escaped-outer/escaped-space and quote/space URL cases, and Review M escaped-inner and multiple-scheme cases through direct, serializer, atomic-envelope, and lifecycle paths. No URL/value reconstruction or suffix recovery machinery remains.

No-trigger preservation also passes: ordinary assignment words without `:`/`=`, bare or whitespace-only Bearer, relative paths, Windows paths, incomplete `://` text, truncated trigger names, and word/underscore-embedded credential names remain unchanged. The intentional information-loss tradeoff remains explicit: after any recognized trigger, all later diagnostic prose is discarded. Structured fields preserve the evidence needed to locate failures without reopening an arbitrary-string confidentiality parser.

## Validation and frozen-boundary check

All commands ran from the repository root.

- Focused sanitizer/persistence suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.test.ts apps/desktop/src/main/desktop-server-transport/fixtures/m0/lifecycle-diagnostics.test.ts --maxWorkers=1` — **PASS, 2 files / 13 tests**.
- Full fixture suite: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 31 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS, exit 0 with no diagnostics**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS, exit 0 with no warnings**.
- Scanner syntax: `node --check apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs` — **PASS, exit 0**.
- Diff hygiene: `git diff --check` — **PASS, exit 0**.
- Independent original-index/direct/persistence probe — **PASS: 33 direct cases, 6 serializer trigger classes, 6 atomic-envelope trigger classes, and 6 lifecycle trigger classes**.

Vitest emitted only the existing Vite tsconfig-path and Oxc notices; neither was a failure.

Current-source and actual-diff inspection found no Fix P change to workflow orchestration; required assertion names or truth conditions; first-byte, cancellation, upload, 64/128 MiB transfer, cleanup, 48 MiB per-process, or 16 MiB non-linear RSS requirements; strict CSP or `bypassCSP`; the exact five enabled and four disabled scheme privileges; `session.defaultSession` handling or persistent-partition denial; BrowserWindow `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, or `webSecurity: true`; result contracts; packaging; authentication/ticket behavior; or production Desktop/Web/Server routing. The broader evidence-preservation diff still runs development and packaged gates independently, runs packaged and artifact upload under `if: always()`, retains hidden evidence, and does not weaken a runtime truth condition. Production routing remains unchanged.

The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remained untouched and outside this review.

## Final disposition

**Code/evidence-redaction verdict: PASS.** Fix P safely closes Review O's length-changing case-conversion/index bypass while preserving the finite Main-owned terminal rule and the behavior already established against Reviews G/I/K/M. No Architecture Escalation is required for this correction.

**Runtime verdict: not run and not accepted.** Review Q ran no Electron development gate, ASAR-packaged gate, Linux/Windows executable, hosted workflow, RSS/cancellation runtime proof, or result-artifact validation. There is explicitly **no runtime PASS and no M0 acceptance**. Prior runtime failures and the production-routing STOP remain in force.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** verdict, implementation reasoning, direct and persisted adversarial evidence, no-trigger and structured-evidence behavior, commands/results, frozen scope, and runtime status are recorded here.
- [x] **Tradeoffs and uncertainties explicit:** accepted terminal information loss is explicit; local code/persistence confidence is separated from unrun Electron, platform, and hosted-workflow runtime proof.
- [x] **Acceptance criteria addressed:** original-index ASCII matching after length-changing Unicode, uppercase/mixed case, string-end/out-of-bounds behavior, earliest ordering, URL semantics, Bearer, all five assignments, Review G/I/K/M attacks, direct serializer, atomic envelope, lifecycle JSONL, no-trigger preservation, structured evidence, focused/full tests, typecheck, lint, syntax, diff hygiene, and frozen workflow/security/routing boundaries are dispositioned.
- [x] **No changes outside assigned scope:** this review changes no sanitizer, test, workflow, plan, assertion, threshold, CSP, session, privilege, BrowserWindow, package, routing, or forbidden Server source; it writes only this assigned Review Q handoff.
- [x] **Human-review quality / honest and non-marketing:** the PASS is limited to the reviewed code/evidence-redaction correction, all local evidence and information-loss costs are explicit, and no runtime PASS or M0 acceptance is claimed.
