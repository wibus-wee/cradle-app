# Plan 045: 收拢 Provider Catalog target-scoped 查询 seam

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's status row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e3d008c..HEAD -- apps/server/src/modules/provider-catalog apps/server/src/modules/model-registry apps/server/src/modules/conversation-bridge`
> If an in-scope file changed, compare it with the excerpts below. Any semantic
> mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/035-model-layer-unification.md` (core M0-M6 landed; reconcile status before execution)
- **Category**: perf, tests, tech-debt
- **Planned at**: commit `e3d008c`, 2026-07-14

## Why this matters

Plan 035 已把 inventory、enrichment、visibility、selection 的语义分开，但尚未形成跨 consumer 的 target-scoped query seam。Provider route 仍自行编排 target resolution、inventory fetch、cache write、registry enrichment 与 capability projection；Conversation Bridge 则直接读取 cache、解析 visibility，在 cold cache 时固定返回空模型列表。

本计划是 post-035 consolidation：Provider Catalog 统一查询 ordering 与 freshness policy；route 和 Bridge 只消费结果。Model Registry 继续独立拥有 models.dev/mapping/enrichment，Provider Targets 继续拥有 target/visibility persistence。

## Current state

- `apps/server/src/modules/provider-catalog/index.ts:24-47` route 自行执行 request parse → target projection → inventory → cache write/failure marker → registry enrichment → capability projection。
- `apps/server/src/modules/provider-catalog/service.ts:94-119` 另有 target resolution；`:129-193` 拥有 runtime/upstream/custom/default fallback；`:200-204` 又有非缓存 list projection。
- `apps/server/src/modules/provider-catalog/model-cache.ts:94-106` 名为 cache read 的函数隐式执行 registry enrichment 与 capability projection。
- `apps/server/src/modules/conversation-bridge/service.ts:290-315` 直接组合 target lookup、cache-only inventory 与 visibility JSON parsing；cold cache 时返回空列表。
- `apps/server/src/modules/model-registry/model-info-registry.ts:569-599` 已拥有唯一 enrichment matching order；`:658-664` 已提供 enrichment operation，不应迁入 Provider Catalog。
- `apps/server/src/modules/provider-catalog/model-cache.test.ts:15-26` 只覆盖 refresh-failure cooldown。
- `apps/server/src/modules/provider-catalog/catalog.test.ts` 主要覆盖 provider-specific upstream clients。
- `apps/server/src/modules/conversation-bridge/service.test.ts:93-108` 手动预热单一 cache；`:308-324` 只验证 warm-cache + all-visible success。

仓库约束：read across/write within；Model Registry 是独立 owner；不得新增 DB schema；cold/stale 是否访问 network 必须是显式 policy，不能使用 heuristic。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0, boundary check included |
| Catalog tests | `pnpm --filter @cradle/server exec vitest run src/modules/provider-catalog src/modules/conversation-bridge/service.test.ts --maxWorkers=1` | all tests pass |
| Provider integration tests | `pnpm --filter @cradle/server exec vitest run tests/sdk-providers.test.ts tests/profiles.test.ts --maxWorkers=1` | all present tests pass |
| Scoped lint | `pnpm exec eslint apps/server/src/modules/provider-catalog apps/server/src/modules/model-registry apps/server/src/modules/conversation-bridge/service.ts apps/server/src/modules/conversation-bridge/service.test.ts` | exit 0 |
| Diff hygiene | `git diff --check` | no output |

## Scope

**In scope**:

- `apps/server/src/modules/provider-catalog/**`
- the public enrichment operation in `apps/server/src/modules/model-registry/model-info-registry.ts` and `service.ts` only if needed to hide mapping pairing
- `apps/server/src/modules/conversation-bridge/service.ts`
- focused Provider Catalog and Conversation Bridge tests
- Provider Catalog / Conversation Bridge README ownership sections

**Out of scope**:

- Plan 035's inventory/enrichment/visibility/selection semantics redesign
- models.dev matching algorithm, mapping persistence, pricing, or model selection UX
- Provider Target DB schema/migrations
- Provider runtime adapters or external provider plugin contracts
- Web model picker behavior

## Git workflow

- Branch: `advisor/045-close-provider-catalog-query-seam`
- Suggested commit: `refactor(provider-catalog): centralize target model queries`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: 锁定跨 consumer 查询语义

先为 target-scoped query 增加表驱动 characterization tests。覆盖：warm fresh cache、warm stale cache、cold cache、explicit refresh、failure cooldown、upstream failure + custom/default fallback、visibility 的 all/subset/all-disabled、registry enrichment 与 capability projection。

断言返回 models、freshness metadata 与 upstream call count；不要断言内部 helper 调用顺序。增加 Bridge cold-cache case，证明当前路径返回空列表并作为待改变行为。

**Verify**: focused tests run; existing behavior is characterized and the intended cold-cache case initially fails for the documented reason.

### Step 2: 定义显式 target query policy

在 Provider Catalog public service API 中建立一个 target-scoped query。输入必须明确表达 freshness mode，建议使用三个稳定语义：

- `cached`: 只读 cache，不访问 upstream；
- `prefer-cache`: fresh cache 优先，cold/stale 时按明确规则 refresh；
- `refresh`: 无条件 live inventory fetch，仍遵守已存在的 explicit-refresh cooldown bypass semantics。

查询 owner 执行固定 pipeline：resolve target → select cache/fetch policy → collect inventory/custom/default fallback → persist inventory-only cache → ask Model Registry enrich → project provider capability → apply optional visibility → return models + freshness metadata。

不要让 `model-cache.ts` 隐式拥有 enrichment；它只读写 inventory row/fetchedAt/failure state。Model Registry public operation 应自行读取当前 mappings，调用方不再手工配对 resolver + `listMappingEntries()`。

**Verify**: table tests pass for all freshness modes; cache-only mode has zero upstream calls, refresh mode has exactly one.

### Step 3: 把 HTTP routes 变成薄 adapter

`POST /providers/models` 与两个 models-cache routes 只负责 schema/HTTP mapping，并调用 target query。删除 route 内 target reconstruction、cache write、enrichment 与 capability ordering。

保留已有 response shape，除非新的 freshness metadata 需要补齐当前 cache response；任何 response change 都必须同步 TypeBox、OpenAPI generation 和现有 consumers，不能添加兼容 envelope。

**Verify**: `rg -n "setCachedModels|enrichModelsFromRegistry|projectProviderModelListCapabilities|resolveProviderTarget" apps/server/src/modules/provider-catalog/index.ts` → no matches.

### Step 4: 让 Conversation Bridge 消费同一 query

删除 Bridge 内 target lookup、cache read 与 `enabledModelsJson` parsing。Bridge 使用 `prefer-cache` + visibility projection，并获得与其他 consumer 相同的 custom/default/enrichment/capability result。

明确控制交互的 latency policy：fresh cache 不访问 network；cold/stale 只进行一次受 existing cooldown 管理的 fetch。若 fetch 失败，使用 Provider Catalog 已定义 fallback/error，不自行返回另一套空模型语义。all-disabled 始终返回空，不触发无意义 fetch。

**Verify**: Conversation Bridge tests cover cold/warm/stale + three visibility modes and pass without manually prewarming cache for cold case.

### Step 5: 删除浅层 API 并更新文档

搜索所有 `getCachedModelsForTarget`/`collectProviderModelInventory` callers。只保留 Provider Catalog internal use；其他 domain 必须调用 public target query。若某 caller 确实只需 raw inventory，记录其 owner 并暴露有意命名的 inventory operation，而不是复用 projected cache result。

更新 README：Provider Catalog owns target resolution, freshness, inventory/cache orchestration, capability projection and fallback ordering；Model Registry owns enrichment semantics；Provider Targets owns stored visibility。

**Verify**: `rg -n "getCachedModelsForTarget|collectProviderModelInventory" apps/server/src/modules --glob '!provider-catalog/**'` → no cross-domain matches, or only explicitly documented raw-inventory consumers approved by maintainer.

## Test plan

- Provider Catalog table tests：freshness × cache state × fallback × visibility。
- Registry collaboration：mapping change affects cached inventory on read without cache rewrite。
- Route adapter tests：request/response mapping only。
- Bridge integration：cold cache、stale cache、subset、all disabled、upstream failure。
- 不新增浏览器测试，不依赖真实 provider network。

## Done criteria

- [ ] route 与 Conversation Bridge 共用一个 target-scoped query pipeline。
- [ ] cache module 只拥有 inventory persistence/freshness，不隐式 enrich/project。
- [ ] Model Registry 仍是 enrichment/mapping owner。
- [ ] cold-cache Bridge 不依赖其他 surface 预热即可列出合法模型或返回一致 fallback。
- [ ] network access 由显式 freshness mode 决定，无 timeout/猜测型 heuristic。
- [ ] 三种 visibility 语义在 route/Bridge 一致。
- [ ] focused/integration tests、typecheck、lint、diff check 通过。
- [ ] Plan 035 status 已先协调，`plans/README.md` 中 Plan 045 状态已更新。

## STOP conditions

- Plan 035 尚有正在执行且会修改相同 Provider Catalog 文件的工作；停止并先完成/reconcile 035。
- Bridge 产品要求严格 cache-only，禁止 cold fetch；停止并让 maintainer 选择 cached 或 prefer-cache policy。
- 收敛需要把 Model Registry mapping persistence 移入 Provider Catalog；停止，保持 owner seam。
- 发现某 runtime-owned inventory 无法通过 target query 表达；停止并记录其真实 contract，不添加 provider-kind heuristic。
- 任一验证连续两次失败，或需要 DB/schema/web scope change。

## Maintenance notes

- 新 consumer 应选择 freshness/visibility policy，而不是导入 cache internals。
- Reviewer 应检查 cold/stale network 行为、cooldown bypass、all-disabled short circuit 与 mapping ownership。
- 若未来加 SWR background refresh，应扩展明确 policy/result metadata，不在 route/Bridge 复制逻辑。
