# Plan 001 — 修复内嵌浏览器（WebContentsView）的闪烁与遮挡架构

> 基准 commit：`8b9643d`。执行前先 `git log --oneline -1` 确认；若相关文件已大幅偏离本文引用的行号，STOP 并回报，不要凭猜测继续。

## 0. 背景：为什么现在的 Browser「怪怪的」

### 0.1 现状架构（先读懂再动手）

Cradle 的内嵌浏览器**不是** `<webview>`、不是 iframe，而是 Electron 的 `WebContentsView`：

- 主进程：`apps/desktop/src/main/browser-manager.ts` 中的 `DesktopBrowserManager` 为每个 tab 创建一个 `WebContentsView`，同一时刻只把**一个** view attach 到主窗口的 `window.contentView` 上（`attachRuntime`，约 2119 行）。
- 渲染进程：`apps/web/src/features/browser/browser-panel.tsx` 渲染浏览器的 chrome（tab 栏、地址栏），并放一个空的占位 div（`viewportRef`），用 `getBoundingClientRect()` 测量它的位置，通过 IPC `desktop:browser-set-bounds`（单向 `ipcRenderer.send`）把 bounds 推给主进程，主进程调 `view.setBounds(bounds)` 让原生视图盖在占位 div 的位置上。
- bounds 同步的触发源：`ResizeObserver` + window `resize` + capture 阶段 `scroll` 监听（`browser-panel.tsx` 约 1628–1652 行），且每次同步要等 **2 帧 rAF** 稳定（`BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 2`）。
- 布局动画期间（面板开合的 spring 动画、侧栏开合、底部面板拖拽），`app-layout.tsx` 会把 `nativeBoundsPaused` 置 true，**完全暂停** bounds 同步，动画结束后再等 `BROWSER_NATIVE_BOUNDS_SETTLE_MS = 420ms` 恢复（`app-layout.tsx:52`、702–726、782–794 行）。

### 0.2 为什么会闪烁 / z-index 混乱（病灶清单，按优先级）

**病灶 A（闪烁的直接来源）：已 attach 的 view 每次 bounds 更新都被 remove + re-add。**

```2125:2143:apps/desktop/src/main/browser-manager.ts
    const nextBoundsSignature = browserBoundsSignature(bounds)
    if (this.attachedRuntimeKey === runtime.key) {
      this.setRuntimeViewHidden(runtime, false)
      this.bringRuntimeViewToFront(runtime)
      if (this.attachedBoundsSignature === nextBoundsSignature) {
        return
      }
      runtime.view.setBounds(bounds)
      this.attachedBoundsSignature = nextBoundsSignature
      return
    }

    this.detachAttachedRuntime()
    this.setRuntimeViewHidden(runtime, false)
    this.bringRuntimeViewToFront(runtime)
    runtime.view.setBounds(bounds)
    this.attachedRuntimeKey = runtime.key
    this.attachedBoundsSignature = nextBoundsSignature
```

`bringRuntimeViewToFront`（2145–2158 行）的实现是 `contentView.removeChildView(view)` 然后 `addChildView(view)`。对**已经 attach 的同一个 view**，每次 bounds 变化（窗口 resize、滚动、面板拖拽）都执行一次 remove+add，compositor 会有一帧丢失该 view 的内容 → 肉眼可见的白闪/黑闪。

**病灶 B（拖拽/动画时错位）：bounds 同步是「暂停 + 事后追赶」模型。**
布局动画期间 bounds 完全不同步（420ms 暂停），动画结束后原生视图才「跳」到新位置。用户看到的是：面板在动，网页内容纹丝不动或消失，最后突然跳过去。加上 2 帧 rAF 防抖，即使非暂停期，原生视图也永远比 DOM 慢 2 帧。

