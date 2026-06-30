<!-- Once this directory changes, update this README.md -->

# E2E/Support

这里存放端到端测试共享的 world、hooks 与辅助服务，用来隔离环境并稳定启动 Electron 应用。
Support 层负责测试生命周期与共享状态，不承载具体业务断言。
当应用启动成本、测试状态隔离或全局前后置逻辑变化时，应同步更新这里。

## Files

- **hooks.ts**: 全局 hooks，负责 scenario 级启动、trace/screenshot 落盘、失败附件与清理；artifact 采集失败时仍会进入 world cleanup
- **database.ts**: 只读 SQLite 查询 helper，把跨场景的持久化断言统一收口到共享 support 层
- **mock-llm-server.ts**: 本地 OpenAI-compatible mock server，支持成功/失败模式、按请求顺序返回不同回复、reasoning / tool-call 流、Codex app-server 可解析的 Responses stream events / usage、请求日志，以及带 socket 兜底销毁的幂等停止
- **server-lifecycle.ts**: managed E2E server / web dev server lifecycle, using isolated `CRADLE_DATA_DIR` and `HOME` so test reset never touches the real user profile; resolves the vendored Codex app-server entrypoint for managed runs; startup failure paths also tear down any spawned process group
- **world.ts**: 自定义 Cucumber world，维护隔离的 `userData`、`HOME`、scenario 状态、mock provider 生命周期（含多轮回复、reasoning、tool-call 配置），Mock Provider 配置后刷新页面以同步 renderer 查询缓存，并保留带参数的 `mainProcess` 断言辅助方法
- **world-utils.ts**: scenario slug、artifact 路径与隐藏窗口 E2E 启动环境的纯工具函数
