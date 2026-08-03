# Desktop scripts

- **rebuild-sparkle.mjs**: Rebuilds `electron-sparkle-updater` against the local Electron ABI on macOS (no-op elsewhere). Wired into `postinstall` / `build`.
- **run-update-smoke.mjs**: Serves a local Sparkle appcast + zip feed and optionally launches a packaged `.app` with `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` for manual Desktop settings smoke. `--build-version` controls Sparkle's numeric comparison version independently from the human-readable `--version`.
- **set-version.mjs**: Writes the desktop package version before release packaging.
- **build-mac-bridge.mjs**: Builds the Swift Mac Bridge binary for packaging.
- **fix-macos-framework-symlinks.mjs**: Rewrites absolute Electron framework symlinks after pack.
- **sync-codex-runtime.mjs**: Copies Codex runtime assets into packaged resources.
- **generate-tray-icon.mjs**: Builds macOS menubar Template PNGs (`resources/tray/trayTemplate.png` + `@2x`) from `resources/icon.png`. Re-run after brand icon changes: `pnpm --filter @cradle/desktop generate:tray-icon`.
- **verify-macos-distribution-credentials.mjs**: Optional Developer ID credential checks.

## Sparkle update packaging notes

1. `pnpm --filter @cradle/desktop rebuild:sparkle` (automatic on darwin postinstall/build).
2. Package with `SPARKLE_ED_PUBLIC_KEY` and `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` / `CRADLE_DESKTOP_UPDATE_URL`.
3. `electron-builder` afterPack re-signs ad-hoc (`codesign --sign -`) so Sparkle `generate_appcast` can verify.
4. Release CI sets `CRADLE_DESKTOP_SPARKLE_BUNDLE_VERSION` to the increasing workflow run number and `CRADLE_DESKTOP_SPARKLE_DISPLAY_VERSION` to the channel's display version. These become `CFBundleVersion` / `sparkle:version` and `CFBundleShortVersionString` / `sparkle:shortVersionString`, respectively.
5. Release CI uses the official composite action `Innei/electron-sparkle-updater/action@v1` on the macOS runner:
   - Inputs: versioned zip archive dir, `SPARKLE_ED_PRIVATE_KEY`, channel `tag-prefix`, `fetch-delta-bases: true`, `delta-bases: 2`, `publish: false`.
   - The action downloads the last N matching-channel release zips as delta bases, runs `generate_appcast`, and `fix-appcast`s enclosure URLs.
   - Cradle then promotes only `appcast.xml` + this release's `*.delta` into `apps/desktop/release/` for artifact upload. Prior-release base zips stay in `sparkle-archive/` and are not re-uploaded.
   - Windows still publishes `latest.yml` + NSIS setup via the multi-platform publish job.
