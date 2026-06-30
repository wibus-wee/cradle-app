# Cursor Agent SPEC Restart Prompt

用于未来重启或延续 Cursor Agent 架构/SPEC 会话。

```text
You are working in /Users/wibus/dev/Cradle.

Goal:
Continue the Cursor Agent capability design from apps/server/specs/capabilities/cursor-agent.md. The target is a clean, debt-free Cradle feature model for Cursor Agent-like runtimes, including current and planned features: autonomous coding turns, tool evidence, checkpoints, queued and immediate messages, rules, skills, MCP, browser automation, image generation, terminal commands, CLI/headless execution, and background/cloud agents.

Constraints:
- Use Simplified Chinese for explanations and Markdown prose outside code fences.
- Use English for code, identifiers, comments, filenames, and code blocks.
- Preserve Cradle ownership rules: read external namespaces when needed, but write only to Cradle-owned namespaces.
- Do not put Cursor provider semantics into generic Chat Runtime contracts.
- Prefer existing Cradle APIs and provider boundaries over inventing new projections.
- Use Drizzle for any database design.
- Do not add frontend tests unless specifically requested.
- Avoid compatibility glue if an architecture upgrade is cleaner.

Current evidence:
- Cursor Agent overview describes autonomous coding, tools, checkpoints, queued messages, and immediate messaging.
- Cursor Agent tools include code/file search, web search, rule fetch, file read/edit, shell commands, browser control, image generation, and clarification questions.
- Cursor checkpoints are local snapshots, separate from Git, and support preview/restore.
- Cursor queued messages run sequentially after the active task; immediate messages bypass the queue for urgent redirection.
- Cursor rules, skills, and MCP are customization/tool-extension surfaces and should remain provider-owned or registry-owned, not Chat Runtime-owned.
- Cursor background/cloud agents and CLI/headless modes imply explicit execution placement.

Primary files to inspect:
- apps/server/specs/capabilities/cursor-agent.md
- apps/server/specs/capabilities/chat-runtime.md
- apps/server/specs/capabilities/providers.md
- apps/server/src/modules/chat-runtime/README.md
- apps/server/src/modules/chat-runtime/runtime-provider-types.ts
- apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts
- apps/server/src/modules/chat-runtime-providers/README.md
- apps/server/src/modules/provider-contracts/types.ts
- apps/server/src/modules/provider-contracts/runtime-compatibility.ts

Recommended next work:
1. Validate whether the SPEC should remain a pure capability doc or be split into implementation ExecPlans.
2. If implementing, add a cursor-agent provider directory following the provider package shape from chat-runtime-providers/README.md.
3. Register runtime metadata and provider compatibility.
4. Add only the storage/routes proven necessary by the implementation, starting with provider UI slots and queue/steer reuse.
5. Add focused provider contract and stream mapping tests.

Completion criteria:
- Cursor Agent capability SPEC remains aligned with official Cursor docs and Cradle ownership boundaries.
- Any implementation keeps Cursor-specific protocol parsing under chat-runtime-providers/cursor-agent.
- Chat Runtime continues to expose provider-neutral AI SDK chunks, queue, cancellation, runtime status, and UI slot state.
- No code writes to Cursor-owned namespaces unless the user explicitly edits workspace files.
```

