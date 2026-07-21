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

Classify the locator before writing a query:

| Type | Example | First action |
| ---- | ------- | ------------ |
| **Scope** | "in this work", "this repo" | `overview()` + workspace/work filter |
| **Artifact** | `src/auth.ts`, session id | `fileHistory(path)` or direct id |
| **Semantic** | "auth bug fix" | `search()` with scoped opts |

Narrowest valid scope wins. Empty scoped results are valid — broaden only when the
user asks or scope was clearly wrong.

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
3. Separate evidence from inference
4. If memory influenced the answer, say it was previously recorded and cross-check
   evidence when correctness matters

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
