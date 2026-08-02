# profiles

Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

- `index.ts` — exposes `/profiles` CRUD endpoints with typed provider `config` objects at the HTTP boundary, including Available Model registry mapping updates.
- `service.ts` — coordinates manual profile CRUD, stores profile-owned models.dev mappings, validates provider-kind stability for updates, and delegates runtime-target lifecycle to `provider-targets`.
- `model.ts` — TypeBox schemas shared by the routes above.

Deleting a manual profile removes the provider target and provider-owned caches, but chat history is session-owned. Historical sessions, messages, usage records, bindings, queue items, runtime audit rows, and capability snapshots are detached from the removed provider target instead of being deleted.
