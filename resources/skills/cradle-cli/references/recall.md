# Recall evidence retrieval

Use Recall when this workspace's past chat or execution evidence may matter—not only when the user explicitly asks about history. It is a session-bound, runtime-provided MCP capability; it is not a global database search and it does not replace the `cradle` CLI for ordinary Cradle operations.

## Query prior evidence

Call `recall_query` when past chat or execution context in this workspace may matter—even if the user never says "before" or "earlier". Prefer a quick check over guessing a prior decision, agreement, attempt, failure, or file-related history. The tool accepts JavaScript CodeAct that exports a default function and returns JSON-compatible data.

```js
export default async function () {
  return search('recall design', { limit: 10 })
}
```

Start with a narrow search or overview, then retrieve the exact thread, context, run, failure, or file history needed for the answer. Preserve stable IDs and cite the returned evidence in the response when they make the answer auditable.

Available query helpers:

- `overview({ limit? })` — recent execution overview and active session identity.
- `search(text, { sessionId?, limit?, includeSidechains?, includeMeta? })` — search workspace execution evidence.
- `context(messageId)` — retrieve context around a message.
- `thread(sessionId, { limit?, includeSidechains? })` — retrieve a session thread.
- `failures({ sessionId?, limit? })` — retrieve recorded failures.
- `fileHistory(path, { sessionId?, limit? })` — retrieve prior work involving a file.
- `runs({ sessionId?, limit? })` — retrieve execution runs.
- `memories({ query?, limit? })` — retrieve durable Recall memories.

Recall always binds reads to the active runtime workspace. Optional `sessionId` filters can narrow that scope only; they cannot broaden it to another workspace. Treat the tool as read-only.

## Propose a durable memory change

Call `recall_attune` only when the user explicitly asks to remember, update, or forget something for future use. Anchor a remembered statement to evidence IDs returned by Recall; do not create an ungrounded memory from an inference or a vague preference.

The CodeAct must export a default function and request exactly one operation:

```js
export default async function () {
  remember('Use the runtime-bound MCP environment for Recall.', ['evidence-id'])
}
```

```js
export default async function () {
  forget('memory-id')
}
```

An attune call creates only a pending proposal. State that it is awaiting user approval; do not represent it as saved or forgotten unless the approval flow completes.

## Boundaries

- Do not auto-run Recall or inject its output into the harness before a request.
- Do not expose its individual helpers as standalone MCP tools.
- If `recall_query` or `recall_attune` reports that no Cradle chat session is bound, explain that the current runtime did not receive session scope and use an appropriate supported path rather than attempting to widen scope manually.
