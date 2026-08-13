# Remove Cradle scalability hot paths

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This repository does not contain a root `PLANS.md`; this plan follows the ExecPlan format supplied by the project execution-plan skill.

## Purpose / Big Picture

Cradle should remain responsive when a user has many sessions, Works, messages, browser elements, and relay rooms. Today several request and render paths perform work proportional to all historical data, perform synchronous native inference on the server event loop, or poll complete collections. After this plan, the hot paths are bounded, incremental, or event-driven. A developer can verify the outcome with focused correctness tests plus repeatable benchmarks that show request latency, idle work, bundle loading, and memory use no longer grow without an explicit bound.

The work is delivered as independently committed, ownership-aligned slices in one draft pull request. Search indexing, Chronicle inference, server projections, event streaming, client rendering, desktop background work, CI, relay scheduling, and simulator validation retain separate validation and handoff records while sharing one integration branch, as requested by the user.

## Progress

- [x] (2026-08-13 01:20Z) Audited all 22 reported findings against `main` at `d40f895e` and confirmed that each cited hot path still exists, with partial prior mitigation only in generic SSE infrastructure and relay queue cleanup.
- [x] (2026-08-13 01:35Z) Chose seven ownership-aligned implementation slices, later consolidated into one pull request at the user's direction.
- [x] (2026-08-13 22:45Z) Completed the owned message/title FTS5 migration and bounded thread-search fallback. Focused Search, Session, and database coverage passed 17/17; Search passed again 3/3 after final title-trigger assertions; ESLint, TypeScript, module boundaries, and `git diff --check` passed.
- [x] (2026-08-13 03:05Z) Replaced Chronicle synchronous embedding subprocess calls and full-vector scans with a supervised asynchronous inference worker and indexed candidate retrieval.
- [x] (2026-08-13 03:14Z) Added opaque cursor pages and page-bounded Session/Work summary projections, removed list-time title and GitHub refreshes, migrated generated clients and consumers, and deduplicated sidebar Work ownership.
- [x] (2026-08-13 03:08Z) Made global chat tails header-only, batched message hydration, enforced per-client stream bounds, and indexed message-page revision lookup.
- [x] (2026-08-13 03:27Z) Made streaming Markdown incremental, restored route-oriented chunking, excluded generated API sources from React Compiler, virtualized mobile collections, and lazy-loaded large web, landing, settings, and CLI graphs.
- [x] (2026-08-13 03:22Z) Gated IPC diagnostics, replaced desktop notification polling, avoided unchanged background-job writes, and modeled CI as a shared-artifact DAG with one server-test owner.
- [x] (2026-08-13 03:20Z) Bounded browser annotation discovery, removed the relay Hub write-lock from forwarding, cleared dequeued references, and cached simulator validators.
- [x] (2026-08-13 03:28Z) Ran focused package tests, typechecks, builds, lint, boundary checks, and available benchmarks; recorded environment-limited Go/Rust checks in handoffs.

## Surprises & Discoveries

- Observation: the thread-search issue is more severe than the report states. No migration creates `messages_fts`, and production message projection never calls `Search.indexMessage`; only one test calls it explicitly. The FTS result path also converts a hashed SQLite row id into the public message id, hard-codes every snippet role to `assistant`, and substitutes the session timestamp for the message timestamp.
  Evidence: `apps/server/src/modules/search/service.ts` has no production caller for `indexMessage`; `apps/server/src/modules/search/thread-search.engine.ts` previously returned `String(rowid)`, `messageRole: 'assistant'`, and `session.updatedAt`.

- Observation: generic SSE support is already demand-aware, but chat event tails implement a separate `ReadableStream` that enqueues without consulting `desiredSize`. The report is therefore correct for chat tails but should not trigger another generic SSE abstraction.
  Evidence: `apps/server/src/infra/sse-event-stream.ts` drains only while `desiredSize > 0`; `apps/server/src/modules/chat-runtime/es/event-tail.ts` directly calls `controller.enqueue` for replay, live events, and keepalives.

