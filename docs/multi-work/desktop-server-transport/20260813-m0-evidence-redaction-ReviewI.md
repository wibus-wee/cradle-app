# Review I: M0 evidence-redaction re-review

**Task:** Re-review Review G's diagnostic-confidentiality blocker after Fix H and reconfirm the evidence-preservation node

**Review date:** 2026-08-13

**Verdict:** **FAIL.** Fix H closes the originally demonstrated ordinary embedded-URL case, but it does not sanitize every persistable arbitrary string. Independently reproduced URL-boundary and quoted-secret inputs survive `serializeDiagnosticError`, nested diagnostic-envelope serialization, and lifecycle checkpoint/context/detail persistence. This is a local code/evidence review only. It is **not** a development runtime PASS, packaged runtime PASS, Linux or Windows runtime PASS, or M0 acceptance. The known runtime failures and production-routing STOP remain unchanged.

## Scope and evidence boundary

I reviewed the living ExecPlan, Review G, Fix H, the current worktree and actual diff, the diagnostic-envelope and lifecycle implementation/tests, the M0 Main persistence call sites, and the three affected workflows. I made no implementation, test, workflow, plan, assertion, routing, or package change. The only file written by this review is this Review I handoff.

This review attacked every new arbitrary-string persistence boundary: `serializeDiagnosticError`; recursively nested envelope strings; lifecycle `checkpoint`; lifecycle context `mode`, `resultPath`, and `artifactPath`; and lifecycle string `details`. It also checked multiple absolute URLs, query/fragment, URL userinfo, encoded and special values, trailing punctuation, ordinary prose/relative and Windows paths, and the existing bearer/token/cookie/password/secret rules.

## Blocking findings

### 1. A word-character prefix bypasses absolute-URL sanitization

`diagnostic-envelope.mjs` begins `ABSOLUTE_URL` with `\b`. Because underscore and the first scheme letter are both JavaScript word characters, an absolute URL embedded immediately after `_` is not matched:

```text
input:  _https://absolute.test/p?alpha=LEAK_QUERY#LEAK_HASH
output: _https://absolute.test/p?alpha=LEAK_QUERY#LEAK_HASH
```

The complete query and fragment were then observed unchanged in all applicable persistence boundaries:

- nested array/object strings written by `writeDiagnosticEnvelope`;
- lifecycle `checkpoint`;
- lifecycle context `mode` and string paths;
- lifecycle string `details`.

This is an embedded hierarchical absolute URL and violates the requirement that every persistable arbitrary string remove URL userinfo/query/fragment. Existing tests exercise URLs after spaces or punctuation and do not cover a word-character adjacency boundary.

### 2. Quote characters can terminate the regex before the URL's sensitive suffix

`ABSOLUTE_URL` excludes both `'` and `"`. WHATWG `URL` accepts those characters inside a query and percent-encodes them, but the sanitizer treats them as candidate terminators. It sanitizes only the prefix and leaves the remainder, including fragment text, in the persisted string:

```text
input:  https://absolute.test/p?alpha=safe'LEAK_QUERY_TAIL#LEAK_HASH
output: https://absolute.test/p'LEAK_QUERY_TAIL#LEAK_HASH

input:  https://absolute.test/p?alpha=safe"LEAK_QUERY_TAIL#LEAK_HASH
output: https://absolute.test/p"LEAK_QUERY_TAIL#LEAK_HASH
```

For comparison, Node's WHATWG parser accepts these full values as URLs and serializes the quote as `%27` or `%22`. The leak was reproduced through a real `Error.message` passed to `serializeDiagnosticError`, a nested envelope value, and lifecycle checkpoint/context/details. Thus Fix H's use of the standard parser does not protect inputs that its preceding regex truncates.

### 3. Quoted secret values containing spaces are only partially redacted

The credential regexes stop at whitespace. The leading segment is replaced, but the remaining secret value persists:

```text
token="LEAK_TOKEN_HEAD LEAK_TOKEN_TAIL"
=> token=[REDACTED] LEAK_TOKEN_TAIL"

Authorization: Bearer "LEAK_BEARER_HEAD LEAK_BEARER_TAIL"
=> Authorization=[REDACTED] [REDACTED] LEAK_BEARER_TAIL"
```

The same partial redaction was reproduced for quoted `cookie`, `password`, and `secret` assignments, and the tails were written by both nested-envelope and lifecycle persistence. Existing simple unquoted bearer/token/cookie/password/secret coverage still passes, but it is insufficient for arbitrary diagnostic strings and special values.

