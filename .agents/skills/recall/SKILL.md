---
name: recall
description: >
  Query Cradle execution memory — past sessions, tool failures, file history, runs.
  Reactive: when the user asks "how did we fix X", "what did we do last time",
  "find the session where", "上次怎么修的", "之前的 session", "历史记录".
  Proactive: when you lack context for past work, before modifying a file with complex
  edit history, when the user says "继续之前的", or when prior decisions would
  improve your response.
  Memory: when the user says "记住这个", "remember this", "写入记忆", or when a
  retrieval yields a conclusion worth persisting (requires user approval via attune).
---

# recall

Cradle **execution memory** — query native session history, tool evidence, and approved
memory. This is **Layer 3 Retrieval** in the Cradle Agent Cognition Stack. It is
**explicit act**, not ambient background context.

**Use the in-chat tool `recall_query`** (CodeAct). Write a small JS script, run it,
read JSON, answer with cited evidence.

Do **not** assume history is already in context. Do **not** dump full transcripts.
Do **not** treat Chronicle memory as final authority without checking evidence.

Full contract: `references/retrieval-contract.md`

## Quick start

1. Write a bounded JS query (async IIFE or `return` expression).
2. Call **`recall_query`** with the script source.
3. Parse the JSON result and answer with concise evidence + stable IDs.

For approved durable conclusions, use **`recall_attune`** after user approval (Phase D;
not available until runtime lands).

## Default first pass

Start with helpers, not raw SQL. On the first recall in a task, normally call
`overview({ limit: 6 })` unless the user gave an exact `session_id`, `message_id`, or
absolute file path.

```js
const map = overview({ limit: 6 });
const topic = 'English topic terms from the user request';

return {
  orientation: map,
  prior_memories: memories({ query: topic, limit: 5 }),
  session_evidence: search(topic.replace(/[-_]/g, ' '), { limit: 8 }),
};
```

Use `sql()` only when helpers cannot express the join or aggregation.

## Scope (narrowest first)

1. Current session
2. Current Work-linked sessions (if in a Work thread)
3. Current Issue-linked sessions (when available)
4. Current workspace
5. Global — only when user asks to broaden

Empty scoped results are valid. Do not silently broaden without reason.

## Authority

| Source | Role |
| ------ | ---- |
| Evidence (messages, tools, runs) | Ground truth — cite `message_id`, `run_id`, `session_id` |
| Memory (Chronicle, attune) | Prior notes — say "previously recorded"; verify against evidence when correctness matters |
| Your synthesis | Must follow evidence; never invent history |

## Retrieval rules (summary)

- **Orient first** — `overview()` before deep probes
- **Helper first** — `search`, `failures`, `fileHistory`, `memories` before `sql()`
- **Plan before probe** — one bounded script for complex questions
- **Evidence before conclusion** — return IDs + short snippets, then synthesize
- **Compact output** — target &lt; 10k–12k chars JSON for synthesis tasks
- **No ambient recall** — only run `recall_query` when you need history

## When to use

| Situation | Action |
| --------- | ------ |
| User asks about past fix/decision | `recall_query` |
| File has complex edit history | `fileHistory(path)` inside query |
| Investigating tool failures | `failures({ limit: 20 })` |
| "Continue where we left off" | `overview` + scoped `search` |
| Conclusion worth keeping | Propose memory → user approves → `recall_attune` (when available) |

## When not to use

- Current session already has the answer in visible transcript
- Question is about live workspace files (use filesystem tools)
- User wants real-time status (use runtime/session APIs, not recall)

## References

| File | Use when |
| ---- | -------- |
| `references/retrieval-contract.md` | Scope, authority, helper-first, evidence rules |
| `plans/061-cradle-recall-agent-cognition-stack.md` | Full architecture and phases |

## Runtime status

**Phase A (design only):** Skill contract is authoritative; `recall_query` tool may
not exist yet. If the tool is unavailable, tell the user Recall is not wired and use
visible context only.

When `recall_query` lands (Plan 061 Phase B), this skill becomes operational.
