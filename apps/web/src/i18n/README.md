<!-- Once this directory changes, update this README.md -->

# i18n

`src/i18n` owns Cradle web locale semantics, runtime initialization, and React integration. It reads browser-owned hints such as `?hl=`, cookies, and `navigator.languages`, then normalizes them into the supported locale model before any React UI renders.

## Files

- **browser-locale.ts**: Vite SPA locale bootstrap helper. Resolves query, cookie, and browser preferences, writes the locale cookie, and keeps `document.documentElement.lang` / `dir` aligned.
- **client.tsx**: Provider-scoped i18next instance plus `useI18n()` language switching contract. React UI should use `useTranslation`, `<Trans>`, or this hook instead of importing locale JSON.
- **i18next.d.ts**: i18next module augmentation wired to `src/locales/default`.
- **locales.ts**: Stable public re-export for locale primitives and options.
- **options.ts**: Language selector option metadata.
- **resources.ts**: Supported locale list, normalization, `Accept-Language` parsing, browser language resolution, and RTL detection.
- **server-instance.ts**: Request-independent i18next factory for non-React callers and tests.
- **settings.ts**: Shared i18next initialization options.

## Workflow

- `pnpm --filter @cradle/web i18n:gen-default`: regenerates the default `en-US` JSON baseline from `src/locales/default`.
- `pnpm --filter @cradle/web i18n:check-baseline`: regenerates the `en-US` baseline and fails when generated files differ from the committed baseline.
- `pnpm --filter @cradle/web i18n:check`: validates namespace/key parity, placeholder parity, tag parity, plural families, and string-only locale entries.
- `pnpm --filter @cradle/web i18n:check-hardcoded`: scans React TSX for hardcoded user-facing text that should be moved into a namespace.
- `pnpm --filter @cradle/web i18n:ci`: runs baseline drift, locale parity, and hardcoded-text gates in CI order.

Timestamped files such as `apps/web/i18n-missing-report.json` are generated review artifacts. They are ignored by Git and should be regenerated for CI logs or translation handoffs instead of committed.