These are confidentiality failures at the persistence boundary. They are not ordinary-text corruption: the independent probe also confirmed that a queryless absolute URL, non-URL prose, `/relative?q=keep`, and `C:\\x?keep` remain unchanged; multiple conventional HTTPS/custom-scheme/IPv6/userinfo URLs and trailing `),.;:]}` punctuation sanitize as intended.

## Evidence-preservation and frozen-boundary recheck

The evidence-preservation node shows no new regression outside the sanitizer failure:

- The current CI workflow still runs development and packaged gates as independent hard steps, runs packaged with `if: always()`, and always uploads hidden evidence with missing evidence treated as an error. The Windows verification/release workflows retain hidden-file upload behavior. Fix H's stated four-file scope does not include a workflow, and the current workflow diffs are the previously reviewed evidence-preservation changes.
- Runner envelope, explicit missing-result/lifecycle failures, bounded Windows process inventory, atomic result/envelope writes, lifecycle ordering, and fatal nonzero exits remain present. Focused tests for these properties pass.
- Targeted actual-diff inspection is clean for `result-contract.mjs`, `result-schema.ts`, `proxy-handler.ts`, renderer/preload sources, fixture build/package configuration, production Desktop/Web/Server routing, and auth paths. No behavior assertion, cancellation requirement, memory threshold, strict CSP or `bypassCSP` condition, scheme privilege, default-session/partition truth condition, BrowserWindow security preference, or production routing changed in Fix H.
- The Main evidence-only diff still records the existing BrowserWindow values (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`) rather than changing them; protocol registration remains synchronously before readiness.

Therefore the re-review failure is confined to diagnostic confidentiality. It does not identify a new workflow or M0 behavior-contract regression, and it does not relax any prior runtime failure.

## Verification performed

All commands ran from the repository root.

- Full focused fixture tests: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 25 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS**.
- Diff hygiene: `git diff --check` — **PASS**.
- Targeted frozen behavior-contract/production-routing diff check — **clean**.
- Direct sanitizer probes for conventional multiple URLs, HTTPS/custom scheme, IPv6, URL userinfo, query/hash, encoded/special values, and trailing punctuation — **PASS for covered conventional shapes**.
- Direct probes for word-character-adjacent absolute URLs, quote-containing absolute-URL query values, and quoted whitespace-containing bearer/token/cookie/password/secret values — **FAIL**, as reproduced above.
- Actual persistence probes through `serializeDiagnosticError`, nested `writeDiagnosticEnvelope`, and lifecycle checkpoint/context/details — **FAIL**, leaked markers remained in the written JSON/JSONL.

The focused suite's green result does not override the missing adversarial cases. No bundle rerun was needed because Review G had already passed the isolated build and Fix H did not touch build code.

## Final disposition

**Code/evidence-redaction verdict: FAIL.** Fix H does not completely resolve Review G's blocker. Rework the sanitizer so matching is independent of a `\b` boundary, URL extraction cannot leave accepted query/fragment suffixes behind at quote boundaries, and quoted credential values cannot persist secret tails; then add persistence-level regression tests for each shape and re-review.

**Runtime verdict: not run and not accepted.** This review makes no runtime PASS claim. The prior Linux behavior failures and Windows missing-result failure remain blocking until later evidence-preserved executions establish otherwise. Production transport migration remains unauthorized.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** scope, verdict, exact persisted reproductions, unaffected boundaries, commands/results, runtime status, and required next action are contained here.
- [x] **Tradeoffs and uncertainties explicit:** useful queryless URL locations and ordinary text preservation are distinguished from confidentiality failures; local verification is separated from unrun Electron/hosted/Windows behavior.
- [x] **Acceptance criteria addressed:** every requested string persistence surface, multiple URL forms, query/hash/userinfo, encoded/special values, trailing punctuation, ordinary text, credential classes, workflows, frozen behavior/security boundaries, focused tests, typecheck, lint, and diff hygiene are dispositioned.
- [x] **No implementation details leaked outside assigned scope:** this review changes no implementation, workflow, test, plan, production source, assertion, or unrelated file and writes only this assigned Review I report.
- [x] **Human-review quality, honest/thorough/no marketing:** the report gives a reproducible FAIL despite green existing tests, reports unchanged boundaries separately, and makes no runtime PASS or M0 acceptance claim.
