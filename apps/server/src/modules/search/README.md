# Search Module

Provides search entry points over session threads and Chronicle long-term memory. Thread search uses session titles, user messages, and assistant plain-text cache from `chat_message_payloads.content`. The Search namespace owns the `messages_fts` and `sessions_fts` SQLite FTS5 projections created by migration `0056_thread_search_fts.sql`; database triggers backfill and maintain them as canonical messages, payloads, titles, and sessions change. The engine may replace rows with Jieba-segmented text when indexing explicitly, but correctness does not depend on that optional enhancement. If FTS is unavailable, the compatibility path scans only a fixed recent-session and recent-message window instead of loading the complete transcript corpus.

Chronicle search is a read-only projection over Chronicle-owned memories and knowledge cards so global search, CLI, and future Spotlight-like entry points can discover durable activity knowledge without taking ownership of Chronicle data.

Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: Elysia route registration for `/search/*`.
- `model.ts`: TypeBox request and response schemas.
- `service.ts`: capability orchestration.
- `thread-search.engine.ts`: FTS and legacy search engine.
- `chronicle-search.engine.ts`: read-only Chronicle memory and knowledge search projection.
