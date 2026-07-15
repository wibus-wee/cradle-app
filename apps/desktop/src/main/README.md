# Desktop Main Process

这个目录拥有 Electron main process 的启动、窗口生命周期、server 子进程、native IPC service、desktop Download Center、desktop updater runtime，以及 desktop plugin runtime。

## 文件清单

- `index.ts`：main process 入口；负责安装 main-process error capture，再加载实际 Desktop app bootstrap。
- `main-app.ts`：负责激活 desktop plugins、启动 server、创建主窗口、接入 update manager、创建 desktop-owned chat stream broker、注册 desktop app badge IPC、注册 `cradle://` protocol，并把 native BrowserPanel `WebContentsView` runtime 事件投影给 plugin loader。
- `browser-manager.ts`：拥有 BrowserPanel 双运行时；默认接管 renderer `<webview>` 的 guest `WebContents`，并保留 native `WebContentsView` fallback，按 BrowserPanel owner 管理短期 warm inactive tab、隐藏面板 grace-period suspend/restore、owner-scoped Electron session partition、显式 close/crash/dispose 销毁、截图、CDP 执行、popup 新 tab 路由和 panel bounds attachment。
- `browser-ipc.ts`：注册 native BrowserPanel IPC contract；renderer 通过 preload 调用 open/close/hide/bounds/navigation/tab/screenshot/CDP 方法，main process 推送 browser state snapshots。
- `chat-stream-broker.ts`：拥有 Electron main process 的 long-lived chat stream transport；main process 对 server SSE 保持每个 chat session 一个上游 stream，并通过 renderer IPC events fan out 已接受的 AI SDK chunk frames；response start request 透传 Cradle-owned `runtimeSettings`，late subscriber 只接收有界 replay tail，避免 Desktop bridge 为长流缓存完整 chunk 历史。
- `chat-stream-broker.test.ts`：覆盖 desktop chat stream broker 的单上游 fanout、有界 replay tail、delta replay coalescing、per-WebContents subscriber lifecycle cleanup、passive stream final unsubscribe abort，以及 response stream sender unsubscribe retention。
- `notification-center-manager.ts`：拥有 Electron native notification polling 和 Notification Center quick reply；只读取 server-owned completed-run projection，reply 成功提交后通过 desktop action bridge 刷新对应 chat session。
- `notification-center-manager.test.ts`：覆盖 completed-run native notification、idle-session quick reply detached response、busy-session queue reply，以及 notification lifecycle cleanup。
- `desktop-app-badge-manager.ts`：拥有 Electron app icon badge IPC；renderer 只投影 unread count，main process 负责 macOS Dock badge 写入和清理。
- `desktop-app-badge-manager.test.ts`：覆盖 unread count 正规化、macOS Dock badge 投影、IPC handler 注册/移除，以及非 macOS 平台 no-op 行为。
- `desktop-assets.ts`：解析 Electron main process 在 dev 和 packaged runtime 中使用的 preload、main renderer、tear-off renderer asset 路径，兼容 electron-vite main chunk 输出目录。
- `desktop-assets.test.ts`：覆盖 dev preload 路径从 `dist/main/chunks` 回溯到 `dist/preload/index.js`，以及 packaged preload / tear-off renderer 路径解析。
- `tray-manager.ts`：拥有 Electron native tray icon、native tray menu、tray action IPC，以及主窗口聚焦/转发流程。
- `window-state.ts`：拥有主窗口 bounds 恢复校正逻辑，以及 tear-off window 的 size-only 持久化 helper；主窗口在 `electron-window-state` 持久化基础上按当前 display workArea 修正大小和位置，tear-off 只保存宽高不保存位置。
- `window-manager.ts`：拥有 Electron window lifecycle 和 renderer/server URL 连接；session tear-off window 从专用 renderer entry 初始化、按释放点选择目标 display，在释放点附近打开并限制在目标 workArea 内、只记忆宽高，同一 session 的重复 open 会聚合到已登记窗口，并在关闭时通知 main renderer 恢复对应 main-window chat tab。
- `window-manager.test.ts`：覆盖 session tear-off window 并发 open 去重，以及 renderer load 失败时清理 pending session 窗口。
- `server-process.ts`：拥有 server 子进程启动、复用、显式停止、环境变量注入、Cradle app version 投影，以及 desktop-owned credential secret 文件；packaged runtime 只启动 `@cradle/server` 产出的 `dist/desktop-runtime` artifact；server ready 后写入 Desktop-owned CLI server locator，普通 App 退出只 detach 并保留 locator 供下次重连，更新/重启等显式 runtime 替换路径才停止 server。
- `native-services.ts`：拥有 main-process native IPC service 注册，包括 native dialog/path launch IPC、Desktop CLI install IPC、desktop chat stream broker IPC、Claude / Codex 会话文件的只读本机采样、Mac Appshot Cradle-native capture orchestration、Cradle-native image asset projection、Appshot source-window target locking、Codex temp asset observe-only evidence collection, and Appshot parity probe orchestration.
- `desktop-cli-manager.ts`：拥有 packaged macOS Desktop CLI command lifecycle；读取 bundled launcher、检查 `/usr/local/bin/cradle` symlink 状态，并通过显式用户操作安装、修复或移除 PATH command。权限提升只用于 symlink 写入，不修改 shell rc 文件。
- `observability-reporter.ts`：拥有 Electron main process 的 private-preview error capture，把 main-process uncaught exception / unhandled rejection 缓存并投递到 server-owned observability API；只写 Cradle server namespace，不引入外部上传服务。
- `native-editor-launcher.ts`：拥有 desktop native editor launch strategy，优先使用 macOS app launch，再回退到 common editor CLI commands。
- `native-terminal-launcher.ts`：拥有 desktop native terminal launch strategy；macOS 使用 Terminal.app app launch，Windows 优先 Windows Terminal 再回退 PowerShell/cmd，Linux 使用常见 terminal emulator 候选。
- `native-appshot-codex-assets.ts`：拥有 Codex Computer Use Appshot temp asset 的只读 projection，只读取 `/tmp/com.openai.sky.CUAService` 并把 Codex 私有图片产物转换为 Cradle IPC/report 可消费的 metadata 和 data URL。
- `native-appshot-codex-assets.test.ts`：覆盖 Codex temp asset reader 的 root 边界、image 类型过滤、baseline inventory 过滤，以及 observer 对新产物的识别。
- `native-appshot-target.ts`：拥有 desktop-owned Appshot research target synthesis，在没有 renderer composer frame 时生成 composer-like destination，避免 parity probe 退回到 source-equals-destination geometry。
- `native-services.test.ts`：覆盖 Appshot parity target synthesis，确保 research probe 的默认 destination 不等于 frontmost window fallback。
- `update-manager.ts`：拥有 renderer-visible Desktop Updates workflow；按平台编排 macOS manifest updater 或 Windows NSIS updater 的检查、下载、安装触发和状态事件。
- `update-manager.test.ts`：覆盖 Desktop Updates 手动 Check/Download/Apply 编排、macOS installer launch、Windows NSIS updater apply、quit hook，以及没有 prepared update 时的 apply error。
- `windows-update-adapter.ts`：拥有 Windows `electron-updater` adapter，把 GitHub release feed 中的 `latest.yml`、NSIS installer 和 blockmap 投影到统一的 desktop update 状态模型。
- `update-source.ts`：拥有 desktop update manifest 读取、schema 校验、版本比较和 artifact 选择。
- `update-source.test.ts`：覆盖 desktop update manifest URL 解析、renderer-visible 状态投影、版本比较，以及非 numeric dot version 的拒绝行为。
- `update-installer.ts`：拥有 macOS `.app` bundle staging、bundle version 校验、detached installer script 生成、替换和 relaunch 触发。
- `update-installer.test.ts`：覆盖 update staging plan 生成、bundle version 校验、detached installer script 关键命令、临时 `.app` bundle 替换 smoke，以及版本不匹配时拒绝安装。
- `mac-bridge-manager.ts`：拥有 desktop-owned `cradle-mac-bridge` 子进程生命周期、NDJSON request/response 协议、hotkey event 投影、显式 parity-test synthetic hotkey helper、dev/packaged binary 路径解析，以及缺少 binary 时的非阻塞状态。
- `mac-bridge-protocol.ts`：定义 Electron main 与 Swift Mac Bridge 共享的协议 schema，包括 `bridge.status`、权限状态、双 Command hotkey 配置、显式 synthetic both-Command parity helper、frontmost window capture、显式 `targetWindow` capture、Appshot capture/frontmost context、display/window recording 和 hotkey event。
- `mac-screenshot-sinks.ts`：拥有 Mac Bridge screenshot 的 post-capture sink，包括保留文件、写剪贴板和可选 CleanShot URL scheme handoff。CleanShot 不是 hard dependency。
- `plugin-install-links.ts`：拥有 Marketplace install link 解析、first-party source validation、native install receipt，以及 Cradle-owned installed plugin directory 写入。
- `plugin-install-receipt.ts`：读取 plugin package 内的 Marketplace install receipt，并投影为 descriptor source provenance。
- `plugin-discovery.ts`：拥有 desktop plugin discovery 和 manifest validation。
- `plugin-discovery.test.ts`：覆盖 desktop discovery 对 Marketplace install receipt provenance 的 descriptor 投影。
- `plugin-loader.ts`：拥有 desktop plugin activation、Marketplace installed plugin discovery、shared config projection、webview listener registry，以及 renderer browser tab bridge。
- `plugin-loader.test.ts`：覆盖 desktop plugin deactivation 时清理 subscriptions、shared config projection 和 capability records。
- `plugin-install-links.test.ts`：覆盖 Marketplace install URL parsing、link rejection、bundled receipt recording 和 Cradle-owned plugin install writes。
- `plugin-paths.ts`：拥有 desktop dev/bundled runtime 的 primary plugin directory 解析，并把同一路径投影给 forked server。
- `download-center/`：拥有 desktop-scoped durable download task state、main-process IPC projection、artifact release 和 shared HTTP runner 的调度；它不向 renderer 暴露 source URL、headers 或 filesystem artifact path。