- Observation: relay control-queue dequeue already clears the removed slot, but data-queue dequeue does not. The memory-retention finding applies only to `dataByStream` slices.
  Evidence: `apps/relayd/internal/relay/hub.go` assigns `queuedEnvelope{}` to `s.control[0]`, while the multi-item data branch stores `items[1:]` without clearing `items[0]`.

- Observation: desktop IPC diagnostic capture is always enabled even though only the dedicated devtool window subscribes. The fix must preserve handler registration while enabling the observer only for the devtool window lifetime.
  Evidence: `startDesktopApp()` always calls `initializeIpcDevtool()`, which immediately installs `setIpcObserver`; `WindowManager` subscribes only after the devtool window loads.

- Observation: keeping titles only as a column in the per-message FTS table makes title-only sessions unsearchable and tempts a bounded-but-incomplete recent-session scan.
  Evidence: a session may have no messages, and scanning even the latest 1,000 session titles would trade an unbounded path for a correctness cutoff. The migration now owns a separate `sessions_fts` projection instead.

- Observation: the workspace sidebar requested the same Work summaries globally and once again for every rendered workspace.
  Evidence: `WorkspaceSidebar` built the canonical global `workByPrimarySessionId` map while each `WorkspaceSidebarBody` also called `useWorkspaceWorks(workspace.id)` as a fallback. The child now derives its workspace slice from the canonical map.

## Decision Log

- Decision: deliver seven ownership-aligned pull requests: Search; Chronicle; Work/Session projections; chat event history; client build/render; desktop/CI/background work; relay/simulator/browser annotation.
  Rationale: these slices have separate contracts and verification commands. A single patch would make regressions hard to attribute and review.
  Date/Author: 2026-08-13 / Codex

- Decision: make the Search namespace own `messages_fts` through a Drizzle migration containing FTS5 DDL, triggers, and a backfill. Keep the compatibility search path, but cap both sessions and messages.
  Rationale: FTS correctness must not depend on an optional call from every message writer. Triggers cover canonical inserts, updates, title changes, and deletes, while the explicit index method can still replace raw text with Jieba-segmented text.
  Date/Author: 2026-08-13 / Codex

- Decision: index session titles in a separate `sessions_fts` projection and query message bodies with an FTS column filter.
  Rationale: title-only sessions remain searchable without scanning a recent-session window, while title matches cannot manufacture body snippets with empty highlight ranges.
  Date/Author: 2026-08-13 / Codex

- Decision: do not change `/works` or `/sessions` from arrays to page envelopes in the Search PR. Pagination is a separate contract migration that will update server schemas, generated clients, web, mobile, and CLI together.
  Rationale: mixing an API-wide response-shape break with an FTS repair would make both changes harder to validate and roll back.
  Date/Author: 2026-08-13 / Codex

- Decision: preserve cursor-based reconnect and `SnapshotRequired` as the overflow contract for chat tails instead of silently dropping events or allowing an unbounded queue.
  Rationale: event order is durable and already cursor-addressable. A slow client should re-snapshot from an authoritative cursor rather than receive an incomplete sequence.
  Date/Author: 2026-08-13 / Codex

- Decision: change both list contracts to `{ items, nextCursor }`, with a default page of 100 and a maximum of 200, and preserve existing descending sort semantics with opaque base64url cursors.
  Rationale: every response is bounded, generated clients expose continuation explicitly, and UI surfaces that display only a summary window can intentionally request one capped page.
  Date/Author: 2026-08-13 / Codex

- Decision: Work list summaries decode the Pull Request owner's cached projection from each already-loaded Session config and reserve remote GitHub refresh for explicit detail/reconciliation paths.
  Rationale: a collection read must not make one network request and one persistence write per Work row.
  Date/Author: 2026-08-13 / Codex

