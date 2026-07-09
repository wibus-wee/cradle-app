---
name: cli-app-development
description: Use when modifying Cradle packages/cli, the OpenAPI-to-CLI generator, generated command runtime, output formats, command registration, or validation workflow for the generated Cradle CLI.
---

# CLI App Development

Use this skill for `packages/cli` work. Cradle CLI is generated-first and Agent-oriented: default output should be readable for humans, while structured data must remain explicit and predictable for shell pipelines.

## Architecture

The CLI package has two layers:

- `src/runtime`: stable runtime helpers for HTTP requests, command registration, output formatting, and execution context.
- `src/commands/generated`: generated command modules created by `pnpm gen:cli`.

The generator is `scripts/generate-cli.ts`:

- It creates an in-process `apps/server` Elysia app.
- It reads `/openapi.json`.
- It finds operations with `x-cradle-cli.command`.
- It infers arguments and flags from OpenAPI path/query/body schemas.
- It writes one TypeScript command module per command plus `index.generated.ts`.

Do not manually edit files in `src/commands/generated`. Change the server route metadata or generator/runtime, then regenerate.

## Command Contract

Server route metadata controls only command placement:

```typescript
'x-cradle-cli': {
  command: ['workspace', 'git', 'status'],
  defaultWorkspaceId: true, // optional ambient workspace
  // defaultChatSessionId: true, // optional ambient chat session
}
```

Generator responsibilities:

- Path parameters -> positional arguments.
- Query parameters -> `--kebab-case` flags.
- Body object properties -> `--kebab-case` flags.
- Required schema fields -> Commander required options.
- Array schema fields -> comma-separated or repeated string input handling.
- Object schema fields -> JSON string parsing.
- Enum schema fields -> allowed values in help text.
- `defaultWorkspaceId: true` -> workspace name/id resolver with ambient env/cwd fallback.
- `defaultChatSessionId: true` -> `envDefault: 'CRADLE_CHAT_SESSION_ID'` on chat-session id fields (makes path `[id]` optional).

## Output Philosophy

Default output is gh-style `auto`: render lists as bordered terminal tables when scalar columns exist, render acknowledgements as short text, and fall back to pretty JSON when the shape is too nested to display safely.

Agents should request structured output explicitly:

Supported formats:

```bash
--json
--json id,name,status
--format auto
--format json
--format pretty
--format table
--format ndjson
```

Do not add built-in filtering, sorting, or query languages unless there is a strong product reason. Agents can compose those with standard shell tools. Top-level field selection belongs to `--json <fields>` because it mirrors gh CLI and keeps common Agent calls compact.

## Development Workflow

1. If adding commands, prefer adding `x-cradle-cli.command` to server routes first.
2. If schema inference is wrong, fix `scripts/generate-cli.ts`; do not patch generated command files.
3. If command execution or output is wrong, fix `src/runtime`.
4. Regenerate commands:

```bash
pnpm gen:cli
```

5. Validate the CLI package:

```bash
pnpm --filter @cradle/cli typecheck
pnpm --filter @cradle/cli cradle --help
```

6. Check representative nested command help for the area changed:

```bash
pnpm --filter @cradle/cli cradle workspace --help
pnpm --filter @cradle/cli cradle issue --help
```

## Safety Rules

- Do not expose secret value writes as generated flags unless the product explicitly accepts shell-history risk.
- Do not generate plain commands for SSE streams or PTY interactive endpoints.
- Keep generated command modules deterministic and simple.
- Keep runtime helpers small; the server OpenAPI contract should remain the source of truth.
- If a route is omitted intentionally, document the omission in the server module README or final response.

## Completion Checklist

Before calling CLI work done:

- `pnpm gen:cli` succeeds.
- `pnpm --filter @cradle/cli typecheck` succeeds.
- Generated commands no longer require manual operation IDs.
- The command count and top-level groups match the intended server exposure.
- Representative `--help` output shows inferred arguments and flags.
