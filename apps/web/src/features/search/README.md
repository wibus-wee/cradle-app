<!-- Once this directory changes, update this README.md -->

# features/search

Global search UI — VS Code-style command palette and quick-open surface.
The app hosts one palette instance from `App`, while sidebar, home, desktop tray,
and keyboard shortcuts send open intents through the search-owned store. Search
entry points and `⌘P` / `Ctrl+P` open quick-open mode for files, issues, and
chat sessions, while `⌘K` / `Ctrl+K` and `⌘⇧P` / `Ctrl+Shift+P` open command
mode (`>`).

## Files

- **global-search-actions.ts**: Search result action helpers — keeps command result side effects testable; file results open the BrowserPanel workspace-file editor and reveal the browser panel
- **chronicle-search-normalize.test.ts**: Boundary tests for Chronicle search result defaults and malformed identity rejection
- **chronicle-search-normalize.ts**: Boundary normalizer for `/search/chronicle` results so the command palette can render memory and knowledge hits safely
- **global-search-dialog.tsx**: `GlobalSearchDialog` — 当前真实命令面板入口，作为 app-shell 热路径挂载，解析 VS Code Quick Open prefixes（`>` command、空前缀 Go to File、`@` file symbol、`:` line、`#` workspace symbol）；命令模式合并 app-owned commands（New Chat / Settings / Sidebar / Usage）与 web plugin registered commands，带 fuzzy matching、plugin command handler dispatch、handler failure toast fallback 与 localStorage-backed recent command ordering；文件 Quick Open 只在 `new-chat` / `chat` / `workspace-detail` 可解析 workspace 时启用，复用 workspace file list API 并以 fuzzy path matching 打开 BrowserPanel workspace-file editor；通过 search i18n namespace 提供模式、命令、分组、空状态和结果 metadata 文案；命令、模式、文件和对话结果使用 memoized row，对话结果行带消息 icon 与 search token 高亮，父级只传稳定 select-by-id/path handlers
- **global-search-store.ts**: Search-owned app-wide command palette open state and initial query prefix，供 `App` 中的 single host 和 home/workspace/desktop tray open handlers 共享
- **index.ts**: Barrel re-exports for the search feature
- **highlighted-text.tsx**: HighlightedText — renders a string with main-provided MatchRange spans wrapped in styled `<mark>`
- **thread-search-groups.test.ts**: Regression tests for the workspace-grouping data shape consumed by Base UI autocomplete collections
- **thread-search-groups.ts**: Pure grouping helper that normalizes search hits into Base UI's `{ value, label, items }` group contract
- **thread-search-normalize.test.ts**: Regression tests for renderer-side coercion of partial or malformed IPC search payloads
- **thread-search-normalize.ts**: Boundary normalizers that fill default arrays/strings so search UI can render safely across IPC data shape drift，并清理 FTS 返回的 `<mark>` 标签以便统一高亮渲染
- **thread-search-dialog.tsx**: ThreadSearchDialog — command-palette dialog (Dialog primitive) with debounced query, workspace-grouped results, keyboard navigation (↑↓/Enter/Esc), and navigation to `/chat/$sessionId`
- **use-chronicle-search.ts**: useChronicleSearch hook — 150ms debounced TanStack Query against `/search/chronicle`, normalizes Chronicle memory/knowledge hits, and contributes pending state to command palette query performance measurement
- **use-thread-search.ts**: useThreadSearch hook — 150ms debounced TanStack Query against `ipc.search.searchThreads`, normalizes IPC hits for UI safety, and keeps debounce time visible in the pending state consumed by command palette query performance measurement