**病灶 C（z-index 的本质）：`WebContentsView` 是 OS 级原生层，永远画在整个 DOM 之上。**
CSS `z-index` 对它**完全无效**——这是 Electron 的架构事实，不是 bug。现在的缓解手段是「occlusion 挖洞」：带 `data-browser-native-surface-occlusion="true"` 属性的 DOM 元素会让渲染层把原生视图的矩形**缩小**避开它（`apps/web/src/features/browser/native-surface-occlusion.ts`、`browser-panel.tsx` 约 275–316 行）。但这个机制只支持上下方向裁剪、靠散落各处的 attribute 手工标注（如 `composer-toolbar.tsx:112–153`），地址栏 suggestions 下拉（`browser-panel.tsx:2907` 用了 `z-20`）根本没标注 → 会被网页盖住。对话框、命令面板（⌘K）、tooltip 等全局浮层同样会被网页盖住。

**病灶 D：hide 走 `removeChildView`，show 再 `addChildView`，切 tab / 切 surface 时又是一轮 attach 闪烁。**（`detachAttachedRuntime`，2160–2175 行）

### 0.3 为什么不学 VS Code 用 iframe（重要：别让执行者走错路）

VS Code 的 Simple Browser 是「webview（iframe）里再套一个 `<iframe sandbox>`」，本地资源靠 Service Worker 拦截 `/vscode-resource` 请求转发给主进程。这个方案**只能显示允许被 frame 的页面**——任何带 `X-Frame-Options: DENY/SAMEORIGIN` 或 CSP `frame-ancestors` 的站点（GitHub、Google、绝大多数生产站点）直接白屏。VS Code 能接受是因为 Simple Browser 定位就是「预览本地 dev server」。

Cradle 的浏览器要支持：任意站点、CDP 命令（`desktop:browser-execute-cdp`）、截图、annotation runtime、独立 session 分区、browser-use 插件自动化。这些都要求真正的 `WebContents`。**结论：`WebContentsView` 是正确的原语，问题出在使用方式。本计划是修复合成/同步模型，不是更换原语。** 参考对象应该是 Cursor 内置浏览器、Figma 桌面端等「WebContentsView + DOM chrome」的混合应用，而非 VS Code Simple Browser。

## 1. 目标

1. 消除 attach/re-attach 引起的闪烁（病灶 A、D）。
2. bounds 同步从「暂停+追赶」改为「逐帧跟随」，拖拽和动画期间原生视图与 DOM 布局保持同步（病灶 B）。
3. 把「DOM 浮层 vs 原生视图」的遮挡处理收敛为一个显式、集中的 suppression/occlusion API（病灶 C 的工程化，不是消除——原生层永远在上是物理事实）。

## 2. 仓库约定（执行者必读）

- 主进程模块结构：领域逻辑在 `*-manager.ts`，IPC 适配在 `*-ipc.ts`，启动接线在 `main-app.ts`。参考 `browser-manager.ts` / `browser-ipc.ts` 现有分工。
- 测试：Vitest。主进程测试 mock `WebContentsView` 与 `contentView.addChildView/removeChildView`（模式见 `apps/desktop/src/main/browser-manager.test.ts:90–108`、267–324）；渲染层测试见 `apps/web/src/features/browser/browser-panel.test.tsx`（注意 README 说明其中 webview 时代的用例已过期）。
- preload 类型：`apps/desktop/src/preload/index.ts` 导出 `CradleElectronAPI`，渲染层在 `apps/web/src/env.d.ts` 增补 `window.cradle`。新增 IPC 必须三处同步：`browser-ipc.ts` 常量 → preload → `env.d.ts`。
- 验证命令（每步结束都跑）：
  - `pnpm typecheck:desktop`（根目录）
  - `pnpm typecheck:apps-web`
  - `pnpm --filter @cradle/desktop exec vitest run src/main/browser-manager.test.ts`
  - `pnpm --filter @cradle/web test`（或只跑 browser 相关文件）
  - 手动验收用 `pnpm dev:desktop`
- Electron 版本 42.4.1：`WebContentsView` 支持 `setVisible()` 与 `setBorderRadius()`（执行时用 `node -e "console.log(require('electron/package.json').version)"` 在 `apps/desktop` 下复核，并查对应版本文档确认 API 存在；若 `setBorderRadius` 不存在则跳过步骤 4 的圆角部分并回报）。

