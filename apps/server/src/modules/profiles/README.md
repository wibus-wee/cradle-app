# profiles

Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

- `profiles.module.ts` — wires saved profile endpoints and lifecycle service.
- `profiles.controller.ts` — exposes `/profiles` CRUD endpoints with typed provider `config` objects at the HTTP boundary, including Available Model registry mapping updates.
- `profiles.service.ts` — coordinates manual profile CRUD, stores profile-owned models.dev mappings, validates provider-kind stability for updates, and delegates runtime-target lifecycle to `provider-targets`.

Deleting a manual profile removes the provider target and provider-owned caches, but chat history is session-owned. Historical sessions, messages, usage records, bindings, queue items, runtime audit rows, and capability snapshots are detached from the removed provider target instead of being deleted.
