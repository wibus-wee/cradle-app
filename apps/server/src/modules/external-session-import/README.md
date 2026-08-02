# External Session Import Module

Cradle-owned import boundary for provider-owned Claude and Codex chat sessions.

The module reads external provider namespaces without modifying them. Discovery streams bounded JSONL metadata and returns lightweight descriptors plus historical Workspace recovery plans; transcript bodies never enter the browser. Import first copies every selected JSONL member into an immutable gzip-compressed bundle under `CRADLE_DATA_DIR/external-session-import`, records original-byte SHA-256 hashes, then projects chat history only from that Cradle-owned bundle. Neither the Claude SDK nor Codex app-server participates in import.

Claude Code main transcripts are discovered under `~/.claude/projects` and Cradle-owned `CRADLE_DATA_DIR/runtimes/claude-agent/projects`, grouped with explicit `<session-id>/subagents/**/agent-*.jsonl` children. Codex main transcripts are discovered under the user's `~/.codex/sessions` and archived rollout roots plus Cradle-owned `CRADLE_DATA_DIR/runtimes/codex-app-server/sessions`; SubAgent rollouts are retained as bundle children rather than top-level candidates. `session_index.jsonl` supplies user-defined titles when present, and `history.jsonl` supplies a first-prompt title fallback without being treated as a transcript. Codex user history is projected only from semantic `event_msg/user_message` rows, so provider-injected AGENTS and environment context stored as `response_item/message/user` do not appear as titles or imported user messages.

Workspace identity and recovery remain owned by the Workspace module. Session creation remains owned by the Session module, and imported chat event projection remains owned by Chat Runtime. This module orchestrates those interfaces and owns source identity, revision, fidelity, import status, and synchronization semantics.

## Files

- **index.ts**: Elysia `/external-session-import` routes and generated CLI metadata.
- **model.ts**: TypeBox HTTP schemas for scans, candidates, Workspace plans, and import results.
- **catalog.ts**: Short-lived source catalog, parallel adapter discovery, duplicate projection, and Workspace planning.
- **types.ts**: Internal source adapter interface and normalized descriptor/message contracts.
- **source-utils.ts**: Stable source identity, revisions, content hashes, and normalized message helpers.
- **bundle-store.ts**: Cradle-owned atomic bundle capture, gzip compression, source-byte hashing, integrity validation, and bundle cleanup.
- **cradle-runtime-roots.ts**: Default import roots for user-owned provider homes and Cradle-owned runtime namespaces.
- **sources/claude.ts**: Read-only streaming Claude Code JSONL discovery, grouping, and bundle projection.
- **sources/codex.ts**: Read-only streaming Codex rollout discovery, grouping, and bundle projection.

Scan records are intentionally short-lived and contain no transcript payloads. Import requests reference candidate IDs from a scan. Capture verifies size and modification time before and after every streamed copy, writes the manifest last, and atomically publishes the completed bundle. Parser reads verify decompressed byte count and SHA-256 against the manifest.

Synchronization stores a per-message source checkpoint. A later provider history is appendable only when the imported checkpoint remains an exact stable prefix; rewritten or shortened history is marked divergent instead of being merged heuristically. Legacy `external_work_import_items` session records are read only for adoption: selecting a matching full source repairs its Workspace and preserves its existing Cradle Session while the new module becomes the durable import owner.
