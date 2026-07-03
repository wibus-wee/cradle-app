# Agent Identity Module

Agent CRUD, filtered list queries, local Claude/Codex/Gemini/Pi/Kimi import, agent-profile ownership, and avatar URL policy.
Agent rows are the user-visible AI persona boundary; agent profiles are provider/runtime configuration and must not be used as authors. Provider-backed agents persist canonical thinking effort values `low`, `medium`, `high`, or `xhigh`; local-config import normalizes legacy `none` / `minimal` to `low` and `max` to `xhigh`.
Agent runtime validation follows provider binding and session launch descriptors: provider-required runtimes need a provider target, runtime-owned runtimes may run without one, and agent-terminal runtimes require launch configuration instead of a provider target.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **avatar.ts**: Shared DiceBear avatar URL policy for agent personas.
- **index.ts**: Elysia `/agents` routes, OpenAPI metadata, generated CLI descriptors for CRUD routes, and explicit local-config import route.
- **model.ts**: TypeBox schemas for agent requests, responses, and local-config import results.
- **service.ts**: Agent CRUD semantics, local agent config import orchestration, avatar URL policy, runtime/profile validation, provider-target enabled normalization, and constraint mapping.

Provider-backed agents can reference disabled provider targets for configuration continuity, but their `enabled` flag is normalized against provider-target availability on create and update. If the selected provider target is disabled or missing, the agent remains disabled even when the request asks to enable it.
