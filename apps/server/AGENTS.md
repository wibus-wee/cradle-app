# Cradle Server Agent Guide

本文件描述 `apps/server` 的当前实现。编辑 server 代码时，以这里的 Elysia 架构、目录边界和验证命令为准。

## 当前架构

Cradle server 是一个 Elysia 应用：

- `src/app.ts` 负责创建 Elysia app、注册 HTTP 插件、组合业务模块，并挂载运行期 `onStop` 清理。
- `src/index.ts` 负责进程启动、配置读取、监听端口、fatal handler、telemetry 初始化与 graceful shutdown。
- `src/infra.ts` 提供懒加载基础设施单例，包括 server config、logger、Drizzle database provider 和迁移执行。
- `src/http/` 放跨模块 HTTP concerns：auth、request id、request logger、OpenAPI、error mapping、validation、actor context。
- `src/modules/*` 放业务能力模块。每个模块拥有自己的 route composition、model/schema、service/business logic 和模块 README。
- `src/errors/app-error.ts` 是业务错误契约，`src/http/error-mapping.ts` 是 HTTP 响应映射边界。
- `src/config/`、`src/database/`、`src/logging/`、`src/telemetry/`、`src/observability/` 是横切基础设施。
- `src/plugins/` 是 server plugin loading/runtime support，不属于普通业务模块。

`createServerContractApp()` 组合纯 HTTP contract surface；`createServerApp()` 在 contract app 之上启动 runtime-only concerns，例如 plugins、background tasks、provider runtime、relay host connector 和 cleanup hooks。

## 目录职责

```text
apps/server/src/
  app.ts                    # Elysia app composition
  index.ts                  # process bootstrap and shutdown
  infra.ts                  # lazy infra singletons
  config/                   # server configuration
  database/                 # Drizzle provider and migrations runner
  errors/                   # AppError contract
  http/                     # HTTP plugins, auth, error mapping, validation, OpenAPI
  logging/                  # logger setup
  modules/                  # business capabilities
  observability/            # event contracts and service
  plugins/                  # plugin loading and trust/runtime helpers
  telemetry/                # OpenTelemetry bootstrap
```

模块内部通常按以下方式拆分：

```text
modules/<capability>/
  index.ts                  # Elysia routes and OpenAPI metadata
  model.ts                  # TypeBox schemas and response models
  service.ts                # business logic
  README.md                 # module ownership and behavior notes
```

大型模块可以继续拆分子目录，但需要保持 ownership 清晰：route 文件只负责 HTTP shape，service 文件负责业务语义，infra/database access 不应散落在 route handler 中。

## Elysia 模块组合规则

- 业务模块导出一个 `new Elysia({ prefix, detail })` 实例或一个注册函数，并在 `src/app.ts` 中通过 `app.use(module)` 或显式 register 函数组合。
- `src/app.ts` 是 composition root：可以排序、组合、注册全局插件，但不要放业务逻辑。
- 新 HTTP route 应使用 Elysia + TypeBox 的 schema 约束 `body`、`query`、`params`、`response`。
- OpenAPI metadata 放在 route `detail` 中，至少包含稳定 `summary`；CLI 暴露的 route 使用 `x-cradle-cli` metadata。
- 需要生成 CLI 命令的 API，应复用现有 route metadata 模式，而不是在 CLI 层手写另一个协议。

示例模式：

```ts
export const workspace = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['workspace'] },
})
  .get('', () => Workspace.list(), {
    detail: {
      summary: 'List workspaces',
      'x-cradle-cli': {
        command: ['workspace', 'list'],
      },
    },
    response: { 200: t.Array(WorkspaceModel.record) },
  })
```

## 依赖方向

目标依赖方向：

