# Chronicle Tests

Cradle Chronicle 的集成测试目录。

## Files

- `smoke.rs`: 运行已编译的 `cradle-chronicle` binary，并验证真实 artifact 与 `outbox/events.ndjson`。测试显式把 `CRADLE_URL` 指向不可达地址，证明 smoke evidence path 不依赖 Server 且不会生成本地 memory manifest。
