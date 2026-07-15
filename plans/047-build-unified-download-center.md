# Plan 047: 建立统一且精简的 Download Center

> **Executor instructions**: Follow this plan milestone by milestone. Run every
> verification command and confirm the expected result before moving to the
> next milestone. Keep the implementation small: Download Center owns byte
> transfer lifecycle only; resource owners keep discovery, extraction,
> installation, activation, and rollback. If anything in "STOP conditions"
> occurs, stop and report instead of adding a compatibility layer or generic
> workflow engine. When done, update this plan's status row in
> `plans/README.md` unless a reviewer explicitly owns the index.
>
> **Drift check (run first)**:
> `git diff --stat e3d008c..HEAD -- packages/db packages/download-center apps/server/src/app.ts apps/server/src/runtime-resource-registry.ts apps/server/src/modules/download-center apps/server/src/modules/acp apps/server/src/modules/chronicle apps/server/src/modules/plugins apps/server/src/plugins apps/server/tests apps/desktop/package.json apps/desktop/src/main apps/desktop/src/preload apps/web/src/api-gen apps/web/src/components/layout apps/web/src/features/download-center apps/web/src/features/chronicle apps/web/src/features/settings apps/web/src/lib/electron.ts apps/web/src/locales plans/README.md`
> If an in-scope file changed, compare the current-state facts and excerpts
> below with the live code. Semantic drift in task ownership, plugin cache
> behavior, update installation, or runtime shutdown is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: `plans/028-plugin-desktop-live-source-mirror.md` (DONE), `plans/041-enforce-domain-and-lifecycle-ownership.md` (DONE)
- **Category**: security, correctness, tests, tech-debt, migration, direction
- **Planned at**: commit `e3d008c`, 2026-07-14

## Why this matters

Cradle 当前至少有四套直接 HTTP artifact 下载实现。ACP、Chronicle、Plugin、Desktop Update 分别拥有不同的临时文件、重试、进度、校验和错误语义；其中 ACP 的 writer error/backpressure、Chronicle 的 body timeout、Plugin 的整包内存读取，以及 macOS Update 的可选 checksum 都已经形成确定的可靠性或安全缺口。

本计划建立一个薄的 `download-center`：统一下载队列、进度、校验、取消、重试、有限历史和目标支持时的断点续传。它不拥有 URL 发现、manifest 解析、Git/npm transport、解压、安装、启用、版本切换或 owner 数据表。Server 与 Desktop 使用同一 contract 和 HTTP 传输内核，但保留两个执行宿主；Web 将两个 scope 投影成一个用户可理解的 Download Center。

这是一份包含多个 milestone 的单一实施计划。每个 milestone 都必须独立可验证，并在进入下一阶段前保持仓库可编译。不要并行迁移多个 owner；顺序迁移是控制风险的一部分。

## Architecture decisions

以下决定已经确认，执行者不得重新设计：

1. **Thin core**：共享 package 只拥有单文件 HTTP artifact 传输和共享 contract。Server/Desktop host 各自拥有队列、持久化、事件和进程生命周期。
2. **Two execution hosts**：Server artifact path 不能假定对 Desktop 可见；Desktop Update 和 Windows `electron-updater` 必须留在 Electron main。Web 只做 projection。
3. **Owner keeps post-download behavior**：ACP/Chronicle/Plugin/Desktop Update 继续拥有解压、安装、缓存发布、签名验证、启用和 rollback。
4. **No Background Job reuse**：`background-job` 观察另一个 source of truth 并执行 owner projection，不是 byte executor。Download Center 不注册 background-job source adapter/projector。
5. **No public enqueue**：Server 不提供接受任意 URL 的 HTTP endpoint。只有可信 owner service 可以创建或重试任务。
6. **No automatic orphan completion after restart**：进程重启时，`queued`、`downloading`、`verifying` 全部转为 `failed/interrupted`，保留 `.part`。新的 owner 调用显式 retry 后才重新入队，避免 artifact 完成后无人继续安装。
7. **No generic workflow features**：第一版没有 pause、priority、bandwidth limit、batch、dependency graph、content-addressed cache、cross-owner dedupe 或 configurable scheduler。
8. **HTTP artifacts only**：第一版直接处理 ACP binary、Chronicle model files、GitHub Plugin tarball、macOS update。Plugin `npm pack` 和 Skills `git clone` 保持 owner transport；Windows updater 只适配相同 task projection。
9. **Explicit identity, no heuristics**：owner 提供稳定的 owner identity 和 source ID。中心不按 URL、文件名或 checksum 猜测任务等价关系；同一个 task ID 任意时刻只有一个 writer。
10. **URLs stay ephemeral**：source URL、redirect URL、request headers 和绝对 artifact path 不进入公共 API、历史 JSON 或日志。任务持久化只保存 owner 提供的非敏感 source ID。

## Current state

### Existing transfer implementations

- `apps/server/src/modules/acp/acp.installer.ts:25-62,158-190`：下载后直接解压到稳定安装目录；手写 stream pump 不监听 writer error，也不处理 backpressure。
- `apps/server/src/modules/acp/service.ts:177-260`：每个 agent 的 controller 存在内存 Map；重复 install 会覆盖 controller，cancel 无法停止已开始的 extraction。
- `apps/server/src/modules/chronicle/service.ts:3437-3532`：一个调用栈内下载多个文件、校验、提升并写 resource row；没有 per-category single-flight。
- `apps/server/src/modules/chronicle/service.ts:8337-8442`：实现 fallback、三次重试、进度和 SHA-256；timeout 在 headers 到达后立即清除，body 可以无限阻塞。
- `apps/server/src/plugins/source-installer.ts:121-135` 与 `apps/desktop/src/main/plugin-install-links.ts:240-252`：GitHub tarball 通过 `arrayBuffer()` 整包进入内存。
- `apps/desktop/src/main/update-downloader.ts:33-113`：最完整的现有 downloader；流式落盘、进度、SHA-256、临时文件 rename，但失败删除部分文件，不支持取消/续传/历史。
- `apps/desktop/src/main/windows-update-adapter.ts:21-101`：Windows 使用 `electron-updater`，库本身接受 `CancellationToken` 并拥有 SHA-512/cache/differential download。