## Outcomes & Retrospective

All 22 findings are implemented in one draft pull request through ownership-aligned commits. Corpus and collection reads are indexed or cursor-bounded; Chronicle and chat event paths are asynchronous and backpressured; web, mobile, Streamdown, and CLI load or render incrementally; idle desktop work and duplicate CI execution are removed; and remaining relay, browser-annotation, and simulator hot paths have explicit bounds. Focused tests, TypeScript, lint, module boundaries, and web/landing builds pass. The only validation unavailable locally is Go race testing because Go tooling is absent; Chronicle's macOS Cargo job remains the authoritative native gate.

## Context and Orientation

Cradle is a monorepo. `apps/server` owns the Elysia HTTP server and SQLite access through Drizzle. `packages/db/drizzle` contains ordered migrations. `apps/web`, `apps/mobile`, and `apps/desktop` are the web renderer, Expo client, and Electron shell. `packages/streamdown` renders streaming Markdown. `apps/relayd` is a Go WebSocket relay. `packages/model-api-simulator` validates model protocol fixtures. Generated API clients live under `apps/web/src/api-gen`, `apps/mobile/src/api-gen`, and generated CLI commands under `packages/cli/src/commands/generated`; they must be regenerated from the server contract rather than hand-edited.

A projection is a derived read model built from canonical data. It may be rebuilt without changing the source facts. `messages_fts` is such a projection: canonical messages remain in `messages` and `chat_message_payloads`, while SQLite FTS5 stores searchable text. A cursor page is a bounded response that returns a fixed number of records plus an opaque position for the next request. Backpressure is a stream producer's response to a consumer that cannot accept more buffered data; in a `ReadableStream`, `controller.desiredSize` exposes that state.

The first slice touches `packages/db/drizzle/0056_thread_search_fts.sql`, its Drizzle journal metadata, `apps/server/src/modules/search/thread-search.engine.ts`, `apps/server/src/modules/search/model.ts`, the Search README, and focused server tests. The migration creates the virtual table, backfills existing messages, and installs triggers for canonical message, payload, session-title, and delete changes. FTS queries join canonical rows so public message ids, roles, timestamps, workspace scope, and origin are accurate. The fallback is retained only for migration/corruption recovery and is capped.

Chronicle inference currently enters through `apps/server/src/modules/chronicle/daemon-manager.ts::runEmbeddingBatch`, which calls `spawnSync`, and `apps/server/src/modules/chronicle/service.ts::searchMemories`, which parses every ready vector. The replacement must use a supervised long-lived process with request ids, timeouts, aborts, crash restart, and a bounded pending queue. Candidate selection must happen in an index before exact cosine reranking; it must not deserialize every stored vector per query.

Work and Session list behavior lives in `apps/server/src/modules/work/service.ts`, `apps/server/src/modules/session/service.ts`, and their route models. Work list currently hydrates each primary session and may perform one GitHub request per row. Session list performs multiple derived reads and its route starts remote title synchronization. These list responses feed web and mobile sidebars, so the contract migration must update all consumers in one slice.

Chat event replay and history live in `apps/server/src/modules/chat-runtime/es/event-tail.ts`, `history-api.ts`, and `es/event-store.ts`. Global events need only headers and compact previews; session-scoped detail can hydrate payloads in one batch. Each stream needs a bounded pending queue and a deterministic `SnapshotRequired` overflow event. Message page revision should come from an indexed latest-version query rather than reducing all headers.

Client performance work spans `packages/streamdown`, Vite/Electron build configuration, web feature imports, mobile list containers, browser annotation preload code, and CLI generation. Changes must preserve user-visible rendering and route behavior while proving that initial work is bounded. Bundle changes require artifact inspection, not only a successful build.

## Plan of Work

