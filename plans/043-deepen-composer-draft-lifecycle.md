# Plan 043: 完成 Composer Draft 生命周期所有权收敛

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's status row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e3d008c..HEAD -- apps/web/src/features/chat/composer apps/web/src/features/chat/commands/composer-draft-command.ts apps/web/src/hooks/use-composer-draft-sync.ts apps/web/src/store/composer-draft.ts apps/web/src/navigation/surface-resource-lifecycle.ts apps/server/src/modules/chat-runtime/composer-drafts.ts`
> If an in-scope file changed, compare it with the excerpts below. Any semantic
> mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/040-establish-web-state-authority.md` (DONE)
- **Category**: bug, tech-debt
- **Planned at**: commit `e3d008c`, 2026-07-14

## Why this matters

Composer 的可见 editor state、attachments、localStorage、server LWW row、write queue 与 surface discard 目前由多个调用方拼装。两个具体丢稿路径已经存在：同步 submit 返回 `false` 时，UI 草稿保持不变但持久化草稿仍被删除；surface 关闭时，Navigation 先写 tombstone，随后 hook unmount flush 又可能把待 debounce 草稿写回本地缓存。

目标状态是一个 chat-owned Draft lifecycle boundary：Composer 通过它执行 restore/change/submit/replace/clear，Navigation 只调用一次 `discardSurface`；serialized writes、tombstone 与 local cache ordering 不再暴露给调用方。Editor reducer 与 attachment acquisition 继续作为内部深模块，不通过合并文件来制造“收敛”。

## Current state

- `apps/web/src/features/chat/composer/composer.tsx:555-569` 调用 `submitAndClearDraft` 后无条件执行 `clearSyncedDraft()`。
- `apps/web/src/features/chat/composer/composer-submit.ts:108-136` 在同步 `false` 时直接返回；异步 reject/`false` 时恢复 editor，但无法撤销调用方已经发送的 server tombstone。
- `apps/web/src/hooks/use-composer-draft-sync.ts:130-147` 在 unmount 时 flush pending timer，并直接写 local store/server queue。
- `apps/web/src/navigation/surface-resource-lifecycle.ts:107-118` 自行组合 `markComposerDraftSurfaceDiscarded`、local delete 与 queued server delete。
- `apps/web/src/features/chat/commands/composer-draft-command.ts:28-109` 另行维护 discarded set 与 per-surface promise queues；discard 不拥有 hook 内的 debounce timer。
- `apps/web/src/store/composer-draft.ts` 是 feature-specific Zustand state，却放在全局 store namespace。
- `apps/web/src/hooks/use-composer-draft-sync.ts` 是 chat-specific reconciliation，却放在全局 hooks namespace。
- `apps/server/src/modules/chat-runtime/composer-drafts.ts:36-94` 已拥有 revision increment、LWW row 与 soft-delete tombstone；本计划不改变其 DB schema。
- `apps/web/src/features/chat/commands/composer-draft-command.test.ts:57-78` 只覆盖 discarded 后跳过 write/允许 delete；`use-composer-draft-sync.test.tsx` 没有 surface close + pending debounce + unmount 的交错测试。

仓库约束：React 组件按 feature domain 放置；不为覆盖率写组件测试；关键生命周期使用纯模块/hook 测试；attachments 不得被错误序列化进 server payload。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0, API boundary check included |
| Draft tests | `pnpm --filter @cradle/web exec vitest run src/features/chat/composer src/navigation/surface-resource-lifecycle.test.ts` | all tests pass |
| Scoped lint | `pnpm exec eslint apps/web/src/features/chat/composer apps/web/src/navigation/surface-resource-lifecycle.ts apps/web/src/navigation/surface-resource-lifecycle.test.ts` | exit 0 |
| Diff hygiene | `git diff --check` | no output |

## Scope

**In scope**:

- `apps/web/src/features/chat/composer/**`
- current `apps/web/src/features/chat/commands/composer-draft-command.ts` and its test, to be moved/deleted
- current `apps/web/src/hooks/use-composer-draft-sync.ts` and its test, to be moved/deleted
- current `apps/web/src/store/composer-draft.ts`, to be moved/deleted
- `apps/web/src/navigation/surface-resource-lifecycle.ts`
- `apps/web/src/navigation/surface-resource-lifecycle.test.ts` (create if absent)
- `apps/web/src/features/chat/README.md`

**Out of scope**:

- Composer visual design, prompt-editor behavior, slash/mention semantics, or runtime settings
- Persisting `FileUIPart` attachments across reloads; current server draft remains text + context parts
- Server DB schema or HTTP response changes
- Queue-item edit ownership outside its existing `externalSignals` contract
- Browser/E2E tests

## Git workflow

- Branch: `advisor/043-deepen-composer-draft-lifecycle`
- Suggested commit: `refactor(chat): centralize composer draft lifecycle`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: 先锁定丢稿与竞态行为

增加纯 helper/hook tests，至少覆盖：同步 submit 返回 `false` 不清 UI、不删 local/server draft；异步 reject/`false` 恢复原 snapshot；异步 pending 后用户输入新内容时旧 snapshot 不覆盖新输入；submit 成功只产生一次 tombstone；surface discard 在 pending debounce 时取消 write，并且 unmount 不复活 local draft。

使用 deferred promises 与 fake timers，不使用 wall-clock sleep。测试应断言可观察 state 与 write/delete 调用，不断言 React 内部 effect 次数。

**Verify**: 在改生产代码前运行新增 tests → 它们应以当前缺陷原因失败；记录失败断言，随后进入实现。

### Step 2: 把 Draft state、sync 与 transport 移入 chat/composer owner

在 `apps/web/src/features/chat/composer/draft/` 建立内部模块边界：

- local draft store：迁移当前 Zustand state；
- generated server adapter + per-surface serialized write queue；
- reconciliation hook：restore、debounce、replace、clear；
- lifecycle command：activate、discard、flush 与 submission settlement。

目录对外只暴露 Composer 需要的 hook 与 Navigation 需要的单个 `discardComposerDraftSurface(surfaceId)` operation。删除旧 global `hooks/`、`store/` 与 `commands/` 文件，不保留 forwarding alias。保持 server response projection 类型来自 generated API；不要增加新的 wire schema。

关键要求：debounce timer 与 discarded state 必须由同一 per-surface lifecycle owner 协调；discard 后任何已排队或 unmount-triggered write 都不能复活 local/server draft。

**Verify**: `rg -n "use-composer-draft-sync|store/composer-draft|commands/composer-draft-command" apps/web/src` → no matches after migration.

### Step 3: 将 submit settlement 纳入 Draft lifecycle

重构 `composer-submit.ts` 与 Composer 调用点，使“可见 UI 的 optimistic clear”和“持久化 tombstone”具有明确不同的 commit point：

- synchronous `false`: 什么都不清；
- synchronous accepted result: 清 UI/attachments 并提交 tombstone；
- async pending: 可以保持当前 optimistic UI clear，但持久化草稿在 promise accepted 前保留；
- async `false`/reject: 仅当用户没有开始更新版本的 draft 时恢复原 snapshot；持久化状态保持/恢复为原 draft；
- async accepted: 仅在 settlement 时提交一次 tombstone；
- stale settlement 不得清除其后产生的新 draft。

Submission snapshot 必须同时包含 text、context parts 与当前 attachments，以保证 UI rollback 一致；server/local persisted payload 仍只包含 text/context parts。不要用延迟时间猜测 settlement，使用显式 promise completion 与版本 token。

**Verify**: `pnpm --filter @cradle/web exec vitest run src/features/chat/composer` → all submit/draft tests pass.

### Step 4: 将 surface closure 改成单一 discard operation

`surface-resource-lifecycle.ts` 不再导入 Draft store、write queue 或 tombstone primitive；对关闭 surface 只调用 `discardComposerDraftSurface(surface.id)`。该 operation 必须按固定顺序完成：标记 discarded → 取消 debounce/阻止 future writes → 删除 local draft → enqueue server tombstone。

重复 discard 必须幂等；重新打开相同 surface ID 时，只有显式 activate 才允许新 writes。测试 close/reopen、重复 close 与 close during pending write。

**Verify**: `rg -n "markComposerDraft|queueServerComposerDraft|useComposerDraftStore" apps/web/src/navigation` → no matches.

### Step 5: 收紧 Composer 的外部 seam 与更新文档

Composer 内部可以继续组合 reducer、editor、attachments 与 draft hook；外部 props 不得新增 local-cache、queue 或 tombstone primitive。检查 `clearDraftKey`、`replaceDraftKey`、quick question 与 send variants 都经过相同 lifecycle transition。

更新 chat README，说明 Draft lifecycle owner、server/local authority、submission commit point、discard/tombstone ordering，以及 attachments persistence 明确不在当前 payload 内。

**Verify**: `pnpm --filter @cradle/web typecheck && pnpm exec eslint apps/web/src/features/chat/composer apps/web/src/navigation/surface-resource-lifecycle.ts` → exit 0.

## Test plan

- `composer-submit` pure tests：sync false、sync success、async false/reject/success、newer edit wins、attachment rollback。
- Draft lifecycle/hook tests：local restore、server tombstone、debounce、serialized writes、discard/unmount、reactivate。
- Navigation unit test：closed surface 只调用 public discard operation，不重现其内部 ordering。
- 复用现有 jsdom/fake-timer patterns；不新增视觉组件测试。

## Done criteria

- [ ] 同步/异步拒绝均不会删除仍可见或应恢复的持久化草稿。
- [ ] surface discard 后 pending debounce/unmount 无法复活 local/server draft。
- [ ] Navigation 只知道一个 Draft discard operation。
- [ ] Draft store、transport queue、reconciliation 均位于 chat/composer namespace。
- [ ] 旧 global hook/store/command 文件被删除且无 forwarding alias。
- [ ] Attachments 参与 submit rollback，但未被持久化进 server draft JSON。
- [ ] focused tests、web typecheck、scoped lint、`git diff --check` 全部通过。
- [ ] 无 scope 外文件被修改，`plans/README.md` 状态已更新。

## STOP conditions

- 正确修复需要改变 server draft payload/DB schema；停止并单独提出 contract plan。
- 某个 send handler 的返回语义不符合 `false = rejected, otherwise accepted`；停止并列出调用点，不得猜测。
- Queue-item edit 或 external host 依赖旧 command/store internal import；停止并先明确 owner，不保留兼容 re-export。
- 需要用 timeout/heuristic 判断 submit settlement 或 surface disposal；停止并改为显式 event/promise。
- 任一验证连续两次失败，或需要修改 scope 外业务模块。

## Maintenance notes

- 新的 Draft transition 应加入 lifecycle owner，而不是让 view/navigation 组合 store + transport calls。
- Reviewer 应重点检查 stale async settlement、discard/unmount ordering 与 attachment rollback。
- 若未来持久化 attachments，需要独立设计 size/security/serialization contract；不要直接把 data URL 写入现有 JSON row。
