# Architecture Hygiene Scans

Run the default AST cleanup scan from the repository root:

```sh
ast-grep scan apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Current baseline results and review notes are recorded in `wrapper-compatibility-report.md`.

Use the unified function-smell scan script when reviewing wrapper/facade cleanup:

```sh
ast-grep/scripts/scan-function-smells.sh all
ast-grep/scripts/scan-function-smells.sh broad --count
ast-grep/scripts/scan-function-smells.sh broad --path apps/web/src/navigation/active-surface.ts
```

Script modes:

- `default`: strict cleanup rules from `sgconfig.yml`.
- `audit`: narrower facade audit rules from `ast-grep/audit-sgconfig.yml`.
- `broad`: broad single-return function facade rules from `ast-grep/broad-audit-sgconfig.yml`.
- `all`: default, audit, and broad in that order.

Default cleanup rule intent:

- `compatibility-comment-marker`: comments that explicitly mention legacy/deprecated compatibility debt.
- `generated-api-call-wrapper`: functions that only wrap generated HTTP SDK calls.
- `formatter-delegation-wrapper`: `format/read/to/as/normalize/map*` helpers that only call another helper.
- `formatter-delegation-wrapper-tsx`: TSX version of formatter delegation detection.
- `nullable-display-fallback-formatter`: nullable helpers that hide null behind display fallback strings.
- `nullable-display-fallback-formatter-tsx`: TSX version of nullable fallback detection.
- `local-intl-number-formatter`: local helpers that only instantiate `Intl.NumberFormat`.
- `local-intl-number-formatter-tsx`: TSX version of local `Intl.NumberFormat` detection.
- `local-number-formatter`: local helpers that only switch between `String(...)` and `toFixed(...)`.
- `local-number-formatter-tsx`: TSX version of local number formatter detection.
- `local-duration-offset-formatter`: local helpers that hand-roll `mm:ss`-style duration offsets.
- `local-duration-offset-formatter-tsx`: TSX version of local duration offset formatter detection.
- `local-clamp-helper`: local helpers that hand-roll generic bounded numeric clamp logic.
- `local-clamp-helper-tsx`: TSX version of local clamp helper detection.
- `threshold-unit-formatter`: local number helpers that branch on thresholds to append units.
- `threshold-unit-formatter-tsx`: TSX version of threshold/unit formatter detection.

## Language-Agnostic Text Scan

`ast-grep scan` is for parser-backed structural patterns. Header-style comments like `Output:`, `Input:`, and `Position:` appeared across TypeScript, Markdown, shell, YAML, HTML, and other text files, so the authoritative all-language sweep checks file-leading ownership triplets:

```sh
ast-grep/scripts/scan-ownership-headers.sh
```

Useful baseline commands:

```sh
ast-grep/scripts/test-ownership-header-rule.sh
ast-grep/scripts/scan-ownership-headers.sh | wc -l
ast-grep/scripts/scan-ownership-headers.sh | cut -d: -f1 | sort -u | wc -l
ast-grep/scripts/scan-ownership-headers.sh | cut -d: -f1 | sort -u | awk '{ n=split($0, parts, "."); ext=(n>1 ? parts[n] : "[no-ext]"); count[ext]++ } END { for (ext in count) print count[ext], ext }' | sort -nr
```

This scan intentionally does not depend on language parser support. It reports only a leading three-line ownership header, including shebang-adjacent comments and `/** ... */` block headers, so docs, examples, tests, and report bodies can still mention `Output:`, `Input:`, or `Position:` without becoming cleanup findings.

## Optional Facade Audit

Run optional facade audits when reviewing ownership boundaries. These rules include many legitimate feature-owned wrappers, so they are not loaded by `sgconfig.yml`:

```sh
ast-grep scan -c ast-grep/audit-sgconfig.yml apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Audit rule intent:

- `generated-query-wrapper`: feature-owned `use*` hooks over `useQuery(...)`.
- `generated-query-wrapper-tsx`: TSX-local `use*` hooks over `useQuery(...)`.
- `lazy-component-loader-wrapper`: route/tab loader facades.
- `preload-only-wrapper`: route/tab preload facades.
- `service-pass-through-wrapper`: broad low-semantics pass-through functions.

For a broader lexical sweep, run this separately because it includes legitimate strings such as `openai-compatible`:

```sh
ast-grep scan apps packages plugins \
  --inline-rules $'id: compatibility-string-marker\nlanguage: TypeScript\nrule:\n  any:\n    - kind: string_fragment\n    - kind: template_string\n  regex: (?i)(deprecated|deprecation|backwards?-compat(?:ible|ibility)|backwards?\\s+compatibility|compatibility\\s+(re-export|export|shim|path|wrapper)|compat(?:ible)?\\s+(shim|path|wrapper)|old\\s+(helper|path|api|surface|entry|wrapper|di\\s+consumers)|transitional)\nseverity: hint\nmessage: Compatibility marker in string.' \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```
