# CLI performance implementation D handoff

Completed 2026-08-13 for scalability finding 17. This change makes generated CLI commands load by selected top-level group and preserves complete help for direct, Commander `help`, and Cradle `man` invocation forms.

## Outcome

`packages/cli/scripts/generate-cli.ts` now writes one registration module per generated top-level command under `src/commands/generated/groups.generated/`. The compact generated index contains only the sorted group manifest, descriptions, dynamic group loaders, and shallow placeholder registration. It no longer statically imports every generated leaf command.

`packages/cli/src/index.ts` resolves the requested generated group before Commander registration, dynamically registers that one group, then adds lightweight placeholders for unloaded groups so root help and unknown-command behavior retain the complete top-level command surface. Existing handwritten commands are registered normally and win over placeholders with the same top-level name.

The review found and fixed one behavior regression in the initial implementation: `cradle man session` selected the session group, but Commander’s equivalent `cradle help session` did not, so it showed only the handwritten `session await` subtree. Group selection now recognizes both help prefixes. Terminal root options such as `--help` and `--version` stop selection immediately, so an irrelevant later argument cannot trigger a group import.

The pure selector lives in `packages/cli/src/runtime/generated-command-selection.ts` and has a focused table-driven test covering direct groups, `--server` in split and equals forms, `man`, `help`, terminal root options, handwritten commands, and unknown commands.

## Owned files

- `packages/cli/scripts/generate-cli.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/runtime/generated-command-selection.ts`
- `packages/cli/src/runtime/generated-command-selection.test.ts`
- `packages/cli/src/commands/generated/index.generated.ts`
- `packages/cli/src/commands/generated/groups.generated/*.ts` (38 generated group modules)

Other modified generated leaf commands, including `session/list.ts`, `work/list.ts`, Chronicle, Codex, OpenCode, and Profile output, belong to concurrent server-contract changes and are intentionally excluded from this implementation commit.

## Validation

Run from the repository root:

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm vitest run packages/cli/src/runtime/generated-command-selection.test.ts

Result: 1 file passed, 11 tests passed.

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --filter @cradle/cli typecheck

Result: passed with no TypeScript diagnostics.

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --dir packages/cli exec tsdown

Result: passed. The build emitted 38 independently loadable generated group chunks plus shared runtime chunks and source maps.

The built CLI was exercised with:

    node packages/cli/dist/index.cjs --help
    node packages/cli/dist/index.cjs session --help
    node packages/cli/dist/index.cjs help session
    node packages/cli/dist/index.cjs man session list

Root help listed every generated group. Both direct and Commander help included the generated `session list` command. The manual command rendered the full `cradle session list` manual.

For a selected-group check, run:

    NODE_DEBUG=module node packages/cli/dist/index.cjs session --help

Filtering the module trace to `packages/cli/dist/*.cjs` produced only:

    packages/cli/dist/index.cjs
    packages/cli/dist/operation-command-<hash>.cjs
    packages/cli/dist/session-<hash>.cjs

No other generated group chunk was loaded. `git diff --check` passed for all owned files.

## Recovery and regeneration

The generated tree remains disposable. Rerunning `pnpm --filter @cradle/cli gen:cli` recreates the manifest and group modules from the server OpenAPI `x-cradle-cli` metadata. Reverting this implementation commit restores the prior all-commands static index. Build output under `packages/cli/dist` is ignored and is not part of the commit.
