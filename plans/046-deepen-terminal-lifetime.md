# Plan 046: 深化 Terminal lifetime ownership

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's status row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e3d008c..HEAD -- apps/web/src/features/tui apps/web/src/features/browser/browser-panel.tsx apps/web/src/navigation/surface-resource-lifecycle.ts apps/server/src/modules/pty apps/server/tests/pty.test.ts apps/server/tests/pty-websocket.test.ts`
> If an in-scope file changed, compare it with the excerpts below. Any semantic
> mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/041-enforce-domain-and-lifecycle-ownership.md` (DONE)
- **Category**: tests, tech-debt
- **Planned at**: commit `e3d008c`, 2026-07-14

## Why this matters

Terminal 当前有两个合理 adapter（bottom panel 与 Browser Panel CLI TUI），但 stop、detach/park、natural exit、owner disposal 的决定散落在 view flag、panel handler、cleanup helper 与 Navigation。重复 fire-and-forget DELETE 全部吞错，UI state 与 PTY resource state 没有一个 owner 定义一致的 ordering。

目标状态是一个 web TUI domain 内的 Terminal lifetime module：adapter 只声明 register/attach/park/stop/dispose intent；模块拥有 per-terminal idempotency、in-flight stop coalescing 与 owner disposal。Bottom shell 与 CLI TUI 的差异保留，server PTY runtime/lease 继续拥有进程级资源。

## Current state

- `apps/web/src/features/tui/shell-view.tsx:53-68` 暴露 `stopOnUnmount` flag；`:450-455` 根据 view flag 直接 DELETE 后关闭 channel。
- `apps/web/src/features/tui/bottom-terminal-panel.tsx:49-56` 手工 DELETE → remove store → close panel，并吞掉 DELETE error。
- `apps/web/src/features/tui/terminal-panel-cleanup.ts:5-12` remove owner 后逐项 DELETE，同样吞错。
- `apps/web/src/navigation/surface-resource-lifecycle.ts:99-104` 对 Browser Panel TUI 再次直接 DELETE；`:122-138` 还分别知道 terminal owner cleanup 与 browser owner ordering。
- `apps/web/src/features/browser/browser-panel.tsx:3108-3115` 用 `stopOnUnmount={false}` 表达“tab view unmount 只 park，不 stop”。
- `apps/web/src/features/tui/terminal-panel-store.ts:120-177` store mutation 返回 count/session list，让调用方决定 resource cleanup。
- `apps/server/src/modules/pty/service.ts:95-120` server 已在最后 socket detach 后启动 30 秒 lease；`:446-450` explicit stop 是幂等 destroy path。
- `apps/server/src/modules/pty/index.ts:145-155` DELETE 是明确 HTTP resource lifecycle seam。
- `apps/web/src/features/tui/terminal-panel-store.test.ts` 只验证 store shape；没有 stop coalescing、park-vs-stop、owner disposal ordering 或 failure policy tests。
- Architecture review 引用的 `apps/web/src/features/tui/tui-runtime-registry.ts` 在当前 commit 已不存在；不得为匹配旧图重新创建同名浅层 registry。

仓库约束：不写无价值组件测试；生命周期 critical path 使用纯 controller tests；不得用 timeout heuristic；不得抹平 bottom panel 与 CLI TUI 的 adapter 差异。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0, API boundary check included |
| TUI tests | `pnpm --filter @cradle/web exec vitest run src/features/tui src/navigation/surface-resource-lifecycle.test.ts` | all tests pass |
| Server PTY tests | `pnpm --filter @cradle/server exec vitest run tests/pty.test.ts tests/pty-websocket.test.ts --maxWorkers=1` | all tests pass |
| Scoped lint | `pnpm exec eslint apps/web/src/features/tui apps/web/src/navigation/surface-resource-lifecycle.ts apps/web/src/features/browser/browser-panel.tsx` | exit 0 |
| Diff hygiene | `git diff --check` | no output |

## Scope

**In scope**:

- `apps/web/src/features/tui/**`
- targeted Terminal call sites in `apps/web/src/features/browser/browser-panel.tsx`
- `apps/web/src/navigation/surface-resource-lifecycle.ts` and focused unit test
- `apps/web/src/features/tui/README.md`
- server PTY tests only if an existing idempotency/lease contract needs characterization

**Out of scope**:

- xterm rendering, theme/font/image addons, keyboard mappings, transcript behavior
- PTY WebSocket protocol redesign or server registry rewrite
- Server lease duration/config changes
- Browser Panel ownership beyond TUI tabs
- Persisting bottom-panel tabs across app restart
- Browser/E2E tests

## Git workflow

- Branch: `advisor/046-deepen-terminal-lifetime`
- Suggested commit: `refactor(tui): centralize terminal lifetime ownership`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: 定义并测试 lifetime state table

先写纯 controller characterization tests，定义以下 intent：

| Event | Bottom panel | Browser CLI TUI | HTTP DELETE |
| --- | --- | --- | --- |
| active view unmount/tab switch | park | park | no |
| user closes terminal/tab | stop | stop | once |
| owner surface closes | dispose owner | dispose owner | once per live terminal |
| natural process exit | remove UI record | remove UI record | no redundant delete |
| duplicate stop/dispose | idempotent | idempotent | coalesced |

使用 deferred DELETE promises 验证 concurrent stop coalescing；显式测试 failure 后状态允许 operator retry。不要依赖 server 30 秒 lease 或 fake sleep 来判断 web policy。

**Verify**: 新 tests 在改生产代码前按当前重复/分散调用点失败，并明确记录失败断言。

### Step 2: 建立 Terminal lifetime controller

在 `features/tui/` 建立单一 lifetime owner，内部维护最小 per-terminal record：terminal ID、adapter kind、owner ID、phase 与 in-flight stop promise。公开 operation 应表达 register、attach、park、stop、recordExited、disposeOwner；不要暴露 raw DELETE 或 store mutation ordering。

Controller 调用 generated PTY adapter，并保证：

- repeated/concurrent stop 共用一个 request；
- successful stop 将 record terminal；
- failed stop 不伪装成功，保留可 retry state；
- natural exit 不发 redundant DELETE；
- owner disposal 对 snapshot 中的 terminals 各执行一次 stop；
- park 只关闭 view/channel attachment，由 server lease 提供 crash safety。

复用已有 store/browser tab IDs；不要创建第二套 UI state store，也不要重建已删除的 `tui-runtime-registry.ts`。

**Verify**: pure lifetime tests pass, including concurrent stop and failure/retry.

### Step 3: 让 ShellView 成为纯 attach/park adapter

删除 `stopOnUnmount` prop 与 view 内 DELETE import。ShellView mount 负责 start/attach + channel；unmount 始终 park/detach，是否 stop 由 owning adapter 显式调用 lifetime controller。Natural exit 先通知 controller `recordExited`，再通知 UI adapter 移除 tab/session。

保留 server start-or-attach HTTP seam，但将其调用通过 lifetime owner 或专用内部 adapter，避免 view 同时拥有 transport pairing 与 lifecycle decision。

**Verify**: `rg -n "stopOnUnmount|deleteTerminalSessionsShellByPtyId" apps/web/src/features/tui/shell-view.tsx` → no matches.

### Step 4: 迁移 bottom panel 与 Browser CLI TUI adapter

Bottom panel：register session 时登记 owner/adapter；manual close 走 `stop`，成功后移除 UI。失败时保持可操作 tab 并显示现有 toast/error surface，不静默丢失 handle。关闭最后一个成功停止的 session 后再关 panel。

Browser CLI TUI：create/close/owner release 走相同 controller，但保留 Browser Panel tab state owner。tab switch/unmount 只 park；user close 或 surface close 才 stop。只修改 Browser Panel 中 TUI creation/removal/exit 的 targeted functions，不重构整个 god component。

**Verify**: `rg -n "deleteTerminalSessionsShellByPtyId|stopOnUnmount" apps/web/src/features/tui apps/web/src/features/browser/browser-panel.tsx` → no direct call/flag remains outside the lifetime module.

### Step 5: 简化 Navigation 与 store return contracts

Navigation 只计算 closed owner IDs / closed TUI IDs 并调用 lifetime owner 的 `disposeOwner`/`stop`; 不再直接调用 generated DELETE。Bottom store 不再返回“由调用方清理”的 session list 作为隐式 protocol；它只拥有 UI state transition，lifetime controller owns resource transition。

如果 owner disposal 是异步 fire-and-forget，必须在 lifetime module 内观察 rejection并记录 context；Navigation 不吞 promise。不要让 failure 导致 unhandled rejection。

**Verify**: `rg -n "deleteTerminalSessionsShellByPtyId|removeOwner\(.*\).*sessions" apps/web/src/navigation apps/web/src/features/tui` → raw transport absent; no store-return cleanup protocol remains.

### Step 6: 更新 tests 与 ownership 文档

保留 store unit tests 只验证 UI state；新增 controller tests 验证 resource lifecycle；现有 server PTY tests继续证明 explicit delete emits exit、重复 delete安全、socket detach lease不立即 stop。

更新 TUI README，记录两个 adapters、lifetime state table、server lease/explicit delete seam、failure policy 与 ownership boundary。

**Verify**: web TUI tests、server PTY tests、web typecheck 与 scoped lint 全部通过。

## Test plan

- Lifetime controller：register/attach/park/stop/exit/dispose、duplicate stop、concurrent stop、failure retry。
- Bottom store：UI session transitions only，不断言 HTTP。
- Navigation：closed owners/PTY selection + one public lifecycle call。
- Server PTY：保留 explicit delete/exit 与 lease tests；只有 contract 缺口时才增补。
- 不新增 xterm component/browser tests。

## Done criteria

- [ ] ShellView 不再决定 stop，不再接受 `stopOnUnmount`。
- [ ] raw PTY DELETE 只存在于 Terminal lifetime adapter。
- [ ] bottom panel 与 Browser CLI TUI 保留独立 UI adapter，共用 lifetime owner。
- [ ] concurrent/repeated stop 只发送一次 DELETE；failure 可 retry 且不静默丢 UI handle。
- [ ] natural exit 不发送 redundant DELETE；park 不 stop backing PTY。
- [ ] Navigation/store 不再组合 resource cleanup ordering。
- [ ] web/server focused tests、typecheck、lint、diff check 通过。
- [ ] 无 scope 外重构，`plans/README.md` 状态已更新。

## STOP conditions

- 产品要求 manual close 在 DELETE 失败时仍立即丢弃 UI handle；停止并让 maintainer选择 failure UX。
- Browser CLI TUI 与 bottom panel 实际需要不同 server stop semantics；停止并记录 adapter-specific contract，不用 boolean flag 隐藏差异。
- 需要改变 server lease duration/protocol 才能表达 park；停止并拆出 PTY protocol plan。
- 需要重构整个 Browser Panel 才能迁移 targeted call sites；停止并缩小 seam。
- 任一验证连续两次失败，或实现依赖 timeout heuristic。

## Maintenance notes

- 新 Terminal surface 必须实现 adapter intent，不得直接调用 PTY DELETE。
- Reviewer 应重点检查 stop coalescing、failure retry、natural exit 与 surface disposal 的交错。
- Server lease 是断连安全网，不是 web 正常生命周期 ordering 的替代品。