代表性的当前代码：

```ts
// apps/server/src/modules/acp/acp.installer.ts:168-189
await new Promise<void>((resolve, reject) => {
  const file = createWriteStream(destPath)
  const reader = response.body!.getReader()

  const pump = async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          file.end(() => resolve())
          return
        }
        file.write(Buffer.from(value))
      }
    }
    catch (error) {
      file.destroy()
      reject(error)
    }
  }

  void pump()
})
```

```ts
// apps/server/src/modules/chronicle/service.ts:8371-8390
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), timeoutMs)
let response: Response
try {
  response = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'Cradle/1.0' },
    redirect: 'follow',
    signal: controller.signal,
  })
}
finally {
  clearTimeout(timeout)
}
```

```ts
// apps/server/src/plugins/source-installer.ts:126-135
const response = await fetch(url, {
  headers: {
    accept: 'application/vnd.github+json',
    'user-agent': 'Cradle-Server-Plugin-Source-Installer',
  },
})
if (!response.ok || !response.body) {
  throw new Error(`GitHub tarball download failed with status ${response.status}.`)
}
await writeFile(archivePath, Buffer.from(await response.arrayBuffer()))
```

### Existing ownership and projection boundaries

- `apps/server/src/modules/background-job/README.md` 明确 background-job 负责 durable asynchronous observation/projection，而非任务执行。
- `apps/server/src/runtime-resource-registry.ts` 与 `apps/server/src/app.ts:267-285` 是 Server 长生命周期资源的唯一 shutdown owner。Server Download Center 必须注册到 `cancel` phase，并在 infrastructure close 前停止 worker。
- `plans/028-plugin-desktop-live-source-mirror.md` 已决定动态 Plugin source fetch 由 Server 单一拥有；`apps/desktop/src/main/plugin-source-sync.ts:42-83` 只从 Server 读取 resolved result。不要把动态 source fetch 搬回 Desktop。
- `apps/server/src/modules/plugins/service.ts:373-420` 当前在 list/get projection 中调用 `resolvePluginSourceDirectory()`；cache miss 会产生下载、npm subprocess 和解压副作用，迁移前必须拆开 query/command。
- `apps/server/src/modules/provider-runtime/README.md` 当前只拥有 runtime session/binding/host lifetime，没有 Runtime artifact installer。本计划只留下未来接入 contract，不创建虚假的 Runtime 下载 UI/API。

### Existing progress surfaces

- Chronicle 使用专有 SSE `GET /chronicle/model-resources/download-progress`，状态只存在进程内 Map。
- `useChronicleDownloadProgress()` 返回 `Map<category/file, entry>`，但 `chronicle-settings.tsx` 按 `downloadProgress[category]` 读取，当前卡片不能正确显示进度。
- Desktop Update 通过 `desktop-update:status-changed` IPC 广播 `isDownloadingUpdate` 和 `downloadingProgress`；macOS 每个 network chunk 都广播，Windows 每个 updater event 都广播。

### Repository conventions

- Server 新 capability 使用 `apps/server/src/modules/<capability>/{index.ts,model.ts,service.ts,README.md}`；route 只负责 HTTP contract，service 负责语义。
- 数据库必须使用 Drizzle；schema 位于 `packages/db/src/schema`，migration append-only，由 `pnpm --filter @cradle/db generate` 生成。
- Server 可预期错误使用 `AppError`，不要在 route 内手写第二套 error envelope。
- 长生命周期 worker 由 composition-root-owned `RuntimeResourceRegistry` 管理。
- React feature 位于 `apps/web/src/features/<domain>`；使用生成 SDK/gateway，避免 raw fetch；Tailwind class 必须静态，并通过 `cn()` 合并。
- 不保留 compatibility shim。迁移 owner 后删除旧 downloader/progress contract。

## Target contract

共享 package 应导出最少的 public types。名称可以因现有类型冲突微调，但语义不得扩大：

```ts
export type DownloadScope = 'server' | 'desktop'

export type DownloadTaskStatus =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadOwner {
  namespace: string
  resourceType: string
  resourceId: string
  displayName: string
}

export interface DownloadSource {
  id: string
  url: string
  headers?: Readonly<Record<string, string>>
}

export interface DownloadIntegrity {
  expectedBytes?: number
  checksum?: {
    algorithm: 'sha256' | 'sha512'
    value: string
  }
}

export interface DownloadRequest {
  owner: DownloadOwner
  fileName: string
  sources: readonly DownloadSource[]
  integrity?: DownloadIntegrity
  maxBytes: number
  maxAttempts?: number
}

export interface DownloadedArtifact {
  taskId: string
  filePath: string
  bytes: number
  checksum: {
    algorithm: 'sha256' | 'sha512'
    expected: string | null
    actual: string
    matched: boolean | null
  }
}
```

Rules:

- `matched: true` 只表示 actual 与 owner 提供的 expected checksum 相同。
- 未提供 expected checksum 时仍计算 SHA-256，`matched` 为 `null`；不得把 computed digest 展示成来源真实性已验证。
- `fileName` 必须是单一 basename，拒绝空值、`.`、`..`、separator 和 NUL。
- `sources` 至少一个；fallback 按顺序尝试。source ID 改变时必须清除 `.part` 和 validator，不跨 source 拼接。
- source ID 由 owner 明确提供，并包含 immutable artifact/version 与 mirror identity；远端内容语义变化时必须产生新 ID。不要使用泛化的 `primary`/`fallback` 作为跨版本 identity。
- 默认只允许 HTTPS。测试可通过 injected fetch 使用内存 Response，不添加生产 `allowHttp` flag。
- 不将 URL/header 放进 `DownloadTaskView`。
- `DownloadedArtifact.filePath` 只在 host 内部 service API 返回；HTTP、IPC renderer contract 和 Web state 均不得包含它。

## Storage model

Server 只新增一张 `download_tasks` 表，不新增 attempts/events/batches 表。字段保持为：

