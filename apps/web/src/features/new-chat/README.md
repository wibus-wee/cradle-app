<!-- Once this directory changes, update this README.md -->

# Features/New-Chat

Chat launcher domain: the empty-state home screen where users compose a new chat.
Handles optional workspace selection, Agent Profile selection, and session creation before navigating to the chat route.
New Chat remains the flexible conversational entry point for ad-hoc, remote,
Issue, and Session Group flows. Outcome-oriented local coding work belongs to
the separate New Work surface and continues to use its own `POST /works` entry.
默认 launcher 会启动 no-project chat：它省略 `workspaceId`，让 server 在打开 chat session 前创建 Cradle-owned ad-hoc workspace。选择 workspace 后仍保留 project-bound file mentions 和 recent-session view。
Split from `features/workspace/` to keep workspace management separate from new-session creation.
User-facing composer placeholders, quick prompt labels, readiness notices, workspace picker fallbacks, and recent-session labels are owned by the `new-chat` i18n namespace.

## Files

- **new-chat-home.tsx**: NewChatHome component — full-page launcher with composer, Agent/Profile/model/workspace selection, and shared persisted new-chat preference state
- **new-chat-page.tsx**: Thin `/chat/new` route adapter. It reads route search and active-surface state, then mounts `NewChatEntryPoint`.
- **new-chat-entry-point.tsx**: Runtime owner for no-project and workspace-bound session creation, isolation, cached session promotion, runtime catalog selection, and first-turn optimistic handoff. It derives props and callbacks for the New Chat Views instead of owning their visual implementation.
- **new-chat-surface-view.tsx**: Props-only full-page New Chat shell with composer, quick-action, layout-slot, and dialog render slots plus neutral/plan decoration.
- **new-chat-workspace-selector-view.tsx**: Props-only workspace menu driven by workspace options and selection/add callbacks.
- **new-chat-quick-actions-view.tsx**: Props-only quick prompt row.
- **new-chat-recent-sessions-view.tsx**: Props-only recent-session grid with caller-provided relative-time labels.
- **new-chat-surface-view.stories.tsx**: Server-free default, plan-mode, and recent-session Storybook scenes.
- **index.ts**: Barrel export