Milestone 1 repairs thread search. Add the FTS migration and trigger-backed backfill. Change the engine to use the canonical message id instead of a hash, filter workspace and origin inside the FTS query, join canonical metadata in one query, cap query parameters, and cap the legacy path. Extend tests to prove that a fresh database contains FTS rows maintained by payload updates and that returned snippet metadata is correct. Run focused Search, Session cleanup, Chat Runtime search, database migration, typecheck, and boundary checks. The observable result is that a fresh database searches through FTS without a JavaScript transcript scan and a missing/corrupt FTS table can degrade only to a fixed window.

Milestone 2 removes Chronicle event-loop blocking. Add a Rust JSON-lines inference worker mode that owns one ONNX runtime and loads the embedding model once. Add a TypeScript supervisor in the Chronicle namespace that multiplexes request ids, enforces input and queue bounds, aborts timed-out calls, rejects pending requests on process exit, and lazily restarts. Make HTTP search asynchronous. Introduce an indexed embedding candidate store or SQLite vector extension only after a local capability probe; exact cosine scoring remains the final reranker. Record event-loop delay and query latency before and after with a corpus large enough to expose full scans.

Milestone 3 bounds Work and Session summaries. Define cursor input and page output in the owning models. Use set-based joins or batched maps for primary session, status, requested model, work binding, and attention state. A Work summary reads cached pull-request state only; a TTL/event-driven reconciler refreshes remote state outside the list request. A Session list never initiates title synchronization. Update generated clients and all web/mobile/CLI callers to consume pages or intentionally request bounded summaries. Verify first-page latency and query count at 10, 1,000, and 10,000 synthetic records.

Milestone 4 bounds chat history and streams. Add a header-only global event parser that never loads message JSON which is later stripped. Batch session-scoped payload and structural hydration by payload/message ids. Replace direct enqueue with a small stream-owned queue that drains from `pull()`, caps bytes and event count, and emits one `SnapshotRequired` terminal handoff when overflow occurs. Read page revision through `ORDER BY version DESC LIMIT 1` and rely on transactionally maintained message status. Verify replay/live handoff ordering, reconnect cursors, slow-reader overflow, cancellation cleanup, and bounded heap growth.

Milestone 5 makes client work incremental. Preserve only stable framework chunks in web `manualChunks`; let route dynamic imports own feature boundaries. Cache Streamdown segmentation and tokenize only appended or active-tail blocks. Reuse one `Intl.Segmenter`. Exclude generated non-React sources from React Compiler in web and desktop builds. Replace mobile `ScrollView` collection mounts with `FlatList` or `SectionList` and subscribe to targeted tail/status updates. Generate a lightweight CLI group manifest whose selected group is loaded dynamically. Lazy-load settings sections, changelog Markdown/shaders, and landing blog/changelog graphs with intent preloading. Compare initial chunk count/bytes, transform time, CLI cold start, long-response frame time, and mobile mounted-row count.

Milestone 6 removes idle desktop and CI work. Register IPC devtool handlers at startup but attach the expensive observer only while a devtool window consumes events; build bounded payload summaries before serialization. Drive notifications from the existing durable global event tail with one cursor, retaining a slow backoff poll only for recovery. In background jobs, compare normalized observations and skip equal writes; poll frequently only while active sources need recovery. Refactor CI into build artifacts consumed by parallel typecheck/test jobs and ensure the server suite has one owner. Verify zero notification loopback requests during an idle healthy interval, no unchanged job writes, and one server-suite invocation per CI run.

Milestone 7 removes remaining infrastructure contention. Traverse browser annotation elements incrementally from viewport candidates, skip ignored subtrees before layout/style reads, stop at the result cap, and cache stable metadata with explicit invalidation. Change relay data forwarding to concurrent read access or stable per-room peer state while retaining exclusive mutation for membership changes; clear every dequeued slot before reslicing. Cache OpenAI dynamic AJV validators by stable operation/status/schema identity. Run Go race tests and relay benchmarks, browser scan benchmarks on large DOM fixtures, and simulator tests that assert one compilation for repeated validation.

