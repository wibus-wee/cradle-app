# features

Domain-specific feature modules.
Each subdirectory owns a business domain.
Components, hooks, and utilities specific to a feature live together.

## Directories

- **workspace/**: Workspace management — sidebar listing, directory picker, session grouping
- **chat/**: Chat view, composer, snapshot hydration, and sequenced SSE delta transport for the server-owned chat runtime
- **search/**: Global thread search — command-palette dialog backed by jieba tokenization on the main process
- **profile/**: Global user profile assembled from Usage-owned analytics data
- **desktop-tray/**: Electron native tray action bridge and await projection helpers
- **settings/**: Application settings — theme switching, user preferences dialog
- **skills/**: Filesystem-backed skills management — shared inventory/editor UIs for global settings, workspace detail, and per-agent selection
- **ipc-devtool/**: Developer-only IPC observability panel rendered in the second (`/devtool`) BrowserWindow
- **workspace-detail/**: Project detail page for viewing and editing workspace files (README.md, AGENTS.md) with Tiptap WYSIWYG editor
