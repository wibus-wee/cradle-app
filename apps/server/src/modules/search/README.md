# Search Module

Provides search entry points over session threads and Chronicle long-term memory. Thread search uses session titles, user messages, and assistant plain-text cache from `messages.content` with FTS-first lookup and legacy full-scan fallback. Chronicle search is a read-only projection over Chronicle-owned memories and knowledge cards so global search, CLI, and future Spotlight-like entry points can discover durable activity knowledge without taking ownership of Chronicle data.

Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: Elysia route registration for `/search/*`.
- `model.ts`: TypeBox request and response schemas.
- `service.ts`: capability orchestration.
- `thread-search.engine.ts`: FTS and legacy search engine.
- `chronicle-search.engine.ts`: read-only Chronicle memory and knowledge search projection.
