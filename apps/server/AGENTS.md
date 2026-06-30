# Tsuki — guide for LLMs and coding agents

Use this file when you edit the Tsuki monorepo or scaffold/extend an application that depends on `@tsuki-hono/*`. It is tool-agnostic (Cursor, Claude Code, Codex, etc.). Human-oriented docs: package READMEs under `packages/*/README.md`. This repo also has `CLAUDE.md` with overlapping maintainer notes.

## What Tsuki is

- TypeScript libraries that layer NestJS-like modules, decorators, and a request pipeline on top of Hono (HTTP) and tsyringe (DI).
- Not a single deployable server: consumers compose `@Module` / `@Controller` classes and call `createApplication` from `@tsuki-hono/core`.

## Cradle server architecture philosophy

The server is organized as **technical primitives + business modules** (二维结构), prioritizing explicit ownership and dependency direction.

**Target layout (conceptual):**

```
apps/server/src/
	app.module.ts
	app.factory.ts
	index.ts

	modules/                 # business capabilities (domain)
		health/
		workspace/
		session/
		agent-identity/

	database/                # runtime DB access (infra only)
	redis/                   # runtime Redis access
	filters/
	guards/
	interceptors/
	middlewares/
	pipes/
	errors/
	logging/
	config/
	helpers/
	openapi/
```

**Non-negotiable dependency rules:**

- `modules/*` **may depend on** `database/redis/filters/guards/...`.
- `database/redis/*` **must not depend on** `modules/*` (no feature imports).
- Request context (tenant/workspace/user) is **written in middleware/interceptor** and **read by infra**.
- `app.module.ts` is composition only: assemble imports, never business logic.

**Why this shape:**

- Technical folders keep cross-cutting concerns visible and consistent.
- `modules/` owns domain semantics, keeping capabilities cohesive.
- Dependency direction stays clean, preventing infra from being polluted by feature logic.

## Package dependency graph

- `@tsuki-hono/common` — decorators, metadata, `HttpContext`, exceptions, pipes (e.g. Zod), logger helpers, enhancer interfaces. Peer foundation: `reflect-metadata`, `tsyringe`, `zod` (as used by pipes/OpenAPI).
- `@tsuki-hono/core` — `createApplication`, `HonoHttpApplication`, route registration, container wiring, global enhancers. Depends on `common` + `hono`.
- `@tsuki-hono/event-emitter` — Redis pub/sub events (`@OnEvent`, `@EmitEvent`, `EventModule`). Depends on `common` + `core`; peer: `ioredis`.
- `@cradle/openapi` — Cradle-owned OpenAPI 3.1 generation from Tsuki decorator metadata. Depends on `@tsuki-hono/common` + `zod`.

Lower layers must not import higher layers (e.g. `common` must not import `core`).

## Request pipeline (mental model)

Order matters for debugging and for where to attach behavior:

Request → `HttpContext.run()` → Guards → Interceptors (pre) → Pipes → Route handler → Interceptors (post) → (on error) Exception filters → Response

Global enhancers are registered with tokens: `APP_GUARD`, `APP_PIPE`, `APP_INTERCEPTOR`, `APP_FILTER`, `APP_MIDDLEWARE` (from `@tsuki-hono/common`).

## How consumers bootstrap an app

1. Ensure `reflect-metadata` is loaded before any decorator-using module (first import in entry).
2. Define `@injectable()` services and `@Controller('path')` classes with `@Get` / `@Post` / etc.
3. Define a root `@Module({ imports?, controllers?, providers? })` class.
4. `const app = await createApplication(AppModule, options?, optionalHonoInstance?)`.
5. Expose Hono: `app.getInstance().fetch` (e.g. pass to `@hono/node-server` `serve`, or workers adapters).
6. On shutdown: `await app.close(...)`.

`ApplicationOptions` includes optional `container`, `globalPrefix`, `logger`.

Handlers should return plain objects/values suitable for framework serialization; do not assume manual `Response` unless the pattern in code/docs requires it.

## Module metadata (authoring rules)

`@Module` accepts:

- `imports` — other module classes (supports `forwardRef(() => Module)` for cycles).
- `controllers` — controller classes.
- `providers` — constructors or provider objects: `useClass`, `useValue`, `useExisting`, `useFactory` (+ `inject`, `singleton` where applicable).

Register tokens in module `providers` before injecting them. tsyringe is used in strict mode: missing registrations throw at runtime.

## Non-negotiable rules (common agent mistakes)

1. **DI tokens need runtime imports** — use `import { MyService } from './my.service'`, never `import type { MyService }` for anything passed to `@inject`, constructor parameter types resolved by tsyringe, or `providers` arrays. If emitDecoratorMetadata is on, TypeScript erases type-only imports and injection breaks silently or at runtime.
2. **`reflect-metadata` first** — entry file and tests must load it before decorators. Package `common` re-exports after importing it; app entry should still `import 'reflect-metadata'` explicitly at the top.
3. **TypeScript** — The project uses TC39 standard decorators (not legacy `experimentalDecorators`). TypeScript 5.x handles these natively.
4. **`@Controller()`** on HTTP classes (it applies tsyringe `@injectable()` internally). Other injectable services need **`@injectable()`** from `tsyringe` on the class.
5. **`HttpContext`** is AsyncLocalStorage-scoped to the request: do not read it during module static init or before request middleware establishes context.

## Working inside this monorepo

- **Package manager**: pnpm 10.x workspaces.
- **Verify before claiming done**: `pnpm test`, `pnpm typecheck`, and for broad edits `pnpm build`. Per package: `cd packages/<name> && pnpm test`.
- **Tests**: Vitest + SWC; each package has `vitest.setup.ts` importing `reflect-metadata`. Integration style: `createApplication(Module)` → `app.getInstance().request(path, init?)` → assert; `await app.close()` in `afterEach` / teardown.
- **Lint/format**: `pnpm lint`, `pnpm format`. Pre-commit runs lint-staged.
- **When changing behavior**: prefer tests in the package that owns the code (`core` for runtime, `common` for decorators/interfaces, etc.).

## OpenAPI and events

- OpenAPI: use `@cradle/openapi` alongside route/OpenAPI decorators from `common` as per `packages/openapi` README; keep Zod schemas aligned with handler inputs when documenting.
- Events: import `EventModule` and Redis configuration from `@tsuki-hono/event-emitter`; do not duplicate pub/sub logic in `core`.

## Summary for agents

- Treat Tsuki as **metadata-driven composition over Hono**, not a Nest fork.
- Preserve **package boundaries** and **strict DI** semantics.
- After code changes, **run the relevant package tests and repo typecheck** before concluding the task is complete.

## Packages

| Package                     | Description                                                            |
| --------------------------- | ---------------------------------------------------------------------- |
| `@tsuki-hono/common`        | Decorators, interfaces, exceptions, pipes, logger, and request context |
| `@tsuki-hono/core`          | Application runtime, DI container utils, route registration            |
| `@tsuki-hono/event-emitter` | Redis pub/sub event system with `@OnEvent` / `@EmitEvent`              |
| `@cradle/openapi`           | Cradle-owned OpenAPI 3.1 document generation from Tsuki metadata       |
