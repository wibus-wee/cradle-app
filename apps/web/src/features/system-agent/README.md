<!-- Once this directory changes, update this README.md -->

# Features/System-Agent

Jarvis / system-agent feature surface for the renderer.
This directory owns System Agent ambient context semantics, explicit Jarvis attachments, prompt formatting for Jarvis, the Jarvis popover UI,
cross-window Jarvis footer tab synchronization, and the single React Query boundary used to read/write Jarvis preferences.
Jarvis popover empty-state copy and setup guidance are owned by the `system-agent` i18n namespace.
Jarvis stores the selected runtime id in preferences and creates hidden Chat Runtime sessions with that id; runtime provider lifecycle and catalog metadata are owned by Chat Runtime, not this feature.
Generic renderer context item contracts, registry lifecycle, and provider composition are owned by `features/context`; System Agent only exports provider factories and feature-owned context item readers.

## Files

- **context-schema.ts**: Shared types describing the client-side workspace/context snapshot fed into Jarvis
- **context-assembler.ts**: Budgeted renderer-side prompt assembly for typed context envelopes, including include/drop trace metadata and `<cradle_context>` rendering
- **context-assembler.test.ts**: Unit coverage for prompt assembly priority, budget drops, secret drops, and trace output
- **context-registry.test.ts**: Unit coverage for System Agent ambient context projection into typed context items
- **display-context.ts**: Display-only projection helpers that hide Jarvis `<cradle_context>` blocks while preserving the full prompt sent to the agent
- **display-context.test.ts**: Unit coverage for closed, historical, and streaming cradle context redaction in Jarvis display text
- **explicit-context.ts**: Explicit Jarvis context attachment boundary; stores user-attached selections and references, exposes a provider for typed envelopes, and keeps explicit context higher priority than implicit attention.
- **explicit-context.test.ts**: Unit coverage for explicit context attachment publication, selected-text capture, and attachment removal.
- **format-context.ts**: Formats the collected snapshot into the `<cradle_context>` block injected into Jarvis prompts
- **format-context.test.ts**: Unit coverage for legacy snapshot formatting and typed context envelope formatting
- **jarvis-history-picker.tsx**: Footer-adjacent Jarvis History picker — reads Session-owned workspace-unbound rows, restores the selected historical session into Jarvis footer tabs, activates it, and leaves persisted session lifecycle owned by Session.
- **jarvis-popover.tsx**: Jarvis popover shell — creates / resumes hidden Jarvis Chat Runtime sessions, injects System Agent-owned context through ChatView's send preparation hook, renders active sessions with the shared Chat runtime UI/driver/composer, keeps only the no-session first-send composer in this feature boundary, and owns positioning, resize bounds, context toggles, explicit selection attachments, and popover chrome.
- **jarvis-popover-loader.ts**: Jarvis popover 的共享 lazy loader 与 intent preload 入口，供 footer hover、focus、click 和 shortcut 复用
- **jarvis-ui-store.ts**: Feature-owned Jarvis UI state for expand/collapse behavior, persisted include-context preference, persisted and de-duplicated Jarvis footer tab sessions, active Jarvis session selection, close-tab semantics that do not delete persisted sessions, and cross-window synchronization of the persisted Jarvis tab slice
- **jarvis-ui-store.test.ts**: Unit coverage for Jarvis footer tab cross-window synchronization, per-window expanded state, and persisted include-context preference
- **system-context-provider.ts**: System Agent-owned ambient UI context provider factory that publishes active route surface, layout, chat summary, unread activity, and active profile state into renderer context envelopes when app composition installs it
- **use-context-snapshot.ts**: Pure read boundary that collects the current renderer context envelope from the shared context runtime without installing providers
- **use-jarvis-preferences.ts**: Authoritative TanStack Query/query-key/mutation boundary for Jarvis runtime/profile/model/thinking preferences, shared by Settings and the Jarvis popover; exposes query success so Settings Jarvis first-render performance gates wait for real preferences readiness
