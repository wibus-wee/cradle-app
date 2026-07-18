# JavaScript Eval Module

`javascript-eval` owns bounded evaluation of Agent-authored JavaScript cells and the standalone `POST /javascript/evaluate` dry-run route. The preferred Agent-facing form is a bare async function expression such as `async ({ tools, cwd }) => false`; complete ES modules with a default export also work. `program.ts` uses `es-module-lexer` to normalize the bare form to a module without string heuristics.

## Trust Model

The evaluator is a reliability boundary, not a security boundary. A cell inherits the server process environment and the same filesystem, network, and command authority as the Agent's shell. Do not add a second permission system here.

Every run starts a disposable Node process through `spawnManagedProcess`. The process uses the requested workspace as its real operating-system cwd, has a 128 MiB V8 old-space setting, and is terminated as a managed process group on timeout. A cell calling `process.exit()`, exhausting its V8 heap, or looping forever therefore terminates only the evaluator process, not the server. The memory setting is a V8 heap limit, not a system-level memory quota.

Check mode is deliberately different from run mode: it invokes Node with `--input-type=module --check` and sends the normalized source over stdin. It parses syntax without importing the module, so registration cannot execute top-level file, process, or network side effects. Whether the default export is a function is checked on the first real run.

## Files

- **program.ts**: normalizes a bare function expression or accepts a complete module with a real default export.
- **runner.ts**: disposable child-process entry. Imports the module, supplies `{ tools, cwd }`, runs the cell, and writes the typed result protocol to a temporary file so cell console output cannot corrupt it.
- **evaluator.ts**: owns process startup, stdin, timeout/process-group shutdown, result decoding, and all evaluator limits.
- **model.ts**: TypeBox schemas for the standalone route.
- **index.ts**: Elysia plugin exposing `POST /javascript/evaluate`. The CLI command remains hand-written because it supports `--program-file`.

## Limits

| Constant | Value | Meaning |
|---|---|---|
| `MAX_PROGRAM_BYTES` | 64 KiB | Maximum input source size, measured as UTF-8 bytes |
| `EXEC_MAX_OUTPUT_BYTES` | 256 KiB | `tools.exec` stdout/stderr cap per stream |
| `EVAL_DEFAULT_TIMEOUT_MS` | 30 s | Default evaluation timeout |
| `EVAL_MAX_TIMEOUT_MS` | 120 s | Standalone route timeout clamp |
| `EXEC_DEFAULT_TIMEOUT_MS` | 30 s | Per-`tools.exec` timeout |
| `EVALUATOR_MAX_OLD_SPACE_MB` | 128 | Evaluator child V8 old-space setting |
| `MAX_EVALUATOR_RESULT_BYTES` | 1 MiB | Maximum serialized standalone evaluator result |

## Outcome Contract

`evaluateCell` returns `completed`, `check-passed`, `program-error`, `execution-error`, `timeout`, or `crashed`. Syntax/module-shape failures are program errors and should not be retried. A thrown cell or `tools.exec` failure is an execution error. Timeout and crash indicate evaluator-process failures. Consumers decide their retry policy without depending on the process implementation.

## Current Exclusions

- Cells loaded from data URLs can import `node:` builtins, but relative and npm package specifiers do not resolve.
- Every evaluation starts with a fresh heap; state does not persist between polls.
- Scheduling belongs to consumers. The JavaScript session-await source enqueues evaluations on the session-await heavy-check queue (bounded concurrency, poll-interval due checks) so they never block the poller fast path.
