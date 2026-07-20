# Desktop scripts

- **rebuild-sparkle.mjs**: Rebuilds `electron-sparkle-updater` against the local Electron ABI on macOS (no-op elsewhere). Wired into `postinstall` / `build`.
- **run-update-smoke.mjs**: Serves a local Sparkle appcast + zip feed and optionally launches a packaged `.app` with `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` for manual Desktop settings smoke.
- **set-version.mjs**: Writes the desktop package version before release packaging.
- **build-mac-bridge.mjs**: Builds the Swift Mac Bridge binary for packaging.
- **fix-macos-framework-symlinks.mjs**: Rewrites absolute Electron framework symlinks after pack.
- **sync-codex-runtime.mjs**: Copies Codex runtime assets into packaged resources (skipped unless `CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES=1`).
- **prune-packaged-app.mjs**: afterPack size prune — Chromium locales/lproj, optional ffmpeg/swiftshader, slim Claude/Codex agent binaries. See `docs/package-size.md`.
- **verify-macos-distribution-credentials.mjs**: Optional Developer ID credential checks.

## Sparkle update packaging notes

1. `pnpm --filter @cradle/desktop rebuild:sparkle` (automatic on darwin postinstall/build).
2. Package with `SPARKLE_ED_PUBLIC_KEY` and `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` / `CRADLE_DESKTOP_UPDATE_URL`.
3. `electron-builder` afterPack re-signs ad-hoc (`codesign --sign -`) so Sparkle `generate_appcast` can verify.
4. Release CI uses the official composite action `Innei/electron-sparkle-updater/action@v1` on the macOS runner:
   - Inputs: versioned zip archive dir, `SPARKLE_ED_PRIVATE_KEY`, channel `tag-prefix`, `fetch-delta-bases: true`, `delta-bases: 2`, `publish: false`.
   - The action downloads the last N matching-channel release zips as delta bases, runs `generate_appcast`, and `fix-appcast`s enclosure URLs.
   - Cradle then promotes only `appcast.xml` + this release's `*.delta` into `apps/desktop/release/` for artifact upload. Prior-release base zips stay in `sparkle-archive/` and are not re-uploaded.
   - Windows still publishes `latest.yml` + NSIS setup via the multi-platform publish job.
