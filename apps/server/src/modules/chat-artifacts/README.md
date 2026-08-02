# Chat Artifacts

Owns durable **Agent Artifact** records for a chat session: constrained JSX
source authored via the `write_artifact` Cradle MCP tool, rendered by the web
Artifact host in the Browser Panel.

## Storage

Filesystem under `{dataDir}/chat-artifacts/{sessionId}/{artifactId}.json`.

No DB schema — intentional for v1. Records include `revision` so updates are
monotonic and the panel can refresh by id.

## HTTP

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/chat-artifacts` | Upsert (create or update) |
| GET | `/chat-artifacts/:sessionId` | List |
| GET | `/chat-artifacts/:sessionId/:artifactId` | Get |

## Validation

Source must:

- `import` only from `cradle/artifact` (and optionally `react`)
- `export default` a React component
- Avoid `require` / dynamic `import` / `eval` / `new Function` / runtime globals