- `modules/*` 可以读取 `infra.ts`、`database/`、`http/`、`errors/`、`logging/`、`config/` 等基础设施。
- 基础设施目录不应依赖业务模块；`infra.ts`、`database/`、`http/`、`logging/` 应保持 feature-agnostic。
- `app.ts` 可以导入所有模块，因为它是 composition root。
- 模块之间应优先通过明确 service API 或 shared contract 交互，避免隐式循环依赖。
- 持久化 schema 变更必须谨慎处理，优先用 Drizzle schema/migration 路径，不要绕过现有 database provider。

依赖方向由 `pnpm --filter @cradle/server check:boundaries` 检查。它忽略测试与纯 type imports，拒绝跨 domain `internal/` imports，锁定已移除的反向 runtime edges，并以最大 runtime domain SCC 为非递增基线。SCC（strongly connected component）是互相可达、因此无法独立初始化的一组 domain。当前遗留 SCC 由计划 041 逐个 vertical slice 降低；不要扩大基线。

## 错误处理

- 业务可预期错误使用 `AppError`，提供稳定 `code`、HTTP `status`、用户可读 `message` 和可选 `details`。
- Elysia validation error、not found、unknown error 统一由 `createErrorHandler()` 映射。
- 不要在 route handler 中手写一套错误 JSON 格式；抛 `AppError` 或让 validation 进入统一 handler。
- 未预期错误会记录 logger 和 observability event；不要吞掉会影响状态一致性的异常。

## Auth 和 request context

- HTTP auth 由 `src/http/auth.ts` 作为 Elysia plugin 注册。
- Request id 由 `src/http/request-id.ts` 设置。
- Actor/request-scoped 信息应通过 `src/http/actor-context.ts` 等 HTTP 边界读取，不要在模块静态初始化时读取 request state。

## OpenAPI 和 CLI metadata

- OpenAPI plugin 在 `src/http/openapi.ts`。
- Route schema 使用 Elysia `t` / TypeBox-compatible models。
- CLI 生成依赖 route `detail['x-cradle-cli']`，新增 CLI-facing endpoint 时必须确认 metadata shape 与现有 route 一致。
- 修改 route schema 或 metadata 后，按需运行 web/API generation workflow；不要手改生成文件来掩盖 server contract 不一致。

## Background tasks 和 lifecycle

- `createServerApp()` 启动 runtime concerns，例如 plugin activation、external provider refresh、Chronicle background sync、relay connector、provider runtime cleanup。
- 长生命周期资源必须注册到 composition-root-owned `RuntimeResourceRegistry`，不要各自追加分散的 `app.onStop()` callbacks。
- shutdown 顺序是：立即停止接受新命令并触发 abort signal；取消 pending connectors/background work；drain chat runs/finalization；停止 providers/watchers/plugins；最后关闭 database/infra。资源 stop 必须可重复调用。
- Boot-time background work 必须显式处理 rejection；不要留下 floating promise 造成 unhandled rejection。

## Testing and verification

Server package scripts 是真实验证入口：

```bash
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server check:boundaries
pnpm --filter @cradle/server test
pnpm --filter @cradle/server build
```

常用策略：

- HTTP contract 或 service 行为变更：优先添加/更新 Vitest 覆盖。
- 只改文档：至少检查 diff，确认文档中的路径和命令真实存在。
- 改 OpenAPI route schema：运行 server typecheck，并考虑运行依赖生成 API 的下游检查。
- 改 runtime lifecycle：运行相关 focused tests 后再跑完整 server test。

## Agent checklist

- 先确认 owner：route、service、model、runtime helper 分别属于哪个模块。
- 读 across，写 within：可以读取其他 namespace，但不要把别的模块私有语义复制到当前模块。
- 不要把业务逻辑塞进 `app.ts` 或 HTTP plugin。
- 不要新增未验证的全局 singleton；优先复用 `infra.ts` 模式。
- 不要引入新的反向依赖；如果无法避免，先说明原因和替代方案。
- 完成后说明实际运行过的验证命令；没有运行就明确说没有运行。
