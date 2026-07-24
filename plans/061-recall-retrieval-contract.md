# Plan 061 — Retrieval contract (agent-facing, pre-skill)

> **Status:** Design draft. **Not** an installed agent skill — skill ships in Phase B
> when `recall_query` runtime exists.
>
> Parent: `plans/061-cradle-recall-agent-cognition-stack.md`

Agent-facing rules for future `recall_query`. Mirrors Obelisk retrieval semantics,
adapted for Cradle-native evidence.

## Cognition stack (where recall fits)

```text
L5 Orchestration   — Work, Issue, Queue (task routing)
L4 Assembly        — harness, transcript (push-only; recall does NOT live here)
L3 Retrieval       — recall_query, recall_attune ← YOU ARE HERE
L2 Memory          — Chronicle, attune (curated synthesis)
L1 Evidence        — messages, run snapshots, tool parts (ground truth)
```

Recall results enter the agent context **only as `recall_query` tool results** at the
conversation tail — never as rebuilt system prompt or harness injection.

The runtime binds the current session and workspace before the query runs. `code`
never supplies authority: helper options may narrow the bound workspace but cannot
select another one. A shared MCP server without a trusted caller-session bridge
must not expose this tool.

## Scope

**Default: current workspace** — including Work primary threads. Work is task
orchestration (L5), not a recall boundary. Do not restrict to Work-linked sessions
unless the user explicitly asks ("just this Work", "this task only").

| Type             | Example                        | Scope                     |
| ---------------- | ------------------------------ | ------------------------- |
| **Semantic**     | "auth bug fix", "上次怎么修的" | `workspaceId` (default)   |
| **Session**      | "this chat", "刚才说的"        | `sessionId`               |
| **Work-narrow**  | "only in this Work"            | `workId` filter (opt-in)  |
| **Issue-narrow** | "on this issue"                | `issueId` filter (opt-in) |
| **Artifact**     | `src/auth.ts`, message id      | path/id helpers           |

```js
// Default — workspace-wide (even in a Work session)
search('auth fix', { limit: 8 })

// Opt-in narrow — only when user asked
search('auth fix', { workId: overview().work?.id, limit: 8 })
```

`overview()` shows Work/Issue for orientation; it does **not** auto-apply them as
search filters.

## Orient first

For a new recall task without an exact id/path:

```js
return overview({ limit: 6 })
```

`overview()` is a **map**, not evidence.

## Helper first

Prefer helpers over raw SQL: `overview`, `search`, `context`, `thread`, `failures`,
`fileHistory`, `runs`, `memories`. Escalate to `sql()` only for joins/aggregations
helpers cannot express.

## Synthesis protocol (evidence + memory)

When both evidence and memory are present, structure script output as:

```js
return {
  evidence: [
    /* search, failures, fileHistory — with ids */
  ],
  memories: [
    /* memories() — with id + summary */
  ],
  conflicts: [
    /* { memory_id, evidence_id, note } or [] */
  ]
}
```

**Final answer rules:**

| Claim                            | Constraint                                            |
| -------------------------------- | ----------------------------------------------------- |
| Fact (file, tool, time, outcome) | Requires `evidence` cite. No ID → not a fact.         |
| Why / lesson / intent            | Mark as inference; memory may inform hypothesis only. |
| From memory alone                | Say: "Previously recorded (not re-verified here): …"  |
| Memory vs evidence conflict      | Report both; **evidence wins** on facts.              |
| Nothing found                    | Say so; do not invent history.                        |

**Do not:** quote memory as re-read evidence; let memory override paths/failures/
timestamps; propose attune without evidence in the same query.

## Default first pass

```js
const map = overview({ limit: 6 })
const topic = 'English topic terms from the user request'

return {
  orientation: map,
  prior_memories: memories({ query: topic, limit: 5 }),
  session_evidence: search(topic.replace(/[-_]/g, ' '), { limit: 8 })
}
```

Compact JSON target: **< 10k–12k chars** for synthesis tasks.

## Phase B deliverable

When `recall_query` ships, promote this contract into `.agents/skills/recall/SKILL.md`
(+ optional reference splits). Until then, this file is the single source of truth.