```text
id
owner_namespace
owner_resource_type
owner_resource_id
display_name
file_name
source_id
status
transferred_bytes
total_bytes
checksum_algorithm
expected_checksum
actual_checksum
expected_bytes
attempts
max_attempts
etag
error_code
error_message
started_at
finished_at
artifact_released_at
created_at
updated_at
```

约束：

- Server response 将 `scope` 投影为固定的 `server`；不要把这个冗余常量存入 Server 表或用于跨宿主调度。
- 不存 URL、headers、redirect location、绝对路径或 owner 私有 context JSON。
- `.part` 路径由 task ID 推导为 `<dataDir>/download-center/partial/<taskId>.part`。
- 完成文件路径由 task ID 和已验证 basename 推导为 `<dataDir>/download-center/artifacts/<taskId>/<fileName>`。
- DB `transferred_bytes` 是节流后的 projection；实际 resume offset 始终读取 `.part` 的 `stat.size`。
- `etag` 只保存 strong ETag；weak ETag 当作不存在。
- history row 保留；owner 调用 release 后删除 artifact 并写 `artifact_released_at`。
- failed/cancelled `.part` 与 completed but unreleased artifact 最多保留 7 天。只在 host boot 和任务创建/完成时执行清理，不增加独立 daily scheduler。
- API 默认只返回最近 100 条；Desktop JSON store 同样最多保留 100 条 terminal history。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Shared package typecheck | `pnpm --filter @cradle/download-center typecheck` | exit 0, no errors |
| Shared package tests | `pnpm --filter @cradle/download-center test` | all transport contract tests pass |
| Generate DB migration | `pnpm --filter @cradle/db generate` | one append-only migration and snapshot are added |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0, including boundary check |
| Server focused tests | `pnpm --filter @cradle/server exec vitest run tests/download-center.test.ts tests/chronicle.test.ts src/plugins/source-installer.test.ts` | all focused tests pass |
| Desktop focused tests | `pnpm --filter @cradle/desktop test -- src/main/download-center src/main/update-downloader.test.ts src/main/update-manager.test.ts src/main/plugin-install-links.test.ts` | all focused tests pass |
| Web generation | `pnpm generate:web` | generated Download Center operations/types are updated |
| CLI generation | `pnpm gen:cli` | Download Center list/get/cancel commands are generated |
| Web focused tests | `pnpm --filter @cradle/web test -- src/features/download-center src/features/chronicle src/features/settings/desktop-update-settings.test.tsx` | all focused tests pass |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0, including API boundary check |
| Desktop typecheck | `pnpm --filter @cradle/desktop typecheck` | exit 0 |
| Scoped lint | `pnpm exec eslint packages/download-center packages/db/src/schema/download-center.ts apps/server/src/modules/download-center apps/server/src/modules/acp apps/server/src/plugins/source-installer.ts apps/desktop/src/main/download-center apps/desktop/src/main/update-* apps/web/src/features/download-center` | exit 0 |
| Diff hygiene | `git diff --check` | no output, exit 0 |

If a command above does not exist until its milestone creates it, do not run it early. Do not replace focused commands with browser E2E.

## Suggested executor toolkit

- Use `server-app-development` when adding the Elysia module, TypeBox contract, README, lifecycle registration, and OpenAPI metadata.
- Use `vercel-react-best-practices` for the merged Web subscription/query hook so progress events do not cause unrelated app rerenders.
- Use `make-interfaces-feel-better` only for the compact Download Center popover; do not add decorative animation or redesign owner settings surfaces.
- Do not use `multi-work` for simultaneous owner migrations. Independent review is welcome, but implementation order must stay serial because owner behavior and shared contract evolve together.

## Scope

### In scope

- New `packages/download-center/**` package.
- `packages/db/src/schema/download-center.ts`, schema exports, and one generated append-only migration.
- New `apps/server/src/modules/download-center/**`, Server composition/lifecycle registration, test reset ownership, OpenAPI/CLI generated artifacts.
- Server owner migrations in `modules/acp`, Chronicle model-resource portion, `modules/plugins`, and `plugins/source-installer.ts`.
- Focused Server tests for Download Center, ACP installer lifecycle, Chronicle model installs, and Plugin source installer/cache behavior.
- New `apps/desktop/src/main/download-center/**`, IPC registration/preload types, Desktop shutdown integration, and package-local test script.
- Desktop owner migrations for macOS Update, Windows updater projection/cancellation, and marketplace deep-link Plugin tarball installation.
- New `apps/web/src/features/download-center/**`, compact global Download Center UI, Server/Desktop task merging, and owner surface migrations.
- Removal of Chronicle download-progress SSE/hook and Desktop Update download-progress fields after consumers switch.
- Relevant README, API generation, locale strings, and `plans/README.md` status.

### Out of scope

- Any change to `apps/server/src/modules/background-job/**` or `background_jobs`.
- Plugin `npm pack`, Skills `git clone`, Git fetch, model catalog JSON fetch, ordinary file export/download, or browser file downloads.
- A Runtime installer that does not exist today. Only document how a future Runtime owner calls the internal service.
- Pause/resume UI, priority, bandwidth control, task groups, dependency graph, mirrors selected by latency, P2P, content-addressed storage, cross-owner dedupe, or configurable concurrency UI.
- Database changes to ACP, Chronicle, Plugin, or Desktop preference schemas. Only `download_tasks` is added.
- Browser E2E/component snapshot tests.
- Public APIs that accept arbitrary URL/header/path input.
- Persisting secret-bearing URLs or headers, even encrypted.
- Backward-compatible duplicate progress endpoints or forwarding aliases after migration.

## Git workflow

- Branch: `advisor/047-build-unified-download-center` unless the operator specifies another worktree/branch.
- Use reviewable commits per milestone, for example:
  - `test(download-center): characterize artifact handoff`
  - `feat(download-center): add resumable http runner`
  - `feat(server): persist download center tasks`
  - `refactor(chronicle): delegate artifact downloads`
  - `refactor(desktop): adopt download center`
  - `feat(web): add unified download center`
- Do not push, open a PR, release, or publish packages unless instructed.
- Never rewrite existing migration history.

## Milestone 0: Lock security policy and legacy behavior with tests

