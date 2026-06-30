# Capability: Database

## User / System Goal

- Server 启动时需要获得稳定的 SQLite + Drizzle 访问入口，并自动应用 schema migration。
- 其他 capability 应只依赖 typed DB accessor，而不是自己持有连接生命周期。

## Current Behavior Evidence

- `DatabaseModule` 注册 `DatabaseConfig`、`DbProvider`、`MigrationRunner`、`DbAccessor`。
- `MigrationRunner` 在模块初始化时自动执行 drizzle migrations。
- `DbProvider` 在应用关闭时释放底层 sqlite 连接。

## Target Module Design

- `database/database.config.ts`: 解析 DB path
- `database/database.provider.ts`: 创建/缓存 Drizzle SQLite DB
- `database/migration-runner.ts`: 启动迁移
- `database/db-accessor.ts`: 为 feature store 提供 typed access

## Test Plan

- 启动应用后可查询迁移后的表。
- 多次获取 accessor 返回同一个可用 DB。
- 应用关闭时不会抛出连接释放异常。
