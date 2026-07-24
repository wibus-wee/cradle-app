<!-- Once this directory changes, update this README.md -->

# Workspace Detail

Workspace configuration files 的查看与编辑页面。
使用 Tiptap WYSIWYG Markdown editor 编辑 AGENTS.md，并提供 workflow rules 与 workspace skills 的独立 panes；Workflow Rules 与 Workspace Skills panes 都有 server-backed readiness first-render performance gate。
在 rich text editing 场景中，Shiki 为 code blocks 提供带 language selector 的 syntax highlighting。
保存 AGENTS.md 会写入用户 workspace directory，因此 editor 会展示 non-Cradle-owned boundary notice，API call 也会发送 explicit write confirmation。

## Files

- **workspace-detail-page.tsx**: Main page component，包含 inline workspace rename、Overview AGENTS.md content、document-scoped Markdown editor identity、non-Cradle-owned save warning、Workflow Rules + Skills tabs、workspace i18n-backed lazy-pane loading feedback、pane first-render intent marks，以及 scroll-position-aware right outline minimap；TOC 只在 workspace-detail 容器足够宽时显示，优先给 editor/content column 留空间；底部 draft composer 直接复用 chat-owned `DraftChatComposer`，与 New Chat 共享 UI、toolbar、workspace file mentions、skill mentions、runtime slash commands、review command、attachments、Tab completion 与 Enter send 行为；创建 fresh chat 后立即打开 Chat tab、显式提升这个新 session 的 workspace-owned session-list cache，并在后台复用 chat feature 的 response-start command；TOC scroll state 不应牵连这些 panes 重渲染
- **workspace-workflow-rules-loader.ts**: Workflow rules pane 的共享 lazy loader 与 intent preload 入口，用于 tab hover/focus/click 预热 pane chunk
- **workspace-workflow-rules.tsx**: Workflow rules editor，包含 Agent scope selector、stable E2E anchors、scope-safe editor document identity，以及等待 agents inventory 与 selected scope workflow rule query 成功后的 `workspace-workflow-rules-first-render` readiness gate
- **markdown-editor.tsx**: 基于 Tiptap 的 WYSIWYG Markdown editor，支持 auto-save
- **shiki-code-block.tsx**: 使用 Shiki 做 code block highlighting 的 custom Tiptap extension
- **code-block-view.tsx**: Code blocks 的 React NodeView，包含 language selector dropdown
- **use-workspace-file.ts**: 通过 generated workspace API 读取/写入 workspace text files 的 hook，包含 explicit non-Cradle-owned write confirmation
- **index.ts**: Barrel exports
