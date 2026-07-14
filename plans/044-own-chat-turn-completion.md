# Plan 044: 建立 Chat Runtime 单一 turn completion owner

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's status row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e3d008c..HEAD -- apps/server/src/modules/chat-runtime/runtime.ts apps/server/src/modules/chat-runtime/run apps/server/src/modules/chat-runtime/lifecycle apps/server/tests/turn-executor.test.ts apps/server/tests/chat-runtime-recovery.test.ts`
> If an in-scope file changed, compare it with the excerpts below. Any semantic
> mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/024-chat-native-event-sourcing.md` (DONE), `plans/041-enforce-domain-and-lifecycle-ownership.md` (DONE)
- **Category**: bug, tests, tech-debt
- **Planned at**: commit `e3d008c`, 2026-07-14

## Why this matters

当前 “turn complete” 不是一个类型可见的生命周期，而是 durable terminal commit、terminal notification、usage/snapshot、release、queue drain 与 goal continuation 分散在多个 dependency bags 中的调用顺序。已有两个 correctness 风险：terminal commit 失败仍会向客户端广播 provider success；production dispatch 用 `void` 丢弃 executor rejection，可能触发 unhandled rejection/fatal process exit。

目标状态是单一 chat-runtime-owned completion owner：provider/runtime 只提交 outcome，owner 按固定 barrier 执行 pump → durable terminal → required post-terminal work → notify → release → handoff。Event store 与 provider seam 保持独立，不重做 Plan 024/041。

## Current state

- `apps/server/src/modules/chat-runtime/runtime.ts:169-197` 分别装配 stream、release 与 terminal finalizer；`:298-325` 再拼装 `TurnExecutorDeps` 和 `RunCoordinatorDeps`。
- `apps/server/src/modules/chat-runtime/runtime.ts:321-323` 通过 `void executeRunWithDeps(...)` 启动 run，没有 rejection handler。
- `apps/server/src/modules/chat-runtime/run/turn-executor.ts:69-117` 暴露 publish terminal、snapshot、release、drain、continuation 等阶段级 primitives。
- `apps/server/src/modules/chat-runtime/run/turn-executor.ts:149-195` 的 `finally` 保证 release/drain，但不会吸收 completion error。
- `apps/server/src/modules/chat-runtime/run/terminal-finalizer.ts:79` 在 durable commit 前设置 `activeRun.terminalStatus`；`:150-206` 把 commit error 记录后转换为 `null`；`:51-56` 仍把 terminal chunk 发布给客户端。
- `apps/server/src/modules/chat-runtime/run/turn-executor.ts:353-450` 在 terminal publication 后处理 usage 并吞掉该阶段错误；`:453-529` 再执行 binding、snapshot/profile 与 continuation。
- `apps/server/src/modules/chat-runtime/run/active-run-release.ts:33-60` 只释放 in-memory resources，不表达 durable/notification/handoff prerequisites。
- `apps/server/src/modules/chat-runtime/run/provider-synthetic-turn.ts` 也直接持有 terminal/release/drain primitives，必须迁移到同一 completion contract。
- `apps/server/src/modules/chat-runtime/run/run-coordinator.ts:69-78` 把 executor 定义为返回 `void`，无法监督 lifecycle promise。
- `apps/server/tests/turn-executor.test.ts:74-92` 复制完整 dependency bag；`:165-188` 只验证 throw 后 release/drain 次数，没有验证 durable commit 与 notification 顺序。

Plan 024 已建立 versioned terminal facts/projection；Plan 041 已建立进程级 runtime shutdown owner。它们没有覆盖单次 turn completion，因此本计划是后续收敛而非重复实现。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0, boundary check included |
| Lifecycle tests | `pnpm --filter @cradle/server exec vitest run tests/turn-executor.test.ts tests/chat-runtime-recovery.test.ts src/modules/chat-runtime/run --maxWorkers=1` | all tests pass |
| Full chat-runtime tests | `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/chat-runtime-recovery.test.ts --maxWorkers=1` | all tests pass |
| Scoped lint | `pnpm exec eslint apps/server/src/modules/chat-runtime/runtime.ts apps/server/src/modules/chat-runtime/run apps/server/src/modules/chat-runtime/lifecycle apps/server/tests/turn-executor.test.ts` | exit 0 |
| Diff hygiene | `git diff --check` | no output |

## Scope

**In scope**:

- `apps/server/src/modules/chat-runtime/runtime.ts`
- `apps/server/src/modules/chat-runtime/run/**`
- directly affected `apps/server/src/modules/chat-runtime/lifecycle/**`
- `apps/server/tests/turn-executor.test.ts`
- focused chat-runtime recovery/race tests only where lifecycle assertions belong
- `apps/server/src/modules/chat-runtime/README.md`

**Out of scope**:

- Event schema/version changes, projector redesign, DB schema, or migration
- Provider adapter protocols and provider-specific stream implementations
- Queue business policy, runtime-goal product policy, usage pricing semantics
- Process-level shutdown registry from Plan 041
- Web chat rendering or SSE protocol redesign

## Git workflow

- Branch: `advisor/044-own-chat-turn-completion`
- Use logical commits, for example `test(chat-runtime): characterize completion barriers` then `refactor(chat-runtime): centralize turn completion`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: 用业务 barrier 建立 characterization net

新增高层 lifecycle tests，使用 deferred promises + ordered event recorder，覆盖：

1. terminal facts/projection commit 完成后才能发布 terminal notification；
2. required post-terminal work 完成后 completion promise 才 resolve；
3. release 在 queue/goal handoff 之前且只发生一次；
4. durable commit failure 不发布 provider success；
5. dispatch owner 观察 executor rejection，不产生 `unhandledRejection`；
6. cancel race、provider synthetic turn、empty output 与 stale write fence 使用同一 completion barrier。

断言业务阶段，不锁定内部 helper 名称。保留现有 Plan 012 regression：任何异常都必须最终释放一次；但 durable terminal 未成立时不得直接 drain queue。

**Verify**: 在改实现前运行新增 failure-injection tests → 当前实现应按上述具体 barrier 失败；记录失败原因。

### Step 2: 让 durable terminal commit 成为唯一终态门槛

调整 terminal finalization：

- durable commit 前不得设置 `activeRun.terminalStatus`；
- commit helper 不得 catch-and-return-null；失败必须回到 lifecycle owner；
- provider success/abort/error terminal chunk 只在对应 terminal facts + projection commit 成功后发布；
- profile/trace 只能记录实际 durable outcome，不能记录未落盘 success；
- write fence 已 terminal 时，继续复用 canonical fence outcome。

选择确定性 failure policy：terminal commit 失败时，不做 timeout/retry heuristic，不发布 provider success；释放 in-memory resources后调用现有 interrupted-stream recovery path。只有 recovery 成功形成 durable terminal 后才能 handoff queue。若 recovery也失败，记录稳定 observability incident，保持队列不启动，等待显式恢复/进程重启。

**Verify**: focused failure-injection test → commit rejects, success chunk count is 0, release count is 1, queue handoff is 0 until recovery succeeds.

### Step 3: 建立唯一 completion owner 与窄接口

在 `run/` 内建立/重构一个 public turn lifecycle operation。保留 stream controller、terminal persistence、snapshot、release 等内部模块，但只有 lifecycle owner 可排列它们。`runtime.ts` 只装配一个高层 owner；`TurnExecutorDeps` 中可任意排序的 `publishTerminalChunk`、`releaseActiveRun`、`scheduleQueueDrain` 组合必须从调用 surface 消失。

明确阶段与 error policy：

- pump outcome；
- required durable terminal commit；
- required completion bookkeeping 与明确标记为 best-effort 的 usage/profile/trace；
- terminal notification；
- idempotent release；
- queue drain 或 runtime-goal continuation handoff。

不要把所有实现合并到一个大文件；“深”来自窄 public seam 与内部 ordering ownership。Event store 继续拥有 fact commit，provider adapters 继续拥有 stream production。

**Verify**: `rg -n "publishTerminalChunk|releaseActiveRun|scheduleQueueDrain" apps/server/src/modules/chat-runtime/run` → matches only inside the lifecycle owner and explicitly internal adapters/tests, not provider/synthetic/coordinator callers.

### Step 4: 迁移 normal、cancel、synthetic 与 recovery paths

让 normal executor、cancel settlement、provider synthetic turn 与 stale/recovery path 都提交 typed outcome 给同一 owner。删除各路径自行 publish + release + drain 的 ordering。保留每种 outcome 的现有 terminal fact、stop reason 与 UI chunk 映射。

`RunCoordinatorDeps.executeRun` 必须返回 `Promise<void>`（或等价可观察 handle）；production dispatch 必须附加 catch，记录包含 session/run/runtime context 的稳定 observability error。不要在 dispatch catch 再次 release/drain，避免与 owner finally 双重清理。

**Verify**: focused tests prove all four paths each emit one durable terminal, one notification, one release, and at most one handoff.

### Step 5: 缩小测试 fixture 与更新 ownership 文档

测试应构造高层 lifecycle ports，而不是重建完整 `TurnExecutorDeps` bag。保留少量 stream-pump unit tests；ordering/race/failure tests 走 public lifecycle operation。更新 chat-runtime README，记录 required/best-effort stages、durability barrier、recovery failure policy 与 queue handoff prerequisite。

**Verify**: `pnpm --filter @cradle/server exec vitest run tests/turn-executor.test.ts tests/chat-runtime-recovery.test.ts src/modules/chat-runtime/run --maxWorkers=1 && pnpm --filter @cradle/server typecheck` → all pass.

## Test plan

- Deferred ordering tests：commit → notify → release → handoff。
- Failure injection：terminal commit、recovery、snapshot/usage、dispatch rejection。
- Idempotency：cancel vs natural finish、synthetic vs provider finish、stale fence。
- Recovery integration：DB 中 streaming run 只在 durable recovery 后允许 queue handoff。
- 不使用 sleeps；不 mock provider internals beyond stream/outcome port。

## Done criteria

- [ ] durable terminal commit 失败时绝不广播 provider success。
- [ ] production dispatch 无 floating/rejected promise。
- [ ] normal/cancel/synthetic/recovery 共用一个 completion owner。
- [ ] terminal notification、release、queue/goal handoff 顺序由 tests 锁定。
- [ ] release 对所有 failure paths 恰好一次；durability 未恢复时不 drain queue。
- [ ] `runtime.ts` 不再装配多个重叠阶段级 dependency bags。
- [ ] Event-store/provider seams 未被吞并，DB/event schemas 未变化。
- [ ] focused/full chat-runtime verification、typecheck、lint、diff check 通过。
- [ ] `plans/README.md` 状态已更新。

## STOP conditions

- 修复要求新增/改变 terminal event schema 或 DB migration；停止并先设计 Event Sourcing migration。
- 现有 recovery path 无法在不启动新 run 的情况下收敛 persisted streaming state；停止并报告所需的 recovery contract。
- 某 provider synthetic path 需要不同 durable terminal semantics；停止并记录 provider contract，不复制第二套 lifecycle。
- 需要 timeout/retry heuristic 处理 terminal commit；停止并向 maintainer 提出明确 policy 选择。
- 任一 verification 连续两次失败，或实现需要修改 provider/web scope。

## Maintenance notes

- 新的 completion stage 必须声明 required 或 best-effort，并接入 lifecycle ordering tests。
- Reviewer 应重点检查 terminalStatus 设置时机、failure path queue handoff 与 dispatch catch 是否重复 cleanup。
- 未来 queue、goal continuation 或 usage 演进只能消费 durable completion result，不能重新获得阶段级 primitives。
