# Cradle Server

HTTP server for Cradle built on Tsuki/Hono.

The repository is actively introducing a parallel Elysia migration path under `src/app.ts` and `src/http/` while the Tsuki path still owns production traffic. That path now includes shared validation normalization plus a first real feature slice for `GET/PUT /preferences/chat`.

## Architecture

The server follows the repository convention of **technical primitives + business modules**:

- `src/config`: environment and runtime config
- `src/http`: parallel Elysia request-id/error/OpenAPI/validation-normalization infrastructure for the migration path
- `src/database`: DB lifecycle and typed access
- `src/errors`, `src/filters`, `src/logging`, `src/middlewares`: cross-cutting infrastructure
- `src/openapi`: HTTP OpenAPI endpoints backed by the local `@cradle/openapi` package
- `src/modules/*`: capability-owned business modules
- `tests`: integration and foundation tests
- `specs/capabilities`: migration specs and status tracking

## Implemented capabilities

- `health`
- `database`
- `workspace`
- `automation`
- `approval`
- `acp`
- `session`
- `chat-runtime`
- `agent-identity`
- `kanban`
- `issue-agent`
- `git`
- `observability`
- `preferences`
- `pty`
- `workflow-rules`
- `profiles`
- `secrets`
- `providers`
- `skills`
- `usage-tracking`
- `search`

## Environment

- `CRADLE_DATA_DIR`: server data root (required unless `CRADLE_DB_PATH` is set)
- `CRADLE_DB_PATH`: explicit database path override
- `CRADLE_HOST`: bind host
- `CRADLE_PORT`: bind port
- `CRADLE_LOG_LEVEL`: logger level
- `CRADLE_LOG_FILE`: explicit server log file path
- `CRADLE_LOG_SYNC`: set to `1` to write the file log synchronously during crash diagnostics
- `CRADLE_CREDENTIAL_SECRET`: secret used to encrypt server-owned secrets

## Commands

- `pnpm dev`: start nodemon development server
- `pnpm test`: run Vitest suite
- `pnpm typecheck`: run TypeScript type-check
- `pnpm build`: build the server bundle into `dist`.
- `pnpm build:desktop-runtime`: build the server bundle, use `pnpm deploy --prod` to prepare `dist/desktop-runtime` from the server package dependency graph, and force-rebuild that artifact's native dependencies from source for Cradle desktop's Electron Node ABI.

## Elysia migration status

- `src/app.ts` is the explicit composition root for the parallel Elysia path.
- `src/http/validation.ts` normalizes Elysia validation failures into the repository's structured error envelope.
- `src/modules/health/health.routes.ts` and `src/modules/preferences/preferences.routes.ts` are the currently migrated feature-owned route factories.
