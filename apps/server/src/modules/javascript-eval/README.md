# JavaScript Eval Module

`javascript-eval` owns bounded evaluation of Agent-authored JavaScript cells. A cell is a small ES module with a default-exported async function; the module executes it inside a `worker_threads` worker and returns a structured outcome. It also owns the standalone `POST /javascript/evaluate` route used to dry-run cells.

## Trust Model

The worker is a **reliability boundary, not a security boundary**. Cradle is a local, user-owned agent environment: a cell inherits the same authority the Agent's shell already has (filesystem, network, child processes via `tools.exec`). Do not add permission prompts, command allowlists, or network restrictions here. The boundary exists so a runaway cell cannot freeze or OOM the server: memory is capped via `resourceLimits` and infinite loops are killed via `worker.terminate()` on a wall-clock timeout. `node:vm` was deliberately rejected — it cannot interrupt `while (true) {}` on the main thread.

## Files

- **shim.ts**: `WORKER_SHIM_SOURCE`, the CommonJS worker program (evaluated via `new Worker(source, { eval: true })`). Loads the cell from a `data:` URL, verifies the default export is a function, provides `tools.exec` (argv-only `execFile`, no shell), and posts `{ ok, result? , error? }` back. `check` mode imports and shape-checks the module without calling the cell.
- **evaluator.ts**: host-side `evaluateCell` primitive. Spawns the worker with resource limits, resolves the first of message/error/wall-clock timeout, and always terminates the worker. Owns all limit constants.
- **model.ts**: TypeBox schemas for the evaluate route.
- **index.ts**: Elysia plugin exposing `POST /javascript/evaluate`. No `x-cradle-cli` metadata; the CLI command is hand-written to support `--program-file`.

## Limits

| Constant | Value | Meaning |
|---|---|---|
| `MAX_PROGRAM_BYTES` | 64 KiB | Maximum cell source size (enforced by the route and the await source) |
| `EXEC_MAX_OUTPUT_BYTES` | 256 KiB | `tools.exec` stdout/stderr cap per stream; over-cap output is truncated and marked `…[truncated]` |
| `EVAL_DEFAULT_TIMEOUT_MS` | 30 s | Default wall-clock evaluation timeout |
| `EVAL_MAX_TIMEOUT_MS` | 120 s | Route-level clamp for caller-supplied timeouts (minimum 1 s) |
| `EXEC_DEFAULT_TIMEOUT_MS` | 30 s | Per-`tools.exec` child-process timeout |
| `WORKER_MAX_OLD_SPACE_MB` | 128 | Worker old-generation heap cap (deliberately loose; tighten only with evidence) |

## Outcome Contract

`evaluateCell` resolves to a discriminated union: `completed` (cell returned a structured-cloneable value), `check-passed` (check mode), `error` (cell threw, bad module, missing default export, non-cloneable result, spawn failure), `timeout` (wall-clock kill), or `crashed` (worker error event, including the memory cap). This shape is the stable seam: the execution backend could later be swapped (e.g. a QuickJS isolate for multi-tenant use) without touching consumers.

## v1 Exclusions

- **No package imports.** Cells load from `data:` URLs: `node:` builtins work, relative and npm specifiers do not resolve.
- **No persisted heap.** Every evaluation is a fresh worker; no state carries over between evaluations.
- **No per-cell scheduling.** Cadence is owned by consumers (the session-await poller ticks every 30 s), not by this module.