### M0.1 Add characterization seams without changing behavior

Add focused tests before extracting code:

- ACP: injectable fetch/temp root; multi-chunk success; writer failure; abort during download; cancel during extraction; duplicate install attempt; failed extraction must not replace a prior installation.
- Chronicle: fallback ordering; three-attempt behavior; body stall/abort; size/checksum mismatch; concurrent same-category install; multi-file promotion failure restores previous files.
- Plugin: GitHub tarball multi-chunk path; concurrent resolve of the same source cache key; list/get must not start a network fetch after M3, but capture current behavior before changing it.
- Desktop Update: multi-chunk/backpressure; HTTP error; body error; writer error; transferred size mismatch; checksum mismatch; partial file behavior; downloader failure must prevent installer prepare.

Use dependency injection and temporary directories. Do not call real networks or sleep on wall-clock timers.

Audited bug regressions that cannot pass without changing behavior should be added in the milestone that fixes them. M0 must leave no failing or TODO test in the tree; its characterization tests lock only behavior that must survive extraction, while shared fixtures/fakes are prepared for later regression cases.

**Verify**: run the focused legacy tests. Expected: all committed tests pass, the reusable fetch/filesystem/timer seams exist, and later milestones can add regression cases without real network or wall-clock sleeps.

### M0.2 Require owner-specific authenticity policy

For macOS Update:

- Change the manifest schema so `url`, non-negative `size`, and SHA-256 are required for every selected macOS artifact.
- Require HTTPS for manifest and artifact URLs.
- During prepare, verify the staged `.app` code signature and designated requirement against the currently running `.app` before writing/launching the replacement script.
- Put signature verification behind an injectable `DesktopUpdateBundleVerifier` so tests run without system keychain state.
- If the current official distribution is intentionally unsigned/ad-hoc, STOP and report the release channel and signing limitation. Do not silently skip verification in packaged update flow.

For ACP binary:

- Inspect the current ACP registry contract and repository fixtures for a trusted SHA-256/SHA-512 or signature field.
- Extend `BinaryTargetSchema` only when the field is actually provided by the authoritative registry.
- Binary distributions without a trusted digest/signature must not be presented as verified or installed automatically. Filter them from supported binary distributions and return a stable owner error explaining that verified binary metadata is unavailable; keep `npx`/`uvx` behavior unchanged.
- Do not calculate a digest after download and treat that self-derived value as publisher authenticity.

For Plugin GitHub tarballs:

- The transfer may complete with computed-only SHA-256 because Plugin trust is evaluated over the extracted package and existing checksum-bound grants.
- Preserve that distinction in the task contract; do not label the archive publisher-verified.

**Verify**: update source/installer and ACP registry focused tests pass; a macOS manifest without checksum fails parsing; a staged app with mismatched designated requirement cannot produce an installer plan; ACP binary metadata without trusted integrity is unavailable rather than silently installed.

## Milestone 1: Build the shared HTTP artifact kernel

Create `packages/download-center` following the workspace package shape used by `packages/chat-runtime-contracts`, with strict TypeScript, `typecheck` and Vitest scripts. Keep files separated by responsibility:

```text
packages/download-center/
  package.json
  tsconfig.json
  src/
    contract.ts
    errors.ts
    file-integrity.ts
    http-artifact-downloader.ts
    index.ts
  tests/
    http-artifact-downloader.test.ts
```

The package may depend on Node built-ins only unless an existing workspace dependency is demonstrably necessary. It must not import Electron, Elysia, Drizzle, app config, owner modules, or Web code.

### M1.1 Implement safe streaming and verification

Implement `HttpArtifactDownloader` with injected fetch, clock/timer hooks, filesystem root, and progress callback:

- Use `Readable.fromWeb` and `stream/promises.pipeline` or an equivalent backpressure-aware pipeline.
- Write only to the task-derived `.part` path.
- Count actual bytes and reject when `maxBytes` is exceeded, regardless of `Content-Length`.
- Treat `Content-Length` as an early hint, never as the sole enforcement.
- Maintain an inactivity timeout through body completion; reset it on each received chunk. Merge timeout with caller cancellation without losing either abort reason.
- Follow redirects manually with a small fixed maximum (5), revalidating HTTPS on every hop. Do not add DNS/IP heuristics or a user-configurable redirect engine.
- After body completion, verify actual size when expected and compute the entire file checksum by reading the finished `.part` from disk.
- On success, atomically rename into the task-derived artifact directory.
- On retryable network/timeout/5xx errors, keep the `.part` when resume-safe; checksum/size mismatch must not be promoted.
- Error objects carry stable `code`, retryability, and task-safe messages without URL/header values.

### M1.2 Implement minimal resume semantics

Do not send `HEAD`. On explicit retry of the same task/source:

1. Read the actual `.part` size with `stat`.
2. Resume only when size is positive and a previously observed strong ETag exists.
3. Send `Range: bytes=<size>-`, `If-Range: <etag>`, and `Accept-Encoding: identity`.
4. Append only for `206` whose parsed `Content-Range` start equals the local size.
5. If response is `200`, truncate and download from zero.
6. If response is `416` and remote total equals local size, proceed to full-file verification; otherwise truncate and restart once from zero.
7. Invalid/mismatched `Content-Range`, non-identity encoded partial response, weak/changed validator, or source ID change must never append. Reset once or return a stable error; do not guess.
8. Switching to fallback source clears `.part` and ETag before the next attempt.

The package returns updated strong ETag and source ID to the host but does not persist them itself.

### M1.3 Throttle projections, never terminal state

Keep byte accounting exact internally, but emit progress no more often than once per 200ms per active task. Always emit:

- initial downloading state;
- transition to verifying;
- completed, failed, and cancelled terminal state;
- final transferred/total bytes.

Use an injected clock/fake timer in tests. Do not implement throttling independently in Server, Desktop, and Web.

**Verify**: `pnpm --filter @cradle/download-center typecheck && pnpm --filter @cradle/download-center test` → all tests pass, including 200/206/416, invalid range, ETag change, fallback reset, cancellation, inactivity timeout, byte limit, writer failure, size/checksum mismatch, atomic promotion, and terminal progress flush.