## 3. 实施步骤

### Step 1 — 消除 re-attach 闪烁（主进程，纯逻辑修改）

文件：`apps/desktop/src/main/browser-manager.ts`

1. 修改 `attachRuntime`：当 `this.attachedRuntimeKey === runtime.key` 时，**不要**调用 `bringRuntimeViewToFront`。已 attach 的 view 已经在 view 树里且没有其他子 view 会盖住它（同一时刻只有一个 attach），只需要 `setBounds`。`bringRuntimeViewToFront` 只在「首次 attach」或「从别的 runtime 切换过来」时调用。
2. 修改 `bringRuntimeViewToFront`：先用 `window.contentView.children.includes(runtime.view)` 判断是否已在树中且已是最后一个 child；只有不满足时才执行 remove+add。（Electron 的 `View.children` 返回有序数组，最后一个即最顶层。）
3. 修改 `detachAttachedRuntime`（hide 路径）：把「`setVisible(false)` + `setBounds(HIDDEN_BROWSER_BOUNDS)` + `removeChildView`」改为**只** `setVisible(false)`（保留 `setBounds(HIDDEN_BROWSER_BOUNDS)` 作为 `setVisible` 不可用时的兜底）。view 留在 view 树里，下次 show 就只是 `setVisible(true)` + `setBounds`，没有 add 闪烁。
   - 注意：`close()` / `destroyRuntime()`（约 2492–2519 行）的销毁路径仍然要真正 `removeChildView`，别改。
   - 注意：由于 hide 后 view 仍在树中，切换到另一个 runtime 时（`attachRuntime` 的 else 分支）必须先把旧 runtime `setVisible(false)`，再把新 runtime `setVisible(true)` 并确保其在树顶（此时才允许 remove+add 或首次 add）。
4. 更新 `browser-manager.test.ts`：现有断言若依赖「每次 attach 都 removeChildView+addChildView」需要改写；新增用例：同一 runtime 连续两次不同 bounds 的 `setPanelBounds` 调用，断言 `addChildView` 只被调过一次。

验收：`pnpm --filter @cradle/desktop exec vitest run src/main/browser-manager.test.ts` 全绿；`pnpm dev:desktop` 打开浏览器面板后拖动窗口大小，网页内容不再白闪。

### Step 2 — bounds 逐帧跟随，废除 420ms 暂停（渲染进程）

文件：`apps/web/src/features/browser/browser-panel.tsx`、`apps/web/src/components/layout/app-layout.tsx`

设计原则：`desktop:browser-set-bounds` 是单向 `send`，主进程侧已有 signature 去重（`setPanelBounds` noop-skip，`browser-manager.ts` 约 1527–1536 行），所以**渲染层高频发送是安全且廉价的**。当前的 2 帧 rAF 防抖和动画期暂停都是在解决病灶 A 造成的闪烁——Step 1 修好之后它们就从「必要的止痛药」变成了「延迟的来源」。

1. `browser-panel.tsx`：把 `BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET` 从 2 降为 1（即测量后下一帧立即发送），保留 rAF 合帧（一帧内多次触发只发一次）。
2. `app-layout.tsx`：浏览器面板宽度的 spring 动画（`browserPanelWidth.animateSize`，约 784 行）期间，不再 `pauseBrowserNativeBoundsForLayout`，改为**动画每帧驱动一次 bounds 同步**。实现方式：面板宽度是 Motion 的 `MotionValue`，用 `useMotionValueEvent(browserPanelWidth.size, 'change', ...)` 触发 BrowserPanel 的 bounds 重算（BrowserPanel 内部已有 ResizeObserver 监听 viewport div，宽度动画改变 div 尺寸时 ResizeObserver 会自然触发——先验证 ResizeObserver 路径的实际帧率，若已经逐帧触发则只需删掉暂停逻辑，什么都不用加）。
3. 删除或大幅缩小 `nativeBoundsPaused` 的适用面：
   - 底部面板拖拽（`handleBottomPanelDragStart/End`，约 751–758 行）：删除 pause/resume，让 ResizeObserver 自然跟随。
   - 侧栏开合动画（约 846–858 行）：同上删除。
   - `BROWSER_NATIVE_BOUNDS_SETTLE_MS` 常量及 `pauseBrowserNativeBoundsForLayout` 若无剩余调用方，整体删除。
   - **保留** `nativeBoundsPaused` 这个 prop 通道本身（面板关闭动画 `browserPanelClosing` 收尾阶段可能仍需要一次性隐藏），但默认路径不再使用。
