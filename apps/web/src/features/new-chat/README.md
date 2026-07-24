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
- **new-chat-page.tsx**: NewChatPage component — dedicated /new-chat route composer with no-project default session creation, optional project-bound first-task prompt templates, profile, model, thinking, workspace selector option anchors, API-ordered recent sessions, and the shared chat-owned `Composer` for first-turn `FileUIPart[]`, @ workspace file mentions, provider-owned draft runtime slash commands, chat-owned slash UI actions such as Codex review mode, and Enter send behavior; remote workspace creation forwards the provider/model/thinking/runtime selection loaded from the remote catalog through the local projection endpoint without treating it as a local provider binding; registers browser panel and right aside capability when the current workspace selector resolves to a workspace path; initializes draft state in a hydration-safe way so persisted profile preferences are restored after Zustand rehydration instead of freezing at module import time, then creates sessions, explicitly promotes that new session in workspace-owned session-list caches, and hands the initial assistant response to the chat-owned optimistic turn/stream boundary before navigation
- **index.ts**: Barrel export