## Milestone 2: Add the Server Download Center host

Create the Drizzle schema, migration, module, lifecycle registration, and focused tests:

```text
apps/server/src/modules/download-center/
  README.md
  index.ts
  model.ts
  repository.ts
  service.ts
  task-events.ts
```

### M2.1 Persist one-table task history

- Add `packages/db/src/schema/download-center.ts` with the exact minimal storage fields listed above.
- Export it through the existing schema index.
- Add indexes for status, updated-at/history ordering, and owner lookup. Do not add a unique URL/checksum index.
- Generate one append-only migration. Do not manually edit prior SQL or snapshots.
- Register task cleanup with the existing test-reset ownership path.

### M2.2 Implement a fixed FIFO host queue

Server service behavior:

- Default concurrency is 2, defined as a constant rather than user configuration.
- `execute(request)` creates a task and returns a Promise of `DownloadedArtifact` to the owner.
- `retry(taskId, request)` validates that owner identity and source ID match the task, transitions failed/cancelled to queued, and reuses `.part`/ETag when safe.
- `cancel(taskId)` persists cancelled before aborting the active controller. A late worker completion must use conditional transition and cannot overwrite cancelled.
- The same task ID can have only one queued/active execution. Repeated execute/retry returns the existing Promise or a stable conflict; it never opens a second writer.
- Owner modules may query latest retryable task by exact owner namespace/resource type/resource ID/source ID. This is explicit identity, not URL/checksum dedupe.
- `releaseArtifact(taskId)` deletes the center-owned artifact and records release. It is idempotent.
- On boot, active statuses become `failed/interrupted`; no task is automatically run.
- Register `download-center` in `RuntimeResourceRegistry` `cancel` phase. Stop accepting new work, cancel active transfers, await worker settlement, then allow later shutdown phases.

Do not create a global singleton outside the existing composition-root/infra conventions.

### M2.3 Expose read/cancel/events only

Server routes:

```text
GET  /download-center/tasks
GET  /download-center/tasks/:id
POST /download-center/tasks/:id/cancel
GET  /download-center/events
```

- List supports bounded `status`, owner fields, and `limit` filters.
- Add `x-cradle-cli` metadata for list/get/cancel, not for events.
- Response never includes URL, headers, ETag, absolute path, or persisted error stack.
- There is no public create/retry/release endpoint.
- SSE sends task changes using the shared task view; initial state comes from the list query. Disconnect cleanup must be driven by request abort/cancel, not polling an empty enqueue every five seconds.
- Event publication receives the already-throttled core progress and synchronous terminal updates.

**Verify**:

1. `pnpm --filter @cradle/db generate` → exactly one new migration/snapshot/journal entry.
2. `pnpm --filter @cradle/server exec vitest run tests/download-center.test.ts` → queue concurrency, FIFO, queued/active cancel, retry, cancellation race, boot interruption, cleanup, release, redaction, SSE cleanup all pass.
3. `pnpm --filter @cradle/server typecheck` → typecheck and module boundary check pass.

## Milestone 3: Stabilize and migrate Server owners serially

Do not modify ACP, Chronicle, and Plugin in parallel. Complete and verify each owner before starting the next.

### M3.1 Migrate Chronicle model resources first

- Extract only model-resource install/download helpers from the 8k+ line `service.ts` into a Chronicle-owned file if it improves reviewability; do not split unrelated Chronicle domains.
- Add per-category single-flight spanning download, staging, promotion, verification, and status update.
- Each manifest file is a separate Download Center task. Use owner identity `chronicle/model-resource-file/<category>:<relativePath>` and a stable manifest-derived source ID.
- Chronicle remains responsible for fallback source ordering input, local-file installs, model directory validation, and final resource status.
- Download files sequentially in V1. Do not create a multi-file task/batch abstraction.
- Stage every file outside stable target paths. Before replacing existing targets, create owner-owned backups; on any promotion/verification failure, restore all prior targets. Delete only staging/backup paths created by this operation.
- After owner promotion succeeds, release each Download Center artifact. On owner failure, release completed artifacts that are no longer useful but preserve the active failed task `.part` for retry.
- Remove Chronicle retry loops, transfer timeout, checksum stream, progress Map/listeners, and `/model-resources/download-progress` after shared behavior is active.
- Existing Chronicle install endpoints remain owner commands. A retry action calls Chronicle install again; Chronicle selects the exact latest retryable task and invokes center retry before continuing installation.

**Verify**: focused Chronicle tests cover same-category concurrency, multi-file rollback, fallback reset, checksum failure, interrupted task retry, local-file install unaffected, and final model availability. Server typecheck passes.

### M3.2 Migrate ACP binary installs

- Add per-agent single-flight; duplicate install returns stable conflict rather than overwriting an AbortController.
- Replace ACP's downloader with Download Center and delete the manual pump.
- Require the trusted registry integrity metadata established in M0. Entries without it do not expose binary install.
- ACP extracts into a unique owner staging directory, validates the configured command remains inside staging, applies executable permissions, then atomically swaps the stable agent directory with backup/restore semantics.
- `cancelInstall(agentId)` resolves the exact active Download Center task and cancels it. After download completion, cancellation must be checked before and after extraction/promotion; cancellation can never later persist `installed`.
- Preserve npx/uvx command semantics; they do not create Download Center tasks.
- ACP audit logs describe install lifecycle but do not duplicate byte progress/history.

**Verify**: focused ACP tests cover duplicate install, download cancel, cancel during extraction, integrity requirement, failed extraction preserving prior install, successful atomic replacement, and npx/uvx unchanged.

### M3.3 Split Plugin query/command and migrate GitHub tarballs