4. 渐进验证：每删一处 pause 就 `pnpm dev:desktop` 手测对应交互（拖底部面板、开合侧栏、开合浏览器面板），确认原生视图逐帧跟随、无闪烁、无残影。**如果某个交互仍闪烁，先回查 Step 1 是否彻底，不要把 pause 加回来。**

验收：拖动浏览器面板分隔条时，网页内容与面板边缘同步移动（允许 1 帧滞后）；开合面板动画期间网页跟随缩放位移，不再是「冻住→跳变」。

### Step 3 — 集中式浮层遮挡 API（渲染进程 + 少量主进程）

目标：任何会浮在浏览器区域上方的 DOM UI（对话框、命令面板、下拉、tooltip、context menu）都通过**一个**集中机制声明自己，而不是散落的 `data-browser-native-surface-occlusion` 属性。

1. 新建 `apps/web/src/features/browser/native-surface-suppression.ts`：一个极简 Zustand store（遵循 `store/README.md` 命名约定，但因属于 browser 域放在 feature 目录），内容是一个引用计数 `suppressCount` + `acquire()/release()` 动作，并导出 hook `useSuppressNativeBrowserSurface(active: boolean)`——`active` 为 true 时 acquire，卸载或转 false 时 release。
2. `browser-panel.tsx` 的 `shouldShowNativeBrowserSurface`（约 1506–1517 行）增加条件：`suppressCount > 0` 时隐藏原生 surface（走现有 `hideNativeBrowserSurface` 路径，Step 1 之后 hide 只是 `setVisible(false)`，代价极低、无闪烁）。
3. 接入全局浮层（各改一行）：
   - 命令面板 `GlobalCommandPaletteHost`（`apps/web/src/app-shell.tsx` 约 337–386 行定位其实现组件）：打开时 `useSuppressNativeBrowserSurface(open)`。
   - 全局 Dialog/Sheet：找到 `components/ui` 中的 dialog 封装，在其 open 状态接入。若 dialog 无全局单点，只接入实际会与浏览器面板同屏的调用方（用 `rg 'Dialog' apps/web/src --files-with-matches` 列出后逐个判断）。
   - 键位覆盖层 `KeyBindingsOverlayHost` 同理。
4. 地址栏 suggestions 下拉（`browser-panel.tsx` 约 2907 行）：这是浏览器 chrome 自己的浮层，位于 viewport 上方边缘，适合用**现有 occlusion 挖洞**而不是整体隐藏——给它补上 `data-browser-native-surface-occlusion="true"`（挖洞机制支持上/下方向裁剪，suggestions 在顶部，符合能力范围）。
5. tooltip / context menu 这类小而快的浮层：**不处理**（整体隐藏网页反而更突兀）。在 `apps/web/src/features/browser/README.md` 中写明这条取舍与原因（原生层恒在上，小浮层避让成本大于收益，设计上应避免把 tooltip 锚定在浏览器视口内）。
6. `README.md` 同步补一节「浮层与原生视图的遮挡策略」：什么时候用 suppression（全屏/模态浮层→整体隐藏）、什么时候用 occlusion（贴边的浏览器自有 chrome→挖洞）、什么都不用（短暂小浮层）。

