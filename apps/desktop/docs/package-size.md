# Desktop package size (target: DMG & ZIP &lt; 100MB)

## Current baseline (dev-20260718.1)

| Artifact | Size |
| --- | ---: |
| `Cradle.dmg` | ~393 MB |
| `Cradle-mac-arm64.zip` | ~360 MB |
| `Cradle-setup.exe` | ~337 MB |

Unpacked Electron 42 shell alone is ~273 MB on macOS arm64 before any Cradle code. The installer is therefore dominated by **vendor binaries**, not `Contents/Resources/*.lproj`.

## Where the megabytes go

Measured on a local desktop-runtime + packaged Windows dir / mac resources tree:

| Component | Raw size | Notes |
| --- | ---: | --- |
| `@anthropic-ai/claude-agent-sdk-*-` native `claude` CLI | **~230 MB** | optionalDependency platform package |
| Codex `codex-app-server` (packaged) / full `codex` CLI | **~207–248 MB** | copied in `afterPack` today |
| Electron Framework (mac) | **~273 MB** | Chromium + V8; ~47 MB is `*.lproj` |
| Windows `locales/*.pak` (55 files) | **~44 MB** | not pruned before this work |
| `@arcships/light-ocr` + ONNX + model | **~68 MB** | image OCR feature |
| `better-sqlite3` build/deps leftovers | **~25 MB** | prune was broken on hoisted layout |
| `app.asar` (renderer + main) | **~49 MB** | already asar'd |
| Server JS bundle | **~16 MB** | vite `dist` |
| Plugins (esp. slack-conversation-bridge deps) | **~28 MB** | production deploy of plugin deps |
| `ffmpeg` / swiftshader | **~3–20 MB** | optional for Cradle UI |

Compression (zlib-9 sample) only halves the big agent binaries (~0.4–0.5 ratio). So **even with maximum DMG/ZIP compression, embedding Claude + Codex makes &lt;100 MB impossible**.

### Math for &lt;100 MB

Approximate compressed contribution:

- Bare Electron after locale/ffmpeg strip: **~70–85 MB**
- Cradle app.asar + slim server natives (no agent CLIs, OCR optional): **~25–45 MB**
- Claude CLI alone: **~110 MB compressed**
- Codex app-server alone: **~100+ MB compressed**

⇒ **Required for &lt;100 MB:** do not ship Claude/Codex (and ideally OCR) inside the base installer. Deliver them via Download Center / first-use install, same pattern as ACP binary agents.

## What this branch implements

### Packaging hygiene (safe, always on)

1. **`electronLanguages`** + `afterPack` hard prune of unused mac `*.lproj` and Windows/Linux `locales/*.pak`.
2. **Optional Chromium libs removed** in afterPack: `libffmpeg` / `ffmpeg.dll`, swiftshader (no HTML5 media/Vulkan software path in core UI).
3. **`rebuild-electron-runtime.mjs` prune fixed for hoisted `node_modules`** (previously only looked under `.pnpm/.../node_modules/...` and left `better-sqlite3` build trees intact).
4. **Claude platform optionalDependencies stripped** from desktop-runtime by default; Anthropic SDK `src/` trees dropped.
5. **DMG compression**: installer `build-dmg.mjs` / `build-dmg.sh` prefer **ULMO (LZMA)**, fallback **UDZO zlib-level=9**. electron-builder `compression: 'maximum'` + zip maximum retained.

### Slim agent bundles (default)

- Env **`CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES`**:
  - unset / false → **slim** (default): skip Codex `afterPack` copy; strip Claude `claude-agent-sdk-*` packages from runtime + packaged app.
  - `1` / `true` → full offline Claude+Codex bundle (old behavior; ~350–400 MB installers).

Until Download Center wiring lands for Claude/Codex first-run install, slim packages **will not run Claude Agent / Codex sessions offline**. Product follow-up is required (see below).

## Expected size after this PR (order of magnitude)

| Scenario | Expected DMG/ZIP |
| --- | ---: |
| Hygiene only (still bundle agents) | ~300–340 MB |
| Slim (no Claude/Codex) + hygiene + ULMO | **~90–160 MB** (depends on OCR/sharp/jieba still embedded) |
| Slim + OCR on-demand + aggressive asar | **toward &lt;100 MB** (realistic goal) |

Hitting a reliable **&lt;100 MB on both DMG and ZIP** needs the OCR/model optional path and a measured CI size gate, not more locale trimming.

## Product follow-ups (not in this PR)

1. **On-demand Claude CLI** – resolve binary via Download Center into app data; keep only `@anthropic-ai/claude-agent-sdk` JS loaders in the base package.
2. **On-demand Codex app-server** – same; `sync-codex-runtime` already knows how to download releases; gate install on first Codex session.
3. **Optional OCR** – ship `@arcships/light-ocr` + model as a managed resource (~68 MB raw).
4. **CI size budget** – fail release if `Cradle.dmg` / `Cradle-mac-arm64.zip` exceed 100 MB when `CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES` is unset.
5. **Plugin dep audit** – `slack-conversation-bridge` alone is ~26 MB of `node_modules`; consider shared runtime deps or thinner deploys.

## Commands

```bash
# Slim package (default) — measure dir then zip/dmg
pnpm --filter @cradle/desktop pack
du -sh apps/desktop/release/mac-arm64/Cradle.app
ditto -c -k --sequesterRsrc --keepParent \
  apps/desktop/release/mac-arm64/Cradle.app /tmp/Cradle-slim.zip
ls -lh /tmp/Cradle-slim.zip

# Full offline agents (old size)
CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES=1 pnpm --filter @cradle/desktop dist:mac

# Installer DMG with max compression
node installer/build-dmg.mjs --app apps/desktop/release/mac-arm64/Cradle.app
```

## References

- electron-builder `compression`, `electronLanguages`, `afterPack`
- hdiutil formats: ULMO (LZMA) &gt; UDZO zlib-9 for download size
- Industry empty Electron shell ≈ 80 MB compressed after locale strip