- Change `listSources()`/`getSource()` projection to inspect existing cache only. GET must never fetch, run npm, extract, or publish cache.
- Represent missing cache as unresolved/error projection without silently repairing it.
- Only preview/create/refresh owner commands may resolve a source.
- Add Plugin-owned single-flight keyed by the existing `sourceCacheKey`; serialize resolve/refresh/publication. Download Center's task single-writer guarantee does not replace cache publication locking.
- Preserve the existing preview→install cache reuse exactly: the same `{kind,location,ref,subPath}` cache key must avoid a second GitHub fetch.
- Route GitHub tarballs through Server Download Center with an explicit compressed byte limit. Plugin still owns tar extraction, subpath filtering, package discovery, trust evaluation and cache publish.
- Leave `npm pack` untouched and outside Download Center history.
- Keep Desktop dynamic source mirroring read-only through Server HTTP as decided by Plan 028.

**Verify**: Plugin tests prove GET is side-effect-free, concurrent preview/create fetch once and publish once, refresh serializes with resolution, preview→install reuses cache, oversized archive is rejected, npm/local path behavior is unchanged.

## Milestone 4: Add the Desktop Download Center host

Create:

```text
apps/desktop/src/main/download-center/
  download-center-service.ts
  download-task-store.ts
  electron-updater-adapter.ts
  index.ts
  *.test.ts
```

### M4.1 Persist bounded Desktop history

- Store task projection at `<userData>/download-center/tasks.json`.
- Parse with Zod/shared task schema, tolerate a missing file, and quarantine/reset malformed content without crashing Desktop startup.
- Persist by writing a sibling temporary file and atomic rename; never append partial JSON.
- Keep at most 100 newest terminal rows plus all active rows.
- Do not add SQLite/electron-store solely for this module.
- Use `<userData>/download-center/partial` and `/artifacts` for Desktop runner paths.
- On Desktop startup, active rows become `failed/interrupted`; do not auto-run.

### M4.2 Implement Desktop FIFO and IPC

- Default concurrency is 1.
- Reuse shared runner and task contract; match Server transition/cancel/retry/release semantics.
- On Desktop shutdown, stop accepting work, cancel active tasks, await worker settlement, then continue plugin/server shutdown.
- Add typed IPC service methods for list/get/cancel and a `download-center:task-changed` event.
- Renderer IPC response uses `scope: desktop` and never includes file path, URL, ETag or headers.
- Add a stable package-local Desktop test script that reuses the root Vitest node project; do not create a second drifting Vitest config.

### M4.3 Migrate macOS Update

- `DesktopUpdateManager` remains update discovery/prepare/apply owner.
- Replace `DesktopUpdateDownloader` transfer internals with Desktop Download Center; delete the class if it becomes a forwarding wrapper with no semantics.
- Require manifest size/SHA-256 and HTTPS from M0.
- Download completion returns host-internal artifact path to `DesktopUpdateInstaller.prepare()`.
- Keep the artifact until apply succeeds or retention expires; release stale/superseded update artifacts when a new candidate replaces them.
- Remove `isDownloadingUpdate`, `downloadingProgress`, and renderer-visible `downloadedFilePath` from `DesktopUpdateStatus` after Web migrates. Internal installer plan may retain its archive path.
- Cancellation goes through Download Center and results in an update-owner error/cancelled state without preparing an installer.

### M4.4 Adapt Windows electron-updater

- Do not replace `electron-updater` transport.
- Create a Desktop task before calling `downloadUpdate(cancellationToken)` and project its progress/events into the shared task contract.
- Retain the `CancellationToken` per task so Download Center cancel cancels the library download.
- Map library SHA-512 completion/error/cancel events to verifying/completed/failed/cancelled without claiming shared `.part` support.
- Preserve electron-updater signature verification, cache and differential download behavior.

### M4.5 Migrate Desktop marketplace deep-link Plugin downloads

- Only the marketplace deep-link path in `plugin-install-links.ts` uses Desktop Download Center. This is distinct from dynamic Plugin source mirroring owned by Server.
- Stream GitHub tarball with the same explicit compressed byte limit as Server Plugin unless product requirements justify a smaller constant.
- Desktop Plugin remains responsible for extraction, validation, consent, receipt, package publication and activation.
- Denied consent releases the completed artifact and removes owner staging.

**Verify**: Desktop focused tests cover JSON recovery/atomic persistence, FIFO, cancellation, shutdown, macOS retry/resume/prepare handoff, signature failure, Windows cancellation/projection, Plugin oversized archive/consent cleanup, and task redaction. Desktop typecheck passes.

## Milestone 5: Build the unified Web projection and compact UI

Create `apps/web/src/features/download-center` with a generated Server gateway, Desktop IPC adapter, merged task query/subscription, presentation helpers, and compact popover. Keep transport and UI projection separate.

### M5.1 Merge scopes without inventing a third store

- Server initial state comes from generated `GET /download-center/tasks`; live updates come from authenticated SSE.
- Desktop initial/live state comes from typed IPC when Electron is available.
- Merge by `(scope, taskId)`, sort active tasks before terminal history, then newest `updatedAt`.
- Do not persist a third copy in Zustand/localStorage. Server/Desktop stores remain authoritative.
- Throttling belongs to core/host. Web may batch same-frame updates but must not add a second timer-based progress model.
- Reconnect always refetches the bounded task list before accepting new events so dropped SSE/IPC frames cannot leave stale terminal state.

### M5.2 Add one compact Download Center surface

- Add a single global Download button/popover in the existing app chrome/sidebar using design-system primitives.
- Show active count badge, display name, owner label, scope, progress bytes/percent, status, last error, cancel when active, and recent history.
- Unknown total uses indeterminate progress without fake percentage.
- Do not show URL, path, ETag, raw stack, attempt internals or owner installation phases.
- Cancel calls Download Center directly.
- Failed task retry remains an owner command because only owner can continue installation. The popover may navigate/open the owner surface; it must not expose a generic retry endpoint that downloads an artifact nobody consumes.
- On owner surfaces, Retry calls the existing owner install command; owner service invokes `downloadCenter.retry()` for the matching task.
- Use accessible labels, keyboard focus and reduced-motion-safe existing transitions. Do not add decorative animation.

### M5.3 Migrate owner-specific progress consumers

