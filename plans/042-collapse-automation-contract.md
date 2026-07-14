# Plan 042: 收敛 Automation 契约与数据查询路径

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's status row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e3d008c..HEAD -- apps/server/scripts apps/server/src/modules/automation apps/server/tests/automation.test.ts apps/web/scripts/check-api-gen-boundaries.ts apps/web/src/api-gen apps/web/src/features/automation`
> If any in-scope file changed, compare the current-state excerpts below with
> live code. Any semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/040-establish-web-state-authority.md` (DONE)
- **Category**: bug, perf, tech-debt
- **Planned at**: commit `e3d008c`, 2026-07-14

## Why this matters

Automation 是当前唯一仍通过原生 `fetch` 绕过统一认证传输的主要 feature：服务端启用认证后，Electron token 与跨源浏览器 cookie 都不会被带上，Dashboard 会整体收到 401。与此同时，同一 wire contract 被 server TypeBox、生成绑定、feature Zod 与宽松本地接口重复描述；列表再为每个 definition 拉取完整 run history，形成 1+N 请求与全有或全无的失败耦合。

目标状态是：server Automation 模块拥有 HTTP contract 与 latest-run 列表投影；生成 SDK 是唯一 wire adapter；web Automation data module 只拥有 query、projection、invalidation 与 UI view state，不再容忍未声明 envelope 或字段别名。

## Current state

- `apps/web/src/features/automation/api-client.ts:146-161` 直接调用原生 `fetch`，自行拼接 URL、header 与错误文本。
- `apps/web/src/lib/client.config.ts:8-15` 已为生成客户端统一配置 token、`cradleFetch`、base URL 与 `throwOnError`。
- `apps/server/src/http/auth.ts:113-133` 对健康检查/OpenAPI 之外的请求执行全局认证。
- `apps/web/scripts/check-api-gen-boundaries.ts:16-19` 把 Automation raw fetch 保留为历史基线。
- `apps/web/src/features/automation/api-client.ts:7-144` 复制完整 Zod wire schema，并接受 `automations`、`definitions`、`items`、`data` 等 server 从未声明的 envelope。
- `apps/web/src/features/automation/types.ts:3-99` 将精确状态扩宽到 `string`，并加入 server contract 不存在的 `skipped`、`triggerJson`、`recipeJson`、`automationId`、`definitionId` 等兼容字段。
- `apps/server/src/modules/automation/model.ts:166-218` 已定义 definition、run、artifact 的权威响应 schema。
- `apps/web/src/api-gen/types.gen.ts:4569-4592` 仍把单值 literal（如 trigger `type`、recipe `kind`）生成为 `string`；`apps/server/scripts/export-openapi.ts:64-121` 只归一化 `anyOf` const union，没有归一化独立 `const` schema。
- `apps/web/src/features/automation/api-client.ts:164-172` 对每个 definition 调用 runs endpoint；`listAutomationRuns(..., 1)` 在客户端下载完整数组后才 `slice`。
- `apps/server/src/modules/automation/service.ts:368-386` definition list 只读 definitions；`:746-755` run list 返回指定 definition 的全部历史。
- `apps/web/src/features/automation/use-automations.ts` 已是 TanStack Query owner，但 Dashboard 仍直接组合 triage、runs 与 artifacts 查询。

仓库约束：数据库访问必须使用 Drizzle；不得新增兼容 shim；应信任修复后的生成类型，不再新增另一套 Zod/type projection；本计划不修改数据库 schema。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Generate web client | `pnpm generate:web` | exit 0; generated files updated deterministically |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0, including boundary check |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0, including API boundary check |
| Focused server tests | `pnpm --filter @cradle/server exec vitest run tests/automation.test.ts` | all tests pass |
| Focused web tests | `pnpm --filter @cradle/web exec vitest run src/features/automation` | all tests pass |
| Lint scoped files | `pnpm exec eslint apps/server/scripts apps/server/src/modules/automation apps/server/tests/automation.test.ts apps/web/scripts/check-api-gen-boundaries.ts apps/web/src/features/automation` | exit 0 |

## Scope

**In scope**:

- `apps/server/scripts/export-openapi.ts` and a focused normalizer test/helper if extraction is needed
- `apps/server/src/modules/automation/model.ts`
- `apps/server/src/modules/automation/service.ts`
- `apps/server/src/modules/automation/index.ts`
- `apps/server/src/modules/automation/README.md`
- `apps/server/tests/automation.test.ts`
- generated Automation sections in `apps/web/src/api-gen/**`
- `apps/web/scripts/check-api-gen-boundaries.ts`
- `apps/web/src/features/automation/**`

**Out of scope**:

- Automation scheduler, poller, execution semantics, persistence schema, or migrations
- Cron compatibility routes and generated CLI command design, except adapting their shared response schema if generation requires it
- Browser/component E2E tests
- A repository-wide raw-fetch migration

## Git workflow

- Branch: `advisor/042-collapse-automation-contract`
- Commit style follows current history, for example `refactor(automation): collapse generated contract path`.
- Do not push or open a PR unless instructed by the operator.

## Steps

### Step 1: 修复 OpenAPI 单值 literal 保真

扩展 OpenAPI export 的 schema normalization：独立 `{ const: "value" }` 必须转换为 OpenAPI-compatible `{ type: "string", enum: ["value"] }`，现有 const-union 与 nullable 行为保持不变。优先把纯 normalizer 提取为可直接单测的 helper；不要在生成文件上做字符串替换。

至少覆盖：独立 string const、const union、nullable const union、非 string const/普通 object 不被错误改写。随后运行生成，并用 compile-time assertion 或生成文件断言证明以下类型不再扩宽：trigger `type` 为 `'rrule'`、recipe `kind` 为 `'agent_task'`、completion `stopWhen` 为 `'agent_complete'`、input discriminant 保留四个 literal。

**Verify**: `pnpm generate:web && rg -n "type: 'rrule'|kind: 'agent_task'|stopWhen\?: 'agent_complete'" apps/web/src/api-gen/types.gen.ts` → generation exits 0 and all three literal forms are present.

### Step 2: 由 server 批量投影 latest run

为 definition list 定义明确的 summary response（definition + `latestRun: AutomationRun | null`）。在 `service.ts` 使用 Drizzle 批量读取当前列表涉及的 definition runs，并按 definition ID 取排序后的第一条；请求数量必须恒定，禁止循环逐项查询。空列表不得执行无意义的 run query。

保持 create/get/update 的 definition response 不变；只有 list route 返回 summary schema。不要添加 dashboard 专用 endpoint，也不要修改 DB schema。为 0、1、多个 definitions、无 run 与多 run 排序添加 server 集成测试。

**Verify**: `pnpm --filter @cradle/server exec vitest run tests/automation.test.ts` → list response includes the correct latest run or `null`, all focused tests pass.

### Step 3: 建立生成 SDK 驱动的 feature gateway

在 `apps/web/src/features/automation/api/` 建立 Automation gateway，内部只调用 `sdk.gen.ts` 的 Automation operations。请求/响应类型从 `types.gen.ts` 派生；仅允许为真正的 UI 聚合定义 view type，不得复制 wire fields。

删除 raw `requestAutomationJson`、feature Zod wire schemas、未声明 envelope 兼容与宽松 alias fields。服务端 Elysia response schema 与生成类型共同作为 contract boundary；不要再新增另一套运行时 Zod 镜像。删除 `RAW_FETCH_BASELINE` 中 Automation 条目，并保持生成客户端的认证/错误语义。

**Verify**: `pnpm --filter @cradle/web check:api-boundaries && rg -n "\bfetch\(|z\.object|triggerJson|recipeJson|AutomationRunStatus \| string" apps/web/src/features/automation` → boundary check passes and grep returns no matches.

### Step 4: 深化 Automation query 与 invalidation owner

让 `use-automations.ts`（或同 domain 的 data module）拥有 definitions、runs、artifacts、triage 的 query factories、query keys 与 mutation invalidation。Dashboard 只消费 hooks 和已投影数据，不直接导入 transport functions，不自行拼装 `['automations', ...]` keys，也不再实现 latest-run fallback ordering。

保留按选中 definition 加载完整 history/artifacts 的按需查询；列表直接读取 server-projected `latestRun`。Mutation invalidation 必须覆盖 definition summary、选中 run list、artifacts 与 triage 的真实消费者，避免字符串 key 漂移。

**Verify**: `rg -n "from './api|queryKey: \['automations'|getLatestRun" apps/web/src/features/automation/automation-dashboard.tsx` → no direct transport import, ad-hoc Automation key, or latest-run ordering helper remains.

### Step 5: 重写特征测试与文档

把现有 mock-`fetch` 测试改为 gateway/generated-SDK boundary tests，并增加：多 definition 列表只发一次 list 请求；认证传输由生成 client config 负责；server 只接受声明 response shape；mutation invalidation 覆盖对应 keys；single definition run failure 不再使 definition list 消失。

更新 server/web Automation README，明确 server 拥有 contract、scheduling、persistence、latest-run projection；web data module 拥有 generated adapter、query、UI projection 与 invalidation。

**Verify**: `pnpm --filter @cradle/web exec vitest run src/features/automation && pnpm --filter @cradle/web typecheck` → focused tests and typecheck pass.

## Test plan

- OpenAPI normalizer：standalone const、union、nullable 与 no-op cases。
- Server Automation：多 definition 的 latest run 正确性、无 run、排序、workspace filter。
- Web gateway：generated method options/body/path 透传、错误传播，不 mock 原生 fetch。
- Query module：definitions/runs/artifacts/triage keys 与 mutation invalidation。
- 不新增组件快照或浏览器测试。

## Done criteria

- [ ] `pnpm generate:web` 后 Automation discriminants 保持 literal 类型。
- [ ] Automation web 请求全部经过 generated SDK/authenticated client。
- [ ] `RAW_FETCH_BASELINE` 不再包含 Automation。
- [ ] feature-local Zod wire mirror、宽松 envelope 与 alias fields 被删除。
- [ ] definition list 的 HTTP/DB 查询数量不随 definition 数量线性增长。
- [ ] Dashboard 不直接拥有 transport、latest-run ordering 或 ad-hoc invalidation。
- [ ] server/web focused tests、typecheck、boundary checks 与 scoped lint 通过。
- [ ] `git diff --check` 通过，且无 scope 外文件被修改（生成文件除已列明部分）。
- [ ] `plans/README.md` 中 Plan 042 状态已更新。

## STOP conditions

- 生成器在正确 OpenAPI enum 后仍把 discriminant 扩宽为 `string`；停止并报告生成器版本/最小复现，不得恢复手写类型镜像。
- latest-run 批量投影需要 DB migration 或 raw SQL；停止并报告，优先重新设计 Drizzle 查询。
- 发现已有外部消费者依赖未声明 envelope/alias fields；停止并列出消费者，不得保留静默兼容 shim。
- 需要改动 Automation execution/scheduling semantics 才能完成列表投影；停止并拆分范围。
- 任一验证连续两次失败，或需要修改 scope 外业务模块。

## Maintenance notes

- Automation response 字段未来只应从 server schema 演进并重新生成客户端，不再手工同步 web wire types。
- Reviewer 应重点检查 OpenAPI normalizer 是否误改非 string const、latest-run 查询是否恒定、以及 generated gateway 是否确实使用统一 client。
- 若未来加入分页，definition summary 与 run history 应分别分页；不要重新引入客户端逐项聚合。