## Browser-use backend ownership

当前 browser-use 的生产路径仍由 plugin system 拥有，但浏览器 surface 已切到 native `WebContentsView`：

1. `plugin-loader.ts` 激活 desktop plugin，并提供 `DesktopPluginContext`。
2. `plugins/browser-use/src/desktop.ts` 启动 browser backend socket。
3. renderer bridge 创建、激活、查询 browser panel tab；`browser-manager.ts` 创建 native `WebContentsView` runtime 后把其 `WebContents` 投影为 existing plugin webview facade，供 plugin backend 复用 CDP/socket protocol。

需要变更 browser automation 行为时，优先修改 plugin-owned backend 和 plugin SDK bridge。

## Desktop update ownership

`update-manager.ts` owns the renderer-visible Desktop Updates workflow. The explicit user flow is Check, Download, then Restart. Check reads the platform update feed and updates status; it does not implicitly download in the manual flow. When desktop preferences enable automatic checks, the main process checks every 5 minutes in the background; when automatic download is also enabled, an available update starts downloading and broadcasts progress through Download Center task changes.

Updates are available only in packaged macOS and Windows builds with `CRADLE_DESKTOP_UPDATE_URL` configured. macOS uses the Cradle-owned JSON manifest and zip replacement path; the manifest artifact is downloaded through the desktop Download Center, which performs streaming, integrity verification, task persistence, and renderer progress projection. Restart spawns the detached installer script first, shuts down the desktop-owned server runtime, replaces the current `.app` bundle, and relaunches Cradle with `open -n`. If the target app directory is not writable, the installer uses macOS administrator privileges for the replacement step.