- Chronicle resource cards select tasks by `scope=server`, owner namespace/category/file and aggregate multi-file progress for display. Delete `useChronicleDownloadProgress` and the old SSE parser/tests.
- Desktop Update settings and sidebar derive downloading state/progress from `scope=desktop`, owner namespace `desktop-update`; retain update checking/preparing/apply state from Desktop Update owner.
- Plugin/ACP surfaces may link to Download Center or show filtered active task progress, but do not duplicate task stores.
- Add locale strings through existing default locale and translation workflow; no hardcoded user-facing English strings.

**Verify**: Web focused tests cover Server-only, Desktop-only, merged duplicate task IDs across scopes, reconnect refetch, unknown totals, terminal ordering, cancel routing, owner navigation for retry, Chronicle multi-file aggregation, Desktop update status separation, and redaction. Web typecheck/API boundary check pass.

## Milestone 6: Remove legacy paths, document ownership, and run full gates

### M6.1 Delete migrated transfer/progress code

After every consumer has switched:

- Delete ACP `downloadFile` manual pump.
- Delete Chronicle `downloadToFile`, retry loop, download progress Map/listeners, and `/chronicle/model-resources/download-progress`.
- Delete both Plugin `arrayBuffer()` tarball transfer functions or reduce them to owner calls with no byte-transfer semantics.
- Delete macOS `DesktopUpdateDownloader` if empty, legacy `downloadingProgress` fields/events, and renderer-visible artifact paths.
- Remove obsolete Web hooks, schemas, tests and generated Chronicle SSE operation.
- Search for duplicate download semantics; allow only core runner, Windows adapter, npm/git owner transports, and unrelated user-facing file export paths.

### M6.2 Update documentation and plan drift

- Add Server Download Center README with ownership, lifecycle, storage, security and internal owner API.
- Add package README/JSDoc for transport guarantees and non-goals.
- Update Desktop main README and relevant owner READMEs.
- Correct ACP README's stale Tsuki file map.
- Reconcile Plans 030/031 status against current Plugin preview/cache implementation; do not rewrite their historical intent, but record which foundation already existed before Plan 047.
- Document future Runtime integration as a short owner example, not a stub module.

Example only:

```ts
const artifact = await downloadCenter.execute(request)
try {
  await runtimeOwner.installArtifact(artifact.filePath)
}
finally {
  await downloadCenter.releaseArtifact(artifact.taskId)
}
```

### M6.3 Run final verification

Run in order:

1. Shared package typecheck/tests.
2. DB migration generation check and migration test/dry run used by the repository.
3. Server focused tests, typecheck, boundary check, then full Server suite.
4. Desktop focused tests and typecheck.
5. Regenerate Web/CLI; Web focused tests and typecheck.
6. Root test suite if the focused gates are green.
7. Scoped lint and `git diff --check`.
8. Inspect `git status --short` and confirm every modified file is listed in this plan's scope or is a deterministic generated artifact.

Do not claim a full gate passed if unrelated baseline failures occur. Record exact failing test names and prove they are unchanged before deciding whether the plan can be reviewed.

## Test plan

### Shared transport matrix

- 200 full download with known/unknown Content-Length.
- Multi-chunk backpressure and writer failure.
- HTTPS redirect chain and redirect limit.
- Inactivity timeout after headers and during body.
- Queued and active cancellation.
- Retryable 5xx/network errors and non-retryable 4xx.
- Byte limit and expected size mismatch.
- SHA-256/SHA-512 match and mismatch.
- Strong/weak ETag handling.
- Valid 206 append, Range ignored with 200, valid complete 416, mismatched 416, invalid Content-Range, changed validator, encoded partial response.
- Fallback source resets partial data.
- Atomic final rename and no partial exposure.
- Throttled progress plus synchronous terminal flush.

### Server host matrix

- FIFO concurrency exactly 2.
- Same task single writer; unrelated tasks may run concurrently.
- Cancel persists before abort; late completion cannot overwrite.
- Explicit retry reuses task ID and safe partial.
- Restart maps queued/downloading/verifying to failed/interrupted without auto-run.
- Release idempotence and retention cleanup.
- URL/header/path/ETag redaction in HTTP/SSE/log-safe errors.
- SSE listener cleanup through request cancellation.
- Runtime shutdown cancels/drains before database close.

### Owner handoff matrix

- Download success is followed by owner install exactly once.
- Download failure/cancel never begins owner install.
- Owner install failure does not mutate Download Center completed history into installed semantics.
- Chronicle multi-file rollback and retry.
- ACP atomic replacement/cancel race/integrity gate.
- Plugin query side-effect removal, cache single-flight and preview reuse.
- macOS checksum/signature/prepare/apply handoff.
- Windows updater progress/cancel/error adapter.
- Desktop Plugin consent denial cleanup.

### Web matrix

- Server/Desktop merge keyed by scope/task ID.
- Reconnect snapshot reconciliation.
- Active/terminal sorting and bounded history.
- Determinate/indeterminate progress.
- Cancel route selection by scope.
- Owner navigation/retry behavior.
- Chronicle category aggregation and Desktop Update download/install state separation.
- No component snapshots and no browser E2E.

## Done criteria

- [ ] `packages/download-center` contains the only direct reusable HTTP artifact runner and passes the complete transport matrix.
- [ ] Server/Desktop expose the same redacted task contract with fixed scopes and no public arbitrary-URL enqueue.
- [ ] Server uses one `download_tasks` table and one append-only generated migration; no attempt/event/batch tables exist.
- [ ] Server concurrency is 2, Desktop concurrency is 1, and each task has one writer.
- [ ] Failed/cancelled/interrupted tasks preserve safe `.part` data; resume only occurs with strong ETag and valid Range response.
- [ ] Boot never auto-completes an orphan task; active tasks become failed/interrupted.
- [ ] macOS Update requires HTTPS, size, SHA-256 and staged bundle signature/designated-requirement validation.
- [ ] ACP binary install requires publisher-trusted integrity metadata or remains unavailable; computed-only digest is never presented as publisher verification.
- [ ] Chronicle, ACP, GitHub Plugin tarballs and macOS Update no longer own HTTP byte-transfer loops.
- [ ] Plugin npm and Skills Git transports remain outside Download Center.
- [ ] Plugin list/get are pure reads and preview→install cache reuse remains intact.
- [ ] Chronicle/ACP/Plugin owner install/publish paths are single-flight and failure-safe.
- [ ] Windows updater is projected through the task contract and supports cancellation through its `CancellationToken` without replacing library transport.
- [ ] Web has one compact Download Center, merges Server/Desktop scopes, and no longer consumes Chronicle download SSE or Desktop download-progress fields.
- [ ] Public responses/events never include URL, headers, ETag, absolute artifact paths or raw stack traces.
- [ ] Progress is throttled at the shared kernel and all terminal states flush immediately.
- [ ] Relevant READMEs and generated API/CLI artifacts are current; ACP stale file map is removed.
- [ ] Shared, Server, Desktop and Web focused tests/typechecks pass; final diff has no whitespace errors or unexplained scope changes.
- [ ] `plans/README.md` marks Plan 047 DONE only after all milestones pass; partial milestone completion is recorded in this file, not misreported as plan completion.

