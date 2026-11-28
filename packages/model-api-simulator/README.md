# @cradle/model-api-simulator

Thin workspace wrapper around the upstream [model-api-simulator](https://github.com/wibus-wee/model-api-simulator),
vendored as a git submodule at [`vendor/model-api-simulator`](../../vendor/model-api-simulator).

`src/index.ts` re-exports the upstream TypeScript sources, so Cradle consumers keep importing
`@cradle/model-api-simulator` exactly as before. Protocol artifacts, tests, and quality gates
(protocol freshness, coverage) live in the upstream repository and are enforced by its CI.

## Dependency bridge

The submodule is not a pnpm workspace member, so upstream's bare imports (`elysia`, `srvx`, `ajv`,
`ajv-formats`) cannot resolve through normal workspace linking. Node and TypeScript resolution walk
up from `vendor/model-api-simulator/src`, so `vendor/node_modules/` holds committed symlinks — one
per upstream runtime dependency — pointing into this wrapper's real `node_modules`. If an upstream
dependency bump adds a new runtime import, add a matching symlink and a matching entry in this
wrapper's `dependencies`.

## Updating the simulator

```sh
git submodule update --remote vendor/model-api-simulator
git add vendor/model-api-simulator
```

Then commit the new pinned revision like any other dependency bump.
