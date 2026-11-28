# External Session Import Module

Cradle-owned import boundary for provider-owned Claude, Codex, Kimi, and OpenCode chat sessions.

The module reads external provider namespaces without modifying them. Discovery streams bounded JSONL metadata and returns lightweight descriptors plus historical Workspace recovery plans; transcript bodies never enter the browser. Import first copies every selected JSONL member into an immutable gzip-compressed bundle under `CRADLE_DATA_DIR/external-session-import`, records original-byte SHA-256 hashes, then projects chat history only from that Cradle-owned bundle. Neither the Claude SDK nor Codex app-server participates in import.

Claude Code main transcripts are discovered under `~/.claude/projects` and Cradle-owned `CRADLE_DATA_DIR/runtimes/claude-agent/projects`, grouped with explicit `<session-id>/subagents/**/agent-*.jsonl` children. Codex main transcripts are discovered under the user's `~/.codex/sessions` and archived rollout roots plus Cradle-owned `CRADLE_DATA_DIR/runtimes/codex-app-server/sessions`; SubAgent rollouts are retained as bundle children rather than top-level candidates. `session_index.jsonl` supplies user-defined titles when present, and `history.jsonl` supplies a first-prompt title fallback without being treated as a transcript. Codex user history is projected only from semantic `event_msg/user_message` rows, so provider-injected AGENTS and environment context stored as `response_item/message/user` do not appear as titles or imported user messages.

Kimi Code sessions are discovered under `$KIMI_CODE_HOME` (else `~/.kimi-code`) plus every Cradle-owned kimi runtime provider home: a session is `sessions/<workdir slug>/<session id>/` with one `agents/<agent>/wire.jsonl` per agent, the main agent's file as the candidate and the rest as subagent children. `state.json` supplies custom titles, `cwd`/`workDir`, and fork metadata, rides along in the bundle so a retitle invalidates the revision, and `session_index.jsonl` at the home root supplies the folder for early sessions that name neither. Forks project the copied pre-fork history they continue from; migrated Python kimi-cli content arrives as untimed `context.append_message` records while Kimi Code's own timed duplicates are skipped.

OpenCode sessions are discovered under `$XDG_DATA_HOME/opencode` (else `~/.local/share/opencode`). Where `opencode.db` exists only it is read — the legacy `storage/` JSON files stay behind and go stale. OpenCode 2's `session_v2`/`session_message` tables are authoritative once the `migration.v1-v2` kv record completes; while migration is underway, uncopied sessions are still read from the v1 tables. Subagent sessions group under their root parent via `parent_id`. Because the database is one mutable file shared by every session, capture produces a consistent image through SQLite's own locking (better-sqlite3 `serialize()`), filters it down to the selected session tree, and stores that as the immutable bundle member — unrelated sessions never enter the bundle. Legacy `storage/` sessions capture as ordinary layout-preserving files. Cradle's managed opencode runtime shares the user's native OpenCode data home, so there is no separate Cradle-owned import root.

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
- **sources/kimi.ts**: Read-only streaming Kimi Code `wire.jsonl` discovery, fork/migrated-content semantics, and bundle projection.
- **sources/opencode.ts**: OpenCode SQLite (v1/v2) and legacy `storage/` discovery, consistent filtered database snapshot capture, and bundle projection.

Scan records are intentionally short-lived and contain no transcript payloads. Import requests reference candidate IDs from a scan. Capture verifies size and modification time before and after every streamed copy, writes the manifest last, and atomically publishes the completed bundle. Parser reads verify decompressed byte count and SHA-256 against the manifest.

Synchronization stores a per-message source checkpoint. A later provider history is appendable only when the imported checkpoint remains an exact stable prefix; rewritten or shortened history is marked divergent instead of being merged heuristically. Legacy `external_work_import_items` session records are read only for adoption: selecting a matching full source repairs its Workspace and preserves its existing Cradle Session while the new module becomes the durable import owner.