## Concrete Steps

All commands run from the repository root.

For the first slice, install dependencies if absent and run:

    COREPACK_HOME=/tmp/cradle-corepack corepack pnpm install --frozen-lockfile
    COREPACK_HOME=/tmp/cradle-corepack corepack pnpm exec vitest run apps/server/tests/search.test.ts apps/server/tests/session.test.ts apps/server/tests/database.test.ts
    COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --filter @cradle/server typecheck
    COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --filter @cradle/server check:boundaries

Expect all selected tests to pass, no TypeScript diagnostics, and no boundary increase. If a command reports missing native packages, rerun the frozen install once and repeat the failed command.

Before each later slice, record a baseline with the repository's existing benchmark where one exists. Add a focused benchmark only when no existing command exercises the hot path. Store concise before/after transcripts in this plan and the PR body. Run package-scoped tests first; run broader server or E2E coverage only when the changed contract crosses packages or a critical user journey.

After a slice passes, inspect `git diff --check`, stage only its owned files, commit with a terse conventional title, push an `agent/perf-*` branch, and open a draft PR using `.github/PULL_REQUEST_TEMPLATE.md`. The PR body must identify the finding numbers, root cause, user impact, exact checks, and benchmark result.

## Validation and Acceptance

Thread search is accepted when a fresh migrated database has `messages_fts`, existing messages are backfilled, inserts/content updates/title updates/deletes are reflected, FTS results return canonical message identity/role/time, workspace and origin filters execute in SQL, limits above the contract cap are rejected, and the fallback cannot read more than 250 sessions or 2,000 messages.

Chronicle is accepted when no request path calls `spawnSync`, concurrent HTTP/SSE timers continue while inference runs, the worker restarts after a forced crash, pending requests are bounded, and candidate retrieval does not parse all stored vectors. Work and Session lists are accepted when every response is bounded, list requests make zero GitHub calls and trigger zero title-sync jobs, and database query count is constant or batch-bounded rather than proportional to rows.

Chat tails are accepted when a deliberately suspended reader cannot cause unbounded queue growth, overflow produces a reconnectable snapshot handoff, global replay performs no message-body hydration, and a bounded history page performs no full event reduction. Client work is accepted when initial static imports no longer pull large inactive feature graphs, Streamdown work tracks appended content rather than total-content times frames, generated API files bypass React Compiler, and mobile collections virtualize rows.

Desktop/background/CI work is accepted when IPC payload serialization is absent without a devtool consumer, idle notification delivery does not make 40 loopback requests per minute, equal background observations do not update rows, and CI does not execute the server suite twice. Infrastructure work is accepted when relay room traffic can resolve peers concurrently, dequeued frame buffers are not retained, repeated simulator validation reuses compiled AJV functions, and browser annotation work stops at its bounded result budget.

## Idempotence and Recovery

The FTS migration is applied once by Drizzle. Its triggers are deterministic, and explicit index rebuild begins by deleting derived FTS rows before repopulating them from canonical data. The compatibility fallback is read-only. If migration testing fails, delete only the temporary test data directory and rerun; never alter a user's database by hand.

Every later projection or cache must be derived and rebuildable. Worker startup and shutdown must be idempotent. Cursor pages and event tails must tolerate retry with the same cursor. Stacked branches should be rebased or retargeted after their base merges; do not force-push a branch another contributor is using without first checking its remote state.

## Artifacts and Notes

Initial source audit at `d40f895e` found:

    apps/server/src/modules/chronicle/daemon-manager.ts:142  spawnSync(...)
    apps/server/src/modules/work/service.ts:221               Promise.all(per-Work live PR reads)
    apps/server/src/modules/search/thread-search.engine.ts:116 table existence probe, no owning migration
    apps/server/src/modules/chat-runtime/es/event-tail.ts:313   unconditional controller.enqueue(...)
    apps/desktop/src/main/ipc-devtool.ts:24                     unconditional observer installation
    apps/relayd/internal/relay/hub.go:445                       Hub-wide exclusive peer lookup

