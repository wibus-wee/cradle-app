# Skills Module

Provides filesystem-backed skill inventory, CRUD, import/export, and source-fetch flows across builtin, standard global `.agents`, repository `.agents`, Cradle-owned global, workspace, and agent scopes.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.
The module may read standard `~/.agents/skills` as the legacy compatibility scope and `<workspace>/.agents/skills` as the repository scope, but Cradle-owned writes use `~/.cradle/skills`, workspace `.cradle/skills`, or agent `~/.cradle/agents/{agentId}/skills`.
Agent scope initialization owns the whole agent home at `~/.cradle/agents/{agentId}`. It creates `skills/`, links `.agents/skills -> ../skills` and `.claude/skills -> ../skills`, and links bundled builtin skill packages into `skills/` so Codex and Claude-compatible scanners see the same agent-scoped inventory without Cradle writing into foreign namespaces.
Native skill projection is the compatibility layer for skills that runtimes only discover by scanning their own skill roots.

**Invoke id = skill name = directory basename.** Projection never stacks ownership prefixes into the invocable name. Plugin skills should register as `cradle-plugin-{name}` (and resource skills as `cradle-resource-{name}`) so Cradle inventory, Claude `/skill` calls, and on-disk basenames stay identical.

When an agent-scoped runtime home is known, Cradle projects active plugin skill packages as direct children of `~/.cradle/agents/{agentId}/skills/{skillName}` (flat layout). Bundled builtin skills from `resources/skills` continue to be linked as direct children of the same agent `skills/` root. Runtimes that read through `.agents/skills` or `.claude/skills` see the same inventory through the existing symlink — important because Claude only discovers leaf skill directories.

When Codex or Claude starts without an agent id, provider-global projection is off by default and only runs when the app feature flag `nativeProviderSkillProjection` is enabled. With that flag enabled:

- Codex (recursive scanner): `~/.codex/skills/cradle/{skillName}`
- Claude (leaf-only scanner): `~/.claude/skills/{skillName}`

Projection uses directory symlinks to the full skill package and does not write marker or receipt files into the projected package. Ownership is reconcile + symlink only; stale Cradle-managed links are removed when a skill is disabled.
Skill export writes into a user-selected destination directory outside Cradle-owned storage, so `/skills/export` requires `confirmedNonCradleOwnedWrite: true` and returns `ownerBoundary` metadata naming that export directory.

## Files

- `index.ts`: Elysia routes for skills inventory, document CRUD, import/export, fetch-source, and generated CLI metadata.
- `model.ts`: TypeBox request and response schemas for the skills API.
- `skills.service.ts`: workspace resolution and orchestration.
- `skills.store.ts`: filesystem-backed catalog, CRUD, import, and export logic; directory symlinks are followed when they expose a `SKILL.md` package.
- `skill-source.store.ts`: source parsing, discovery, and fetch-session cleanup.
- `skills-paths.ts`: scope root resolution, agent runtime-home initialization, builtin skill links, and write-ownership rules.
- `native-skill-projection.ts`: projects active plugin/resource/builtin skill packages into runtime-native skill roots. Nested (Codex): `cradle/{skillName}`. Flat (Claude / agent): `{skillName}` as basename — e.g. `cradle-plugin-browser-use`, `cradle-cli`.