## STOP conditions

Stop and report instead of improvising if any of these occurs:

- Existing Plans 045/046 or other user-owned uncommitted files overlap Plan 047 scope in a way that cannot be cleanly preserved.
- The live ACP registry has no trusted digest/signature and product requirements insist binary install must remain available without an explicit integrity decision.
- Official packaged macOS builds are unsigned/ad-hoc, so designated-requirement validation cannot distinguish the publisher.
- The shared package needs to import Drizzle, Electron, Elysia, owner modules, or Web code to function.
- A proposed resume path would append without a strong validator or valid matching Content-Range.
- Completing a task after restart requires a durable owner callback/projector. Do not add one; keep interrupted semantics and report the product requirement conflict.
- A generic Retry button would complete a download without a live owner continuation. Keep retry owner-initiated and report the requested UX conflict.
- Plugin migration would move dynamic source fetching back into Desktop or break preview→install cache reuse.
- Chronicle atomic owner promotion appears to require a database schema change or a generic multi-file transaction engine. Stop and propose an owner-local backup/restore alternative.
- Windows updater cannot expose a usable CancellationToken in the installed version. Report the adapter limitation; do not replace electron-updater in this plan.
- Any public route/IPC proposal accepts arbitrary URL, headers or filesystem destination.
- Verification requires adding pause, priority, task graph, content-addressed dedupe or another scheduler abstraction.
- A milestone's focused verification fails twice after a reasonable in-scope correction.
- Drift requires touching an out-of-scope domain or retaining duplicate compatibility endpoints.

## Maintenance notes

### Execution record — 2026-07-14

All implementation milestones were completed and their focused verification
commands passed. The plan remains `TODO` in `plans/README.md` rather than being
marked `DONE`, because two final gates are blocked by pre-existing local
baseline state that must be resolved independently:

- The default local SQLite data directory already contains `download_center_tasks`
  while its migration journal has no `0032` entry. Consequently default
  `pnpm generate:web`/`pnpm gen:cli` fail while applying migrations. Both
  generators pass when run with a fresh temporary `CRADLE_DATA_DIR`; do not
  hand-edit migration history or the journal to make the existing local database
  appear current.
- The full Server suite retains three unrelated
  `session-await-github.test.ts` review-head matching failures. Focused Download
  Center/owner suites and Server typecheck pass.

The generated migration is append-only and intentionally retained. It also
includes two session-table rebuilds that Drizzle emits from the pre-existing
schema snapshot drift; regenerating from the previous snapshot produces the
same output. Do not manually trim that generated migration.

- Download Center's `completed` means a verified/downloaded artifact is available to the current owner call. It never means the resource is installed or enabled.
- Expected checksum is an owner trust input. An actual checksum computed by the center is useful for diagnostics and corruption detection but is not publisher authenticity by itself.
- Future Runtime/resource owners should call the internal host service and keep their install state in their own namespace. Do not add owner-specific columns to `download_tasks`.
- If authenticated/signed URLs are introduced later, keep them ephemeral. Retry after restart must ask the owner for a fresh request rather than persisting credentials.
- If real demand for pause, priority, bandwidth limits or durable background owner continuation appears, write a separate plan backed by product evidence. Do not grow this module opportunistically.
- Reviewers should scrutinize cancellation races, conditional terminal writes, partial-file validators, redaction, macOS signature validation, owner rollback, and shutdown ordering more than UI polish.
- Retention constants are code-owned defaults. Do not expose configuration until storage pressure is observed in production.

## Audit findings covered by this plan

- macOS Update artifact authenticity and mandatory checksum policy.
- ACP executable integrity metadata gap.
- Missing transport/owner characterization tests.
- ACP/Chronicle/Plugin single-flight and atomic owner handoff.
- Repeated/drifting HTTP artifact implementations.
- Body timeout that ends before Chronicle transfer completion.
- Plugin tarballs buffered fully in memory.
- Plugin GET routes causing network/download side effects.
- ACP writer error/backpressure bug.
- Broken Chronicle progress lookup.
- Per-chunk SSE/IPC/React progress amplification.
- ACP README and Plugin plan-state drift.

## Findings considered and rejected

- **Reuse `background-job`**: rejected because it observes external source state and projects terminal owner results; wrapping a byte executor would add a second lifecycle layer.
- **Current Chronicle SSRF finding**: rejected because current remote manifests are built-in and validated. Defense remains internal-only enqueue, HTTPS-only sources, bounded redirects and no public arbitrary URL API.
- **Make one global Server worker own Desktop files**: rejected because remote/headless Server paths are not Desktop-local and Windows updater requires Electron main.
- **Automatically resume active tasks to completed on boot**: rejected because current owners have no durable continuation; it creates orphan artifacts or forces a workflow/projector framework.
- **Move npm/Git transports into V1**: rejected because their subprocess/protocol semantics differ from direct HTTP artifact transfer and would over-generalize the center.
- **Cross-owner checksum/URL dedupe**: rejected as an opaque heuristic with ownership and credential-lifetime hazards.
- **Treat existing Plugin receipts without package checksum as a new Plan 047 blocker**: rejected because the repository already records this as an intentional legacy integrity gap and still gates external code through package checksum trust evaluation. Plan 047 must not weaken that boundary.
