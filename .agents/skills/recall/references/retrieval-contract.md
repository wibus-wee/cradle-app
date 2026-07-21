# Cradle Recall — Retrieval Contract

Agent-facing rules for `recall_query`. Mirrors Obelisk retrieval semantics, adapted
for Cradle-native evidence.

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

## Scope first

**Default: current workspace** — including Work primary threads. Work is task
orchestration (L5), not a recall boundary. Do not restrict to Work-linked sessions
unless the user explicitly asks ("just this Work", "this task only").

Classify the locator before writing a query:

| Type | Example | Scope |
| ---- | ------- | ----- |
| **Semantic** | "auth bug fix", "上次怎么修的" | `workspaceId` (default) |
| **Session** | "this chat", "刚才说的" | `sessionId` |
| **Work-narrow** | "only in this Work" | `workId` filter (opt-in) |
| **Issue-narrow** | "on this issue" | `issueId` filter (opt-in) |
| **Artifact** | `src/auth.ts`, message id | path/id helpers, still workspace unless session-specific |

```js
// Default — workspace-wide (even in a Work session)
search('auth fix', { workspaceId: overview().workspace.id, limit: 8 });

// Opt-in narrow — only when user asked
search('auth fix', { workId: overview().work?.id, limit: 8 });
```

`overview()` shows Work/Issue for orientation; it does **not** auto-apply them as
search filters.

Broaden to cross-workspace/global only when the user asks or workspace search is
clearly insufficient.

## Orient first

For a new recall task without an exact id/path:

```js
return overview({ limit: 6 });
```

`overview()` is a **map**, not evidence. Confirm facts with `search`, `memories`, or
helpers — not with overview alone.

## Helper first

Prefer helpers over raw SQL:

| Helper | Use for |
| ------ | ------- |
| `overview(opts?)` | Orientation |
| `search(text, opts?)` | Keyword / FTS evidence |
| `context(messageId)` | Expand one hit |
| `thread(sessionId, opts?)` | Bounded transcript |
| `failures(opts?)` | Failed tool calls |
| `fileHistory(path, opts?)` | File edit/read history |
| `runs(sessionId, opts?)` | Run lifecycle |
| `memories(opts?)` | L2 prior conclusions |

Escalate to `sql()` only for joins/aggregations helpers cannot express. Read
`references/schema.md` when it exists (Phase C); until then inspect with tiny scoped
queries (`Object.keys(row)`).

## Plan before probe

For synthesis, failure investigation, or file evolution, write **one bounded script**
instead of multiple exploratory tool calls.

Bad: three separate `recall_query` calls returning huge threads.
Good: one script that searches, takes top 3 hits, projects id + 240-char snippet.

## Structure before text

Compute counts, filters, and projections in the script. Return compact JSON:

```js
return hits.slice(0, 5).map(h => ({
  session_id: h.session.id,
  message_id: h.message.id,
  snippet: h.message.text?.slice(0, 240),
}));
```

Target **&lt; 10k–12k characters** stdout for synthesis tasks.

## Evidence before conclusion

In the final answer to the user:

1. Cite stable IDs (`session_id`, `message_id`, `run_id`, `tool_call_id`)
2. Use short snippets, not pasted transcripts
3. Separate evidence from inference — never merge without labels
4. See **Synthesis protocol** below when both evidence and memory are present

## Synthesis protocol (evidence + memory)

When `recall_query` returns both evidence and memory, structure the script output
for synthesis tasks as three channels:

```js
return {
  evidence: [/* hits from search, failures, fileHistory, context — with ids */],
  memories: [/* hits from memories() — with id + summary */],
  conflicts: [/* { memory_id, evidence_id, note } or [] */],
};
```

**Rules for the final answer:**

| Claim | Constraint |
| ----- | ---------- |
| Fact (file, tool, time, outcome) | Requires `evidence` cite. No ID → not a fact. |
| Why / lesson / intent | Mark as inference; memory may inform hypothesis only. |
| From memory alone | Say: "Previously recorded (not re-verified here): …" |
| Memory vs evidence conflict | Report both; **evidence wins** on facts; never hide conflict. |
| Nothing found | Say so; do not invent history. |

**Do not:**

- Quote memory as if you re-read the original session in this query
- Let memory override evidence on paths, failures, or timestamps
- Propose attune without evidence support in the same query (unless user explicitly requests recording their stated conclusion)

## Memory vs evidence

| | Evidence | Memory |
| --- | -------- | ------ |
| Query | `search`, `failures`, `thread`, … | `memories({ query })` |
| Authority | Ground truth | Prior note |
| Write | Read-only in `recall_query` | `recall_attune` + user approval |

Do not propose attune for one-off lookups, uncertain findings, or duplicates of
existing memories.

## Exclude control-plane by default

Cradle may persist steer messages, harness-adjacent synthetic content, and internal
continuation markers. Treat these as **non-user-intent** unless investigating
control-plane behavior explicitly.

When SQL is used for ordinary conversation evidence, prefer filtering meta/control
rows when the schema exposes them.

## Errors

If a query fails:

1. Read the error message
2. Check helper option names (do not invent fields — sample one row first)
3. Retry with narrower scope or simpler helper
4. Do not loop more than 2–3 query attempts without changing strategy

## Compaction and re-query

Provider compaction may remove recalled evidence from context. That is expected.
Re-run a focused `recall_query` if you need the same facts again — do not rely on
recall results surviving compaction.
