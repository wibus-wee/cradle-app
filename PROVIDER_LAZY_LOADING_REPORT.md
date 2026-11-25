# M1.2 Provider Lazy Loading — Implementation Report

## Branch
`perf/provider-lazy-loading` — pushed.

## RSS measurements (median of 3-5 runs, compile cache enabled)
| | baseline | after | delta |
|---|---|---|---|
| listenAtMs | 591ms | 545ms | -46ms |
| rssBoot2s | 281MB | 284MB | +3MB (noise) |
| rssIdle10s | 397MB | 377MB | -20MB |
| totalTree | 397MB | 377MB | -20MB |

Small win, not the projected 100-150MB. Explanation below.

## Chunk layout changes
- `runtime-snapshot` mega-chunk: **6.42MB → 2.75MB** (-57%)
- Provider implementation chunks now properly isolated as separate lazy chunks:
  - `provider-5jEcloip.js` (1MB) — AI SDK vendor, lazy
  - `provider-BcLJktti.js` (302KB), `provider-uUBR3z8K.js` (166KB), `provider-C4DeO_Cz.js` (149KB), etc.
  - `claude-agent` workflow chunk (483KB) — isolated
- The static boot closure (measured via import-graph walk): **~9.17MB** (down from ~19.7MB statically reachable previously)

## What changed (structural inversion)
1. **`getRuntimeRegistry()` switched from eager `register()` to lazy `registerLazy()`**:
   - Each provider entry uses `await import()` inside the factory.
   - Metadata (slots, composer, degradations, capabilities) lives in small `metadata.ts` modules that don't pull provider internals.
   - Catalog can answer introspection queries without materializing runtimes.
2. **Capabilities extraction**: Added optional static `capabilities` to `ChatRuntimeMetadata` so the registry doesn't need to instantiate the provider to answer `/chat/runtimes`.
3. **Async migration**: Converted ~10 call sites from sync `registry.get()` to async `registry.require()`. Used `peek()` in dispose paths.
4. **Route-level dynamic imports**: `/server/resources` endpoints in opencode/kimi/codex now dynamic-import their resource readers at request time. Observability `runtime-snapshot` does the same.
5. **ACP static edge removed**: `src/modules/acp/index.ts` used a type-only import + dynamic class resolution.
6. **Bug fix**: Initial registration used wrong runtime kinds (`'acp'` instead of `'acp-chat'`, `'system-agent'` instead of `'jar-core'`). Now uses `*_RUNTIME_KIND` constants from metadata modules.

## Why memory didn't drop as projected
The lazy-load mechanism works correctly — chunks are isolated, the registry defers instantiation, tests pass. **But boot itself triggers the loading**:
1. Boot-phase dynamic imports in `src/app.ts` lines 401-402 load `opencode/runtime-context` and `codex/app-server/host-lease` just to extract two tiny functions (`prepareOpencodeManagedPathForRemoval`, `prepareCodexManagedPathForRemoval`, `stopOpencodeServer`). These modules transitively pull the full provider runtime context.
2. **Background plugin activation** (`activateServerPlugins`) runs right after listen and pulls unrelated heavy paths.
3. **Usage reconciliation schedulers** (claude/codex) instantiate provider-specific code in constructors.
4. Idle RSS growth from 243MB (at 2s) → 335MB (at 10s) happens **without any user input** — this is background services, not provider compilation.

Memory profile evidence:
```
post-import (178ms): RSS 92MB  heap 35MB   ← module loading only
2s:                  RSS 243MB heap 145MB  ← boot phases complete
10s:                 RSS 335MB heap 161MB  ← idle growth
```
The gap between heap (161MB) and RSS (335MB) is ~174MB of native/external memory — compiled bytecode, buffers, thread stacks. V8 compiles the boot closure aggressively.

## Tests
- `apps/server/src/plugins/loader.test.ts`: 25/25 passing
- `apps/server/src/modules/chat-runtime` + related: **928/928 passing** (3 skipped pre-existing)
- TypeScript clean (one pre-existing `plugins/loader.ts` error unrelated to this work)

## What remains for real memory wins
1. **Surgical extraction** of boot-time utilities: pull `prepareOpencodeManagedPathForRemoval`/`stopOpencodeServer`/`prepareCodexManagedPathForRemoval` into small pool-only modules that don't drag the runtime context. Estimated 50-80MB.
2. **Defer plugin activation**: don't auto-activate plugins at boot; activate on first use. Plugin child processes are a major RSS consumer.
3. **Reconsider usage reconciliation schedulers**: these instantiate at boot regardless of use. Convert to start-on-first-run.
4. **OTEL/pi-ai/undici in runtime-snapshot (2.75MB)**: still statically reachable because title generation + telemetry use them. Real inversion requires splitting telemetry initialization.
5. **Compile cache hit rate**: the measurement harness uses it; production may not. Verify desktop app launch flow enables `NODE_COMPILE_CACHE`.

## Verification commands
```bash
# Build
cd apps/server && pnpm build
# Tests
npx vitest run src/modules/chat-runtime src/plugins/loader.test.ts
# Measure
node scripts/desktop-startup-baseline/measure-server-boot.mjs 3
```

## Files changed
- `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` — core inversion
- `apps/server/src/modules/chat-runtime-providers/*/metadata.ts` — added capabilities + RUNTIME_KIND exports
- `apps/server/src/modules/chat-runtime/title-service.ts`, `side-chat/response.ts`, `capabilities-api.ts`, `runtime-status-api.ts`, `runtime.ts`, `runtime-session-context.ts`, `http/introspection.routes.ts`, `run/run-coordinator.ts`, `interaction/steer-turn.ts`, `interaction/bang-command-execution.ts`, `interaction/quick-question.ts` — async migration
- `apps/server/src/modules/acp/index.ts` — type-only + dynamic class resolution
- `apps/server/src/modules/chat-runtime-providers/opencode/server/index.ts`, `kimi/server/index.ts`, `codex/app-server/index.ts` — dynamic resource readers
- `apps/server/src/modules/observability/runtime-snapshot.ts` — dynamic resource readers
- `apps/server/src/modules/chat-runtime/codex/host.ts` — metadata lookup instead of runtime instantiation