验收：打开 ⌘K 命令面板时浏览器网页隐藏、关闭后立即恢复且无闪烁；地址栏输入时 suggestions 完整可见不被网页盖住。为 suppression store 写单元测试（引用计数正确性），模式参考 `apps/web/src/store/browser-panel.test.ts`。

### Step 4 — 打磨与清理

1. 圆角：若面板视觉上有圆角容器，用 `view.setBorderRadius(radius)`（Electron 42 可用；先在文档确认）让原生视图与 DOM 容器圆角一致，替代任何 hack。没有圆角需求就跳过。
2. 删除死代码（**单独一个 commit**，方便 review）：
   - `apps/desktop/src/main/browser-backend.ts`（README 已声明未被主进程启动）
   - `apps/desktop/src/main/browser-tab-scripts.ts`（要求 `wc.getType() === 'webview'`，生产路径已无 webview）及其在 `native-services.ts` 的注册
   - `apps/web/src/features/browser/browser-annotation-overlay.tsx`（README:13 标记 legacy）
   - `browser-panel.test.tsx` 中 webview 时代的过期用例（README:15）
   - 删除前用 `rg '<符号名>' --type ts` 确认无引用；`plugins/browser-use` 走的是 `plugin-loader.ts` 的 `DesktopWebview` facade（`notifyWebviewCreated`），**不依赖**上述文件，但删除后必须手动验证 browser-use 插件仍能创建/激活 tab。
3. 全量回归：`pnpm typecheck && pnpm lint && pnpm test`（根目录）。

## 4. 边界（不许碰）

- **不改** IPC 通道协议语义（`desktop:browser-set-bounds` 保持单向 send；tab 状态推送 `desktop:browser-state` 不动）。
- **不改** session 分区、permission handler、annotation runtime、CDP、截图等功能逻辑。
- **不改** `plugins/browser-use` 与 `plugin-loader.ts` 的插件接口。
- **不引入**「把主窗口 UI 也改成 WebContentsView / BaseWindow 双视图」的大重构——那是另一个量级的方案，本计划明确不采用。
- 渲染层不新增第三方依赖。

## 5. 逃生舱

- 若 Step 1 修改后 `browser-manager.test.ts` 中出现大量语义上（而非断言写法上）的失败，说明存在本文未覆盖的 attach 依赖，STOP 并回报失败用例名。
- 若 Step 2 删除暂停后在 macOS 上仍有系统级撕裂（WebContentsView setBounds 与 DOM 合成不同步是 Electron 已知的平台限制），允许保留**仅拖拽结束时**的一次 settle 同步，但必须在 PR 描述里注明并链接对应 Electron issue。
- 若 `setVisible` 在当前 Electron 版本行为异常（隐藏后仍渲染），退回 `setBounds(HIDDEN_BROWSER_BOUNDS)` 方案并回报。

## 6. 测试计划

- 主进程：`browser-manager.test.ts` 新增——同 runtime 重复 bounds 不触发 add/remove；hide→show 循环不调用 `addChildView` 超过一次；切换 runtime 时旧 view `setVisible(false)`。
- 渲染层：suppression store 单测（计数、并发 acquire/release）；`browser-panel` 对 `suppressCount>0` 发送 `bounds: null` 的行为测试。
- 手动验收清单（写进 PR）：窗口 resize、面板分隔条拖拽、面板开合动画、侧栏开合、⌘K、地址栏 suggestions、多 tab 切换、surface 切换、browser-use 插件建 tab。

## 7. 维护注意

- 未来任何新的全局浮层组件都应接入 `useSuppressNativeBrowserSurface`；code review 时检查。
- 升级 Electron 时关注 `WebContentsView` 的 `setVisible`/`setBorderRadius`/`children` 行为变化。
- Plan 002（split view）依赖本计划完成：多 pane 布局会显著增加 bounds 同步频率，「暂停+追赶」模型在网格布局下不可行。

## 状态

- [x] Step 1 re-attach 闪烁修复
- [x] Step 2 逐帧 bounds 跟随
- [x] Step 3 suppression API
- [x] Step 4 清理与回归