Windows uses `electron-updater` with the NSIS target. The same `CRADLE_DESKTOP_UPDATE_URL` may point at the macOS `manifest.json`; Windows strips that filename and reads `latest.yml` from the feed directory. Restart prepares the desktop runtime shutdown, then delegates quit/install/relaunch to the downloaded NSIS installer through `quitAndInstall`.

## Desktop Download Center ownership

`download-center/` is the only Electron-main owner for ordinary desktop artifact transfer state. It persists a compact, redacted task record under Electron user data, keeps URLs/headers and artifact paths private to the main process, broadcasts task views through `download-center:task-changed`, and exposes only list/get/cancel to preload. The web Download Center feature subscribes to that projection and to the server projection; it does not create another downloader or updater-progress bridge. Windows `electron-updater` remains the transport owner for NSIS, but reports its lifecycle into this task model.

## Mac Bridge ownership

Mac Bridge is the desktop-owned boundary for macOS APIs that do not belong in the renderer, server, Chronicle, or plugin namespaces. The Swift executable is named `cradle-mac-bridge`; the architecture is intentionally not named system-agent because Cradle already uses agent terminology for autonomous runtimes.

The bridge communicates with Electron main over newline-delimited JSON on stdio. Electron main owns product workflow and storage paths; Swift owns native facts and actions such as permission status, left/right Command key monitoring, frontmost window lookup, window screenshot capture, Appshot transition rendering, and the native top-center feedback indicator shown after legacy capture success or failure. Screenshot artifacts are written under Cradle-owned desktop storage such as `app.getPath('userData')/mac-captures`. CleanShot integration is implemented only as a post-capture sink using a URL scheme after Cradle has already produced its own PNG. Appshot capture is Cradle-native only: Electron main reads the frontmost context when needed, sends the renderer destination to Mac Bridge, and keeps returned renderer assets inside Cradle-owned IPC types. Codex temp assets may still be observed read-only for manual parity reports, but Electron main no longer exposes a Codex private capture adapter.

The desktop build runs `scripts/build-mac-bridge.mjs` on macOS. The script compiles the Swift package in `native/macos/mac-bridge` and atomically replaces `.build/cradle-dist/cradle-mac-bridge`; it also copies Mac Bridge resources such as `Appshot.wav` into `.build/cradle-dist/resources`. `electron-builder.mjs` then packages that directory into `Contents/Resources/mac-bridge`. Non-macOS hosts skip the Swift build so Linux and Windows CI can still typecheck/package non-macOS slices.
