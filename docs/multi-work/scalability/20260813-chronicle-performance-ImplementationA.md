# Chronicle performance implementation handoff

## Scope and outcome

Implemented scalability finding 1 in commit `c7a31b4d` (`perf(chronicle): bound inference and vector search`). The Chronicle request path no longer calls `spawnSync`, starts one process per embedding request, or parses every ready vector during memory search.

## Architecture decisions

- Added a supervised, long-lived JSON-lines inference worker. The TypeScript supervisor owns request IDs, a maximum of 16 active/queued requests, input/text bounds, per-call timeouts, abort handling, crash rejection, lazy restart, and idempotent shutdown. Rust owns one lazily loaded `OnnxRuntime` for the worker process lifetime and processes requests sequentially because its ONNX sessions are single-threaded.
- Kept a synchronous lexical embedding as the durable write baseline so memory mutation transactions remain short and search remains available without the ONNX model. A bounded asynchronous indexer upgrades chunks to ONNX embeddings after commit and is drained before the Chronicle worker stops.
- Added the rebuildable `chronicle_memory_embedding_buckets` ANN projection. Each embedding stores its 16 strongest signed dimensions in an indexed projection. Search retrieves at most 256 bucket/keyword candidates and performs exact cosine reranking only for those candidates.
- Backfills missing candidate buckets once during server boot, outside the HTTP request path. New lexical and ONNX embeddings maintain buckets transactionally.
- Reused the composition-root `RuntimeResourceRegistry`: the asynchronous embedding indexer drains in the `drain` phase, the existing Chronicle daemon resource stops both daemon and inference worker in the `stop` phase, and infrastructure closes last.

## Exact files

- `apps/server/src/modules/chronicle/inference-worker.ts`: inference supervisor.
- `apps/server/src/modules/chronicle/daemon-manager.ts`: lazy singleton worker ownership, async embedding API, reset/cleanup.
- `chronicle/src/main.rs`: `--embedding-worker` JSON-lines mode with one reused ONNX runtime.
- `apps/server/src/modules/chronicle/service.ts`: async HTTP embedding/search, bounded candidate retrieval, asynchronous ONNX indexing, ANN projection maintenance/backfill.
- `apps/server/src/app.ts`: boot-time projection reconcile and indexer lifecycle registration.
- `packages/db/src/schema/chronicle.ts`: candidate-bucket schema and types.
- `packages/db/drizzle/0057_chronicle_embedding_candidates.sql`, `packages/db/drizzle/meta/0057_snapshot.json`, `packages/db/drizzle/meta/_journal.json`: migration metadata.
- `apps/server/tests/chronicle-inference-worker.test.ts`, `apps/server/tests/fixtures/chronicle-inference-worker.mjs`: reuse, event-loop responsiveness, queue bound, abort, timeout, crash/restart, and benchmark coverage.
- `apps/server/tests/chronicle.test.ts`: bucket maintenance and proof that an unindexed corrupt vector is not parsed by search.
- `apps/server/src/modules/chronicle/README.md`: ownership and runtime behavior.

## Validation

- `pnpm --dir apps/server exec vitest run tests/chronicle-inference-worker.test.ts tests/chronicle-daemon-manager.test.ts tests/database.test.ts --reporter=dot --maxWorkers=1 --no-file-parallelism` — 13 passed.
- `pnpm --dir apps/server exec vitest run tests/chronicle.test.ts --reporter=dot --maxWorkers=1 --no-file-parallelism` — 12 passed.
- `CRADLE_CHRONICLE_BENCHMARK=1 pnpm --dir apps/server exec vitest run tests/chronicle-inference-worker.test.ts -t "reports event-loop delay" --reporter=verbose --maxWorkers=1 --no-file-parallelism` — timer delay 8.90 ms while inference remained active for 198.00 ms.
- ESLint over every changed TypeScript/JavaScript file — passed.
- `pnpm exec tsc --noEmit -p apps/server/tsconfig.json` — passed.
- `node --import tsx apps/server/scripts/check-module-boundaries.ts` — passed; largest runtime SCC remained 23.
- `git diff --cached --check` — passed before commit.
- Database-focused tests exercised migration 0057 and the new table successfully.

The ordinary `tsx` boundary command failed because this sandbox forbids its temporary IPC socket; the equivalent `node --import tsx` invocation passed. Rust formatting/build checks were not run because `cargo` is not installed in this environment. Focused server tests logged expected missing optional plugin `dist` entries without test failures.

## Risks and follow-up

- The signed top-dimension ANN projection is intentionally approximate. Exact cosine remains authoritative after candidate selection, but recall should be measured with a representative large Chronicle corpus before tuning bucket count or multiprobe behavior.
- The worker pending limit is 16. Excess asynchronous upgrades retain their lexical baseline and record an error rather than growing memory without bound; a future maintenance pass can retry lexical-only chunks.
- The benchmark isolates supervisor/event-loop behavior with a deterministic fake worker. A release build with installed ONNX artifacts should add real-model cold-start, warm-query latency, and 10k/100k-corpus retrieval measurements on supported hardware.
- Run `cargo fmt --check` and Chronicle Rust tests in an environment with the Rust toolchain before merge.

## Commit

Implementation commit: `c7a31b4d`