Benchmark and test transcripts will be appended here as milestones complete.

First Search slice validation on 2026-08-13:

    vitest: apps/server/tests/search.test.ts, session.test.ts, database.test.ts — 17 passed
    final Search rerun — 3 passed
    eslint on changed TypeScript — passed
    tsc --noEmit — passed
    node --import tsx apps/server/scripts/check-module-boundaries.ts — passed; largest SCC 23
    git diff --check — passed

The focused server tests log expected missing `dist` entries for optional plugins that were not built in the scratch checkout; those activation failures did not fail any selected test.

Work/Session slice validation on 2026-08-13:

    vitest: Session service, Work service, Background Job — 34 passed
    vitest: web Session query-cache projection — 4 passed
    eslint on owned server/web/mobile TypeScript — passed
    server tsc --noEmit — passed
    web tsc --noEmit — passed
    CLI tsc --noEmit — passed

The broader Session HTTP assertions were updated for the page envelope, but their rerun in the shared worktree was blocked before route execution by concurrent Chronicle composition code referencing an export that had not yet landed. Mobile TypeScript reached one unrelated `ReadableStream` async-iterator diagnostic in `chat-stream.test.ts`; the changed mobile page consumers produced no diagnostics.

## Interfaces and Dependencies

The Search slice retains `ThreadSearchEngine.search(params): ThreadSearchHit[]`, `indexMessage(sessionId, sessionTitle, messageId, content): void`, and session cleanup behavior. `messages_fts` is a derived SQLite FTS5 table with unindexed `message_id` and `session_id`, plus indexed `session_title` and `searchable_text`; `sessions_fts` independently indexes canonical session titles. Public snippets must use canonical `messages.id`, `messages.role`, and `messages.created_at`.

The Chronicle worker must expose an asynchronous TypeScript interface equivalent to:

    interface ChronicleInferenceWorker {
      embed(texts: readonly string[], options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ChronicleEmbeddingBatch>
      stop(): Promise<void>
    }

Work and Session page contracts must use opaque cursors and bounded limits. Chat tail overflow must reuse the existing `SnapshotRequired` contract. Client data fetching should use generated API clients and TanStack Query rather than handwritten duplicate request shapes. Relay synchronization must use Go standard-library primitives and preserve race-detector safety. Simulator validator caching must remain internal to `JsonSchemaRegistry` and must not weaken validation or error labeling.

Revision note (2026-08-13): created the campaign plan after source-level validation of all reported findings, recorded the first Search implementation decisions, updated it after final Search validation, and recorded the completed Work/Session pagination plus unchanged-background-observation slice and its validation evidence.

Final integration validation on 2026-08-13:

    Search/Session/database — 17 passed
    Chronicle worker/service — 25 focused tests passed; event-loop timer delay 8.90 ms during 198 ms fake inference
    Work/Session/background jobs — 34 server + 4 web tests passed
    Chat tail/history/checkpoint/routes — 25 focused tests passed
    Desktop/IPC/notification/browser — 19 focused tests passed
    Simulator — 49 tests passed
    Mobile event-tail/stream — 3 tests passed; mobile TypeScript and lint passed
    CLI selection — 11 tests passed; typecheck/build/help smoke passed
    Streamdown incremental parsing — focused tests passed
    Web and landing TypeScript and production builds — passed; inactive features emitted as independent chunks
    Server/Web/Desktop/Mobile/CLI TypeScript — passed
    module boundaries — passed; largest runtime domain SCC remains 23
    CI YAML parse, focused ESLint, and git diff check — passed

Go test/race could not run because Go tooling is not installed in the execution environment. Cargo is likewise unavailable locally; the repository's Chronicle macOS CI job covers native Rust validation.
