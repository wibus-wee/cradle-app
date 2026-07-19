# Desktop scripts

- **rebuild-sparkle.mjs**: Rebuilds `electron-sparkle-updater` against the local Electron ABI on macOS (no-op elsewhere). Wired into `postinstall` / `build`.
- **run-update-smoke.mjs**: Serves a local Sparkle appcast + zip feed and optionally launches a packaged `.app` with `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` for manual Desktop settings smoke.
- **set-version.mjs**: Writes the desktop package version before release packaging.
- **build-mac-bridge.mjs**: Builds the Swift Mac Bridge binary for packaging.
- **fix-macos-framework-symlinks.mjs**: Rewrites absolute Electron framework symlinks after pack.
- **sync-codex-runtime.mjs**: Copies Codex runtime assets into packaged resources.
- **verify-macos-distribution-credentials.mjs**: Optional Developer ID credential checks.

## Sparkle update packaging notes

1. `pnpm --filter @cradle/desktop rebuild:sparkle` (automatic on darwin postinstall/build).
2. Package with `SPARKLE_ED_PUBLIC_KEY` and `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` / `CRADLE_DESKTOP_UPDATE_URL`.
3. `electron-builder` afterPack re-signs ad-hoc (`codesign --sign -`) so Sparkle `generate_appcast` can verify.
4. Release CI runs `electron-sparkle-updater generate-appcast` with `SPARKLE_ED_PRIVATE_KEY` and publishes `appcast.xml` + versioned mac zips. Windows still publishes `latest.yml` + NSIS setup.

