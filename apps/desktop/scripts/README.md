# Desktop scripts

- **rebuild-sparkle.mjs**: Rebuilds `electron-sparkle-updater` against the local Electron ABI on macOS (no-op elsewhere). Wired into `postinstall` / `build`.
- **run-update-smoke.mjs**: Serves a local Sparkle appcast + zip feed and optionally launches a packaged `.app` with `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` for manual Desktop settings smoke. `--build-version` controls Sparkle's numeric comparison version independently from the human-readable `--version`.
- **set-version.mjs**: Writes the desktop package version before release packaging.
- **generate-linux-update-manifest.mjs**: Creates `latest-linux.yml` from the packaged Linux artifacts when the release pipeline uses `electron-builder --publish never`.
- **verify-linux-release.mjs**: Verifies the Linux updater manifest and artifact SHA-512 digests.
- **build-mac-bridge.mjs**: Builds the Swift Mac Bridge binary for packaging.
- **fix-macos-framework-symlinks.mjs**: Rewrites absolute Electron framework symlinks after pack.
- **fetch-sparkle-delta-bases.py**: Release CI helper; selects prior channel releases (prereleases included) and downloads their mac zips + appcast history as Sparkle delta bases. See packaging notes below.
- **sync-codex-runtime.mjs**: Copies Codex runtime assets into packaged resources.
- **generate-tray-icon.mjs**: Builds macOS menubar Template PNGs (`resources/tray/trayTemplate.png` + `@2x`) from `resources/icon.png`. Re-run after brand icon changes: `pnpm --filter @cradle/desktop generate:tray-icon`.
- **verify-macos-distribution-credentials.mjs**: Optional Developer ID credential checks.

## Sparkle update packaging notes

1. `pnpm --filter @cradle/desktop rebuild:sparkle` (automatic on darwin postinstall/build).
2. Package with `SPARKLE_ED_PUBLIC_KEY` and `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` / `CRADLE_DESKTOP_UPDATE_URL`.
3. `electron-builder` afterPack re-signs ad-hoc (`codesign --sign -`) so Sparkle `generate_appcast` can verify.
4. Release CI sets `CRADLE_DESKTOP_SPARKLE_BUNDLE_VERSION` to the increasing workflow run number and `CRADLE_DESKTOP_SPARKLE_DISPLAY_VERSION` to the channel's display version. These become `CFBundleVersion` / `sparkle:version` and `CFBundleShortVersionString` / `sparkle:shortVersionString`, respectively.
5. Release CI generates the appcast on the macOS runner with the package-vendored Sparkle tools — not the upstream composite action, whose delta-base selection excludes prereleases (every dev/bleeding-edge feed release is one) and whose archive-suffix derivation degenerates on multi-platform releases:
   - `fetch-sparkle-delta-bases.py` downloads the newest prior channel releases' mac zips as delta bases plus bounded `appcast.xml` history snapshots into `release/sparkle-archive/history/`. bleeding-edge resolves bases from the rolling `feed-bleeding-edge` release itself, since no versioned bleeding-edge releases exist.
   - The newest history appcast is copied into the archive dir before generation: `generate_appcast` only produces `*.delta` against versions it finds in an existing appcast. The workflow then runs `generate_appcast --maximum-versions 1 --maximum-deltas 2`, merges bounded history with the vendored `appcast-history.py`, and re-signs the merged feed with `sign_update`; the EdDSA private key only ever exists on a RAM disk. Note deltas are only generated for base archives whose embedded `SUPublicEDKey` matches the signing key.
   - `download-url-prefix` is the channel's own asset location (versioned `dev-*`/`v*` release for dev/release, the rolling feed release for bleeding-edge), so merged historical enclosure URLs are correct verbatim and the library's `fix-appcast` re-pointing is never needed.
   - Cradle then promotes only `appcast.xml` + this release's `*.delta` into `apps/desktop/release/` for artifact upload. Prior-release base zips stay in `sparkle-archive/` and are not re-uploaded.
   - The publish job updates rolling feeds non-destructively: overwrite in place, upload `appcast.xml` last, delete only assets the new appcast no longer references (superseded full zips, out-of-window deltas).
   - Windows still publishes `latest.yml` + NSIS setup via the multi-platform publish job.
