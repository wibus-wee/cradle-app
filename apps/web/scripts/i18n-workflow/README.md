<!-- Once this directory changes, update this README.md -->

# i18n Workflow

`scripts/i18n-workflow` owns the local and CI commands that keep Cradle web translation resources aligned with `src/locales/default`. Commands run from the `apps/web` package through `pnpm --filter @cradle/web ...`.

## Commands

- **index.ts**: Runs the standard authoring workflow: diff invalidation before default baseline regeneration.
- **gen-diff.ts**: Compares the current `en-US` baseline with the TypeScript default source and removes stale non-default translations when default English values changed.
- **gen-default-locale-json.ts**: Regenerates `src/locales/en-US/*.json` from `src/locales/default/*.ts`; `--check` compares generated content with the current baseline without writing files.
- **check-translations.ts**: Validates locale namespace parity, missing keys, extra keys, string-only entries, placeholders, `<Trans>`-style tags, and plural families.
- **check-hardcoded-text.ts**: Scans React TSX surfaces for hardcoded user-facing copy in JSX text, `aria-label`, `title`, and `placeholder` literals.
- **init-locale.ts**: Creates missing namespace JSON files for an existing supported locale.
- **analyze-unused-keys.ts**: Reports default source keys that are not referenced by TypeScript or TSX consumers.
- **clean-unused-keys.ts**: Removes keys listed by the unused-key report from non-default locale JSON when explicitly applied.
- **config.ts**, **protected-patterns.ts**, and **utils.ts**: Shared workflow configuration, dynamic-key protection, filesystem access, and validation helpers.

## Report Policy

The workflow writes timestamped reports to `apps/web/i18n-*.json`. These files are review artifacts, not source artifacts, and are ignored by Git to avoid timestamp churn. Regenerate them for translation handoffs or CI logs when needed.

## CI Gate

Use `pnpm --filter @cradle/web i18n:ci` for the full gate. It checks that `src/locales/en-US` matches the generated default baseline, validates all locale JSON, and runs the hardcoded-text scan.
