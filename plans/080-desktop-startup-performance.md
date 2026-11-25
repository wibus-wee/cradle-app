# Plan 080: Desktop 启动性能与内存治理

> **Executor instructions**: Milestone-driven. Every optimization must be
> verified against the baseline harness in `scripts/desktop-startup-baseline/`
> — numbers without before/after measurement do not count. Update the status
> row in `plans/README.md` when done.

## Status

- **Priority**: P1 (dogfood pain — owner-reported 2026-11-25)
- **Effort**: XL
- **Risk**: M (touches boot path; honesty of startup sequencing matters)
- **Category**: performance, desktop, server
- **Planned at**: 2026-11-25

## Targets (hard gates)

| Metric | Baseline (2026-11-25, dev Mac Studio) | Target |
|---|---|---|
| Server process RSS after boot, empty data dir | **370 MB** | **< 150 MB** |
| Server boot → listening | TBD (measure in M0) | < 2 s |
| Desktop cold start → interactive UI | TBD | < 4 s |
| Packaged .app size | 471 MB (post-079, unreleased) | ≤ 471 MB, no regression |

## Diagnosis (2026-11-25)

Architecture: Electron spawns a process tree — main + renderer(s) + embedded
server (Node, 270k LOC, 19 MB dist bundle, single eager ESM graph) + relayd +
per-provider runtimes (codex app-server etc, post-079 managed/on-demand) +
plugin hosts.

Prime suspects, in order:

1. **Server eager module graph.** 1842 TS modules compile into a bundle loaded
   in full at import time. `createServerApp` instantiates every module service
   synchronously — chronicle (9.6k LOC service), all chat-runtime providers
   (kimi 7.2k, opencode 3.9k, claude-agent, codex), plugins host,
   observability, telemetry — regardless of whether the user ever opens those
   surfaces. Parse cost + instantiation cost + retained references.
2. **Plugin activation at boot.** Plugins activate synchronously during server
   boot (observed in boot log), blocking listening and adding memory even when
   unused.
3. **relayd always-on.** Spawns at desktop boot regardless of whether any
   mobile/remote pairing exists.
4. **Renderer first-bundle weight.** web is 310k LOC; route-level splitting
   exists (Plan 018) but first paint still pulls the app shell + design
   system + chat feature.
5. **Dev-mode tax confusion.** Owner's impressions partly predate Plan 079
   (1 GB .app, embedded codex runtimes); packaged reality is better but no
   release shipped the improvement.

## Milestones

### M0 — Baseline harness (measurement before optimization) — DONE 2026-11-25

- Harness: `scripts/desktop-startup-baseline/measure-server-boot.mjs` (N cold
  runs, per-phase IPC timing, RSS at boot+2s/idle+10s, child-process tree).
- Server cold boot → listening: **608ms median** (empty data dir); every boot
  phase ≤30ms — the sequence is not the problem, the static module graph is.
- RSS: 289MB @ boot+2s, **397MB @ idle+10s and still climbing** — real
  footprint, not GC noise.
- Attribution (subagent Frost, vm.SourceTextModule compile-only experiment +
  --heap-prof + forced-GC steady-state):
  - ~85-100MB V8 bytecode/code space for the 19.7MB JS bundle (~5MB RSS per
    1MB of JS source, before execution)
  - ~74MB live heap floor (compile artifacts ~20MB, models.dev registry ~8MB,
    zod schema objects several MB, provider SDK evaluation ~3-4MB)
  - ~28MB external buffers; ~15-100MB unreturned V8 pages (macOS returns
    pages slowly/incompletely); ~50-80MB native residual (unquantified)
- Structural root cause: **the entire bundle has 3 dynamic imports** — 270k
  LOC statically linked. `chat-runtime-providers` alone is 110k LOC (44% of
  server modules), compiled into memory even when the user runs one provider.
  The 6.7MB `runtime-snapshot` chunk fuses pi-ai + OTEL + zod + openai client.
- Data-layer finding: dogfood `cradle.db` is **3.2GB** — chat_message_payloads
  1.7GB, recall_tool_events 428MB, diff_review_revisions 170MB,
  observability_events 159MB, backend_run_snapshot_events 108MB (75k rows).

### M1 — Server boot memory diet (largest win expected)

- [x] M1.1 `NODE_COMPILE_CACHE` wired in desktop server spawn
  (`server-process.ts`): measured boot **717ms → 541ms (-25%)** warm-cache.
  Cache keyed by node version so app updates invalidate cleanly.
- [ ] M1.2 lazy-load provider implementations behind first-use (provider
  registry keeps metadata eager, implementation lazy) — the big structural
  lever, est. -100-150MB RSS. Includes splitting the runtime-snapshot
  mega-chunk.
- [ ] M1.3 models.dev registry parsed per-provider on demand (~8MB heap,
  ~40ms boot CPU).
- [ ] M1.4 defer non-critical services until after listening (observability
  flush loops, warmers) — listening must not wait for them.
- Verify: server RSS empty-boot, plus a dogfood-realistic boot (owner's data
  dir copy) — both numbers in the diff.

### M2 — Plugin activation off the critical path

- Boot activates no plugin synchronously; activation becomes async with
  honest per-plugin status surfaced to UI. Failure isolation already partial;
  the change is sequencing, not semantics.

### M3 — relayd conditional startup

- Spawn relayd only when a pairing/remote-access configuration exists or a
  mobile client has connected before. Default cold boot: no relayd.

### M3b — Database retention (added 2026-11-25)

- chat_message_payloads (1.7GB in dogfood), recall_tool_events (428MB),
  observability_events (159MB), backend_run_snapshot_events (108MB) grow
  unbounded. Design age-based + size-based caps per table; blob payloads are
  content-addressed so dedupe is free. observability_events need
  aggregate-then-drop. Unbounded growth degrades boot recovery, migrations,
  FTS, and disk — this is startup cost deferred, not a separate concern.

### M4 — Desktop/renderer path

- Measure what renderer loads before first interactive paint; trim shell
  eager imports. Only after M1/M2 numbers are in — renderer may not be the
  bottleneck at all.

### M5 — Release the improvement

- Cut a dev release so the owner actually runs the fixed build (last release
  predates Plan 079 entirely).

## STOP conditions

- Optimization requires hiding work rather than deleting/deferring it
  (moving cost from boot to first-interaction in a way users can feel
  without measuring).
- Lazy-loading providers breaks the capability-advertisement contract
  (providers must still report models/features before first use).
- Any milestone trades correctness for numbers — e.g. skipping migrations,
  deferring auth setup, racing plugin activation against plugin use.

## References

- Plan 079 (managed runtime downloads — packaged-size precedent)
- `apps/server/scripts/session-startup-benchmark.ts` (session-level, not boot)
