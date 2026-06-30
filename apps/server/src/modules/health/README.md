# Health Module

提供 HTTP 健康检查端点，返回 server 进程的内存、CPU、运行时间与存活状态快照。
路由元数据包含用于生成 CLI 命令的 `x-cradle-cli` 描述。

CPU 快照按稳定采样窗口报告进程 CPU。窗口尚未就绪的请求会返回原始计数器与
`windowReady: false`，并保留上一次稳定的 `percent`，避免高频健康检查把请求开销
或 GC 放大成误导性的瞬时尖峰。

## Files

- **index.ts**: 暴露 `GET /health` 的 Elysia plugin。
- **model.ts**: 定义内存与采样 CPU 诊断响应的 TypeBox schema。
- **service.ts**: 提供进程内存快照与稳定窗口 CPU 采样逻辑。
